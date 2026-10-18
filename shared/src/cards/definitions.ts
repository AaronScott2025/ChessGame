import type { Coord, GameState, PieceState } from '../types.js';
import {
  addEffect,
  barriersAdjacent,
  clearOrthogonalLOS,
  endBestBuddy,
  inBounds,
  isAlliedTerritory,
  isPieceBanned,
  log,
  manhattan,
  MIDDLE_ROWS,
  nearestEmptyAround,
  opposite,
  pieceAt,
  removeEffects,
  sameCoord,
  mulberry32,
} from '../utils.js';
import { getPieceDef, rollGamblerStyles, VARIANTS_BY_CLASS } from '../pieces/index.js';
import { getCardDef, registerCard, requirePiece } from './registry.js';
import { revertCast } from './castRecord.js';

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

const KING_BOOSTS = new Set([
  'kingsstead',
  'kingsstead_pending',
  'speed_plus',
  'speed_plus_pending',
  'mathematical',
  'movement_plus_pending',
]);

/** King movement boosts never stack and can't be refreshed while one is pending or active. */
function assertNoKingBoost(king: PieceState): void {
  if (king.effects.some((e) => KING_BOOSTS.has(e.kind))) {
    throw new Error('Your king already has a movement boost (pending or active)');
  }
}

function swapSubjects(state: GameState, piece: PieceState, newDefId: string): PieceState[] {
  const subjects: PieceState[] = [piece];
  const add = (p: PieceState | undefined) => {
    if (p && !subjects.some((s) => s.id === p.id)) subjects.push(p);
  };
  if (piece.linkedPieceId) {
    add(state.pieces.find((p) => p.id === piece.linkedPieceId));
  }
  if (piece.defId === 'prince_princess' || newDefId === 'prince_princess') {
    for (const p of state.pieces) {
      if (p.color === piece.color && p.class === 'wildcard' && p.id !== piece.id) add(p);
    }
  }
  return subjects;
}

function applyVariantSwap(state: GameState, piece: PieceState, newDefId: string): void {
  const def = getPieceDef(newDefId);
  if (def.class !== piece.class) throw new Error('Must be same class');
  if (def.id === piece.defId) throw new Error('Must be different variant');
  if (isPieceBanned(state, def.id)) throw new Error(`${def.name} was banned this game`);
  const fromName = getPieceDef(piece.defId).name;
  const subjects = swapSubjects(state, piece, def.id);
  for (const p of subjects) {
    if (endBestBuddy(state, p, p.pos)) log(state, 'Best Buddy ended');
    p.defId = def.id;
    p.class = def.class;
    p.linkedPieceId = undefined;
    if (def.id === 'snail') p.charges = 5;
    else if (def.id === 'reaper') p.charges = p.charges ?? 0;
    else if (def.id === 'vampire') p.charges = 1;
    else p.charges = undefined;
    if (def.id !== 'snake') p.bloodlustTurnsRemaining = undefined;
    p.pos = { row: -99, col: -99 };
  }
  for (const p of subjects) {
    p.pos = nearestEmptyAround(state, p.startPos) ?? { ...p.startPos };
  }
  if (def.id === 'prince_princess' && subjects.length >= 2) {
    subjects[0].linkedPieceId = subjects[1].id;
    subjects[1].linkedPieceId = subjects[0].id;
  }
  if (def.id === 'gambler') {
    const rng = mulberry32((state.rngSeed ?? 1) + state.cycleCount * 9973 + state.turnCount * 13);
    for (const line of rollGamblerStyles(state, rng, true)) log(state, line);
  }
  log(state, `Swapped ${fromName} → ${def.name}`);
}

registerCard({
  id: 'barrier',
  name: 'Barrier',
  description: [
    'Place a barrier on an empty square in allied territory.',
    'No piece can stand on this tile.',
    'Barrier disappears after five turns.',
  ],
  image: '/cards/Barrier.png',
  targeting: 'empty_allied',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick an empty allied square' };
    const pos = targets[0] as Coord;
    if (!isAlliedTerritory(ctx.player, pos) || pieceAt(ctx.state, pos)) {
      throw new Error('Invalid barrier square');
    }
    if (barriersAdjacent(ctx.state, pos)) throw new Error('Barriers cannot be adjacent');
    ctx.state.tokens.push({
      id: uid('barrier'),
      kind: 'barrier',
      pos,
      owner: ctx.player,
      turnsRemaining: 5,
    });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'blink',
  name: 'Blink',
  description: [
    'Attach Blink to any piece.',
    'Marks the square it moved from; it can return there.',
    'Only one Blink at a time. Cancelled if another piece enters the blink square.',
  ],
  image: '/cards/Blink.png',
  targeting: 'piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a piece to Blink' };
    // clear existing blinks for this player
    for (const p of ctx.state.pieces) {
      if (p.color === ctx.player) removeEffects(p, 'blink');
    }
    ctx.state.tokens = ctx.state.tokens.filter((t) => !(t.kind === 'blink' && t.owner === ctx.player));
    const piece = requirePiece(ctx.state, targets[0] as string);
    addEffect(piece, { id: uid('blink'), kind: 'blink', sourceCardId: 'blink', data: { tokenPos: null } });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'enchant',
  name: 'Enchant',
  description: [
    'Enchant any non-king piece.',
    'Choose any Queen variant.',
    'Survive 10 turns without moving and without any allied piece being taken.',
    'If successful, becomes the chosen Queen variant.',
  ],
  image: '/cards/Enchant.png',
  tags: ['persistent'],
  targeting: 'any_piece_non_king',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a non-king piece' };
    if (targets.length < 2) return { state: ctx.state, done: false, message: 'Pick a Queen variant' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.class === 'king') throw new Error('Cannot enchant king');
    const queenDefId = targets[1] as string;
    if (!VARIANTS_BY_CLASS.queen.includes(queenDefId)) throw new Error('Pick a Queen variant');
    if (isPieceBanned(ctx.state, queenDefId)) throw new Error(`${getPieceDef(queenDefId).name} is banned`);
    addEffect(piece, {
      id: uid('enchant'),
      kind: 'enchant_ritual',
      turnsRemaining: 10,
      sourceCardId: 'enchant',
      data: { owner: ctx.player, queenDefId },
    });
    log(ctx.state, `Enchant ritual begins on ${getPieceDef(piece.defId).name} → ${getPieceDef(queenDefId).name}`);
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'kingstead',
  name: 'KingsStead',
  description: [
    'For 3 turns, your king may move like a knight instead of its normal moves.',
    'Takes 4 turns to take effect (king movement rule).',
  ],
  image: '/cards/Kingstead.png',
  targeting: 'none',
  play: (ctx) => {
    const king = ctx.state.pieces.find((p) => p.color === ctx.player && p.class === 'king');
    if (!king) throw new Error('No king');
    assertNoKingBoost(king);
    addEffect(king, {
      id: uid('ks_pending'),
      kind: 'kingsstead_pending',
      turnsRemaining: 4,
      data: { duration: 3 },
      sourceCardId: 'kingstead',
    });
    log(ctx.state, 'KingsStead will activate on the king in 4 turns');
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'speed_plus',
  name: 'SpeedPlus',
  description: ['Lets your king move 2 spaces instead of 1.', 'Effect stops after 8 turns.'],
  image: '/cards/SpeedPlus.png',
  targeting: 'none',
  play: (ctx) => {
    const king = ctx.state.pieces.find((p) => p.color === ctx.player && p.class === 'king');
    if (!king) throw new Error('No king');
    assertNoKingBoost(king);
    // Movement on king takes 4 turns to take effect per rules
    addEffect(king, {
      id: uid('sp_pending'),
      kind: 'speed_plus_pending',
      turnsRemaining: 4,
      data: { duration: 8 },
      sourceCardId: 'speed_plus',
    });
    log(ctx.state, 'SpeedPlus will activate on the king in 4 turns');
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'mathematical',
  name: 'Mathematical',
  description: [
    'Apply to any piece.',
    'Adds +1 to their movement for 2 turns.',
    'Does not persist through death.',
    'On a king, the boost waits 4 turns before applying (still lasts 2 turns once active).',
  ],
  image: '/cards/Mathematical.png',
  targeting: 'piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.class === 'king') {
      assertNoKingBoost(piece);
      addEffect(piece, {
        id: uid('math_pending'),
        kind: 'movement_plus_pending',
        turnsRemaining: 4,
        data: { amount: 1, duration: 2 },
        sourceCardId: 'mathematical',
      });
    } else {
      addEffect(piece, {
        id: uid('math'),
        kind: 'mathematical',
        turnsRemaining: 2,
        sourceCardId: 'mathematical',
      });
    }
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'fortify',
  name: 'Fortify',
  description: ['Pick 1 piece. For 5 turns it cannot be taken by Pawns or Knights (including variants).'],
  image: '/cards/Fortify.png',
  targeting: 'allied_piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick an allied piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.color !== ctx.player) throw new Error('Must be allied');
    addEffect(piece, { id: uid('fort'), kind: 'fortify', turnsRemaining: 5, sourceCardId: 'fortify' });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'pause',
  name: 'Pause',
  description: ['Freeze one non-king piece (allied or enemy) for 2 turns.', 'During this time, the piece is invincible.'],
  image: '/cards/Pause.png',
  targeting: 'any_piece_non_king',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a non-king piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.class === 'king') throw new Error('Cannot pause king');
    addEffect(piece, { id: uid('pause'), kind: 'pause', turnsRemaining: 2, sourceCardId: 'pause' });
    addEffect(piece, { id: uid('inv'), kind: 'invincible', turnsRemaining: 2, sourceCardId: 'pause' });
    addEffect(piece, { id: uid('frz'), kind: 'frozen', turnsRemaining: 2, sourceCardId: 'pause' });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'doublecast',
  name: 'Doublecast',
  description: [
    'The turn after you cast this, you may use two piece abilities in one turn (still one spell).',
  ],
  image: '/cards/Doublecast.png',
  targeting: 'none',
  play: (ctx) => {
    addEffect(
      // store on king as player flag via activeSpells
      ctx.state.pieces.find((p) => p.color === ctx.player && p.class === 'king')!,
      { id: uid('dc'), kind: 'doublecast_pending', turnsRemaining: 1, sourceCardId: 'doublecast' },
    );
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'echo',
  name: 'Echo',
  description: [
    'Choose one allied piece.',
    'On your next turn, after it moves, it may repeat the exact same move again.',
    'Cannot capture on the echo.',
  ],
  image: '/cards/Echo.png',
  targeting: 'allied_piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick an allied piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    addEffect(piece, { id: uid('echo'), kind: 'echo_armed', turnsRemaining: 2, sourceCardId: 'echo' });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'rearrange',
  name: 'Rearrange',
  description: ['Pick any 4 allied pieces.', 'Their positions are shuffled at random among those squares.'],
  image: '/cards/Rearrange.png',
  targeting: 'multi_allied',
  targetCount: 4,
  play: (ctx, targets) => {
    // targets: [id,id,id,id] then permutation of positions as { assignments: {id: Coord} }
    if (targets.length < 4) {
      return { state: ctx.state, done: false, message: `Pick ${4 - targets.length} more allied piece(s)` };
    }
    if (targets.length === 4) {
      return {
        state: ctx.state,
        done: false,
        message: 'Send new positions for the 4 pieces (permutation of their squares)',
      };
    }
    const ids = targets.slice(0, 4) as string[];
    const assignment = targets[4] as Record<string, Coord>;
    const pieces = ids.map((id) => requirePiece(ctx.state, id));
    if (pieces.some((p) => p.color !== ctx.player)) throw new Error('Must be allied');
    const squares = pieces.map((p) => p.pos);
    const used = new Set<string>();
    for (const p of pieces) {
      const dest = assignment[p.id];
      if (!dest) throw new Error('Missing assignment');
      const key = `${dest.row},${dest.col}`;
      if (!squares.some((s) => sameCoord(s, dest))) throw new Error('Must permute existing squares');
      if (used.has(key)) throw new Error('Duplicate destination');
      used.add(key);
    }
    for (const p of pieces) {
      const dest = assignment[p.id];
      if (!sameCoord(p.pos, dest)) {
        if (endBestBuddy(ctx.state, p, p.pos)) log(ctx.state, 'Best Buddy ended');
      }
    }
    for (const p of pieces) p.pos = assignment[p.id];
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'repel',
  name: 'Repel',
  description: [
    'From your King, pick a piece in unbroken orthogonal LOS within 2 squares.',
    'Launch it backwards to the opposite wall.',
    'If nearest wall is 3+ away after, it cannot move for 1 turn.',
  ],
  image: '/cards/Repel.png',
  targeting: 'piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a piece to repel' };
    const king = ctx.state.pieces.find((p) => p.color === ctx.player && p.class === 'king');
    if (!king) throw new Error('No king');
    const target = requirePiece(ctx.state, targets[0] as string);
    if (manhattan(king.pos, target.pos) > 2 || manhattan(king.pos, target.pos) < 1) {
      throw new Error('Must be within 2 orthogonal');
    }
    if (king.pos.row !== target.pos.row && king.pos.col !== target.pos.col) {
      throw new Error('Must be orthogonal');
    }
    if (!clearOrthogonalLOS(ctx.state, king.pos, target.pos)) throw new Error('Blocked LOS');
    const dr = Math.sign(target.pos.row - king.pos.row);
    const dc = Math.sign(target.pos.col - king.pos.col);
    let r = target.pos.row;
    let c = target.pos.col;
    let last = { ...target.pos };
    while (true) {
      const next = { row: r + dr, col: c + dc };
      if (!inBounds(next)) break;
      if (pieceAt(ctx.state, next) || ctx.state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, next))) {
        break;
      }
      last = next;
      r = next.row;
      c = next.col;
    }
    target.pos = last;
    const distToWall = Math.min(last.row, last.col, 9 - last.row, 9 - last.col);
    if (distToWall >= 3) {
      addEffect(target, { id: uid('stun'), kind: 'stunned', turnsRemaining: 1 });
    }
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'rally',
  name: 'Rally',
  description: [
    'Cancel the opponent\'s last played card: everything it did is undone, including lasting and delayed effects.',
    'Can be cast on either player\'s turn, even outside the spell phase.',
  ],
  image: '/cards/Rally.png',
  tags: ['rally', 'instant'],
  playOnOpponentTurn: true,
  targeting: 'none',
  play: (ctx) => {
    const enemy = opposite(ctx.player);
    const reverted = revertCast(ctx.state, enemy);
    if (reverted) {
      ctx.state.players[enemy].lastPlayedCardDefId = undefined;
      log(ctx.state, `Rally canceled ${getCardDef(reverted).name} — all of its effects are undone`);
      return { state: ctx.state, done: true };
    }
    throw new Error('Nothing to cancel — your opponent has no card left to Rally against');
  },
});

registerCard({
  id: 'teleport',
  name: 'Teleport!',
  description: [
    'Move a piece in allied territory two spaces in any direction.',
    'Can enter enemy territory, but cannot check the king or capture.',
  ],
  image: '/cards/Teleport.png',
  targeting: 'allied_piece',
  play: (ctx, targets) => {
    if (targets.length < 1) return { state: ctx.state, done: false, message: 'Pick an allied piece in allied territory' };
    if (targets.length < 2) return { state: ctx.state, done: false, message: 'Pick a destination 2 squares away' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.color !== ctx.player || !isAlliedTerritory(ctx.player, piece.pos)) {
      throw new Error('Piece must be allied and in allied territory');
    }
    const to = targets[1] as Coord;
    if (!inBounds(to)) throw new Error('Destination off the board');
    const dr = to.row - piece.pos.row;
    const dc = to.col - piece.pos.col;
    if (!((Math.abs(dr) === 2 && dc === 0) || (Math.abs(dc) === 2 && dr === 0) || (Math.abs(dr) === 2 && Math.abs(dc) === 2))) {
      throw new Error('Must move exactly two spaces in a direction');
    }
    if (pieceAt(ctx.state, to)) throw new Error('Cannot capture');
    if (endBestBuddy(ctx.state, piece, piece.pos)) log(ctx.state, 'Best Buddy ended');
    piece.pos = to;
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'recall',
  name: 'Recall',
  description: [
    'Works on any allied piece.',
    'If it does not move for two turns, it returns to its starting position (or nearest adjacent).',
    'Canceled if the piece moves or is taken.',
  ],
  image: '/cards/Recall.png',
  tags: ['persistent'],
  targeting: 'allied_piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick an allied piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    addEffect(piece, {
      id: uid('recall'),
      kind: 'recall',
      data: { idleTurns: 0 },
      sourceCardId: 'recall',
    });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'rewind',
  name: 'Rewind',
  description: [
    'Undo the opponent\'s last turn (board and hands as of the start of that turn).',
    'You keep the current turn; this counts as your spell.',
    'Cannot be used on the first turn of the game.',
  ],
  image: '/cards/Rewind.png',
  targeting: 'none',
  play: (ctx) => {
    // snapshots[0] = start of the current turn; snapshots[1] = start of the previous turn
    if (ctx.state.snapshots.length < 2) throw new Error('Nothing to rewind yet');
    const restored = JSON.parse(ctx.state.snapshots[1]) as typeof ctx.state;
    restored.snapshots = ctx.state.snapshots.slice(2);

    // Consume Rewind on the restored timeline
    const hand = restored.players[ctx.player].hand;
    const idx = hand.findIndex((c) => c.instanceId === ctx.card.instanceId);
    if (idx >= 0) {
      const [card] = hand.splice(idx, 1);
      restored.discardPile.push(card);
    } else {
      restored.discardPile.push({ instanceId: ctx.card.instanceId, defId: ctx.card.defId });
    }

    restored.turn = ctx.player;
    restored.turnPhase = 'move';
    restored.phase = 'playing';
    restored.pendingPrompt = null;
    restored.check = null;
    restored.players[ctx.player].spellsThisTurn = Math.max(
      restored.players[ctx.player].spellsThisTurn,
      restored.players[ctx.player].maxSpellsThisTurn || 1,
    );
    restored.players[ctx.player].lastPlayedCardDefId = 'rewind';
    log(restored, `${ctx.player} used Rewind — previous turn undone`);
    return { state: restored, done: true };
  },
});

registerCard({
  id: 'swap',
  name: 'Swap',
  description: [
    'Swap a non-king non-queen piece with a different variant of the same class.',
    'Prince & Princess swap together (both become the new variant).',
    'Each swapped piece returns to its starting square.',
  ],
  image: '/cards/Swap.png',
  targeting: 'allied_piece',
  play: (ctx, targets) => {
    if (targets.length < 1) return { state: ctx.state, done: false, message: 'Pick a non-king non-queen piece' };
    if (targets.length < 2) return { state: ctx.state, done: false, message: 'Pick a different variant of the same class' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.color !== ctx.player) throw new Error('Allied only');
    if (piece.class === 'king' || piece.class === 'queen') throw new Error('Cannot swap king/queen');
    const newDefId = targets[1] as string;
    applyVariantSwap(ctx.state, piece, newDefId);
    if (piece.class === 'wildcard') ctx.state.players[ctx.player].army.wildcard = newDefId;
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'revive',
  name: 'Revive',
  description: ['Revive one fallen piece of your choice.'],
  image: '/cards/Revive.png',
  targeting: 'graveyard',
  play: (ctx, targets) => {
    const gy = ctx.state.players[ctx.player].graveyard;
    if (!gy.length) throw new Error('No fallen pieces');
    if (targets.length < 1) return { state: ctx.state, done: false, message: 'Pick a fallen piece' };
    if (targets.length < 2) return { state: ctx.state, done: false, message: 'Pick a legal spawn square' };
    const idx = targets[0] as number;
    const pos = targets[1] as Coord;
    const fallen = gy[idx];
    if (!fallen) throw new Error('Invalid graveyard index');
    if (pieceAt(ctx.state, pos)) throw new Error('Occupied');
    gy.splice(idx, 1);
    ctx.state.pieces.push({
      id: uid('rev'),
      defId: fallen.defId,
      class: fallen.class,
      color: ctx.player,
      pos,
      hasMoved: false,
      startPos: pos,
      effects: [],
    });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'refresh',
  name: 'Refresh',
  description: ['Pick any piece on the board. Move it back to its beginning location.', 'Cannot put the king into check.'],
  image: '/cards/Refresh.png',
  targeting: 'piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    const dest = nearestEmptyAround(ctx.state, piece.startPos);
    if (!dest) throw new Error('No space at start');
    if (endBestBuddy(ctx.state, piece, piece.pos)) log(ctx.state, 'Best Buddy ended');
    piece.pos = dest;
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'pawn_summon',
  name: 'Pawn Summon',
  description: [
    'Revive up to two pawns anywhere in allied territory.',
    'For each revive, choose which pawn variant to place (Pawn, nwaP, Rogue, or Crystalite).',
  ],
  image: '/cards/Pawn_Summon.png',
  targeting: 'empty_allied',
  targetCount: 2,
  play: (ctx, targets) => {
    const gy = ctx.state.players[ctx.player].graveyard;
    const pawnSlots = gy.filter((g) => g.class === 'pawn').length;
    if (pawnSlots < 1) throw new Error('Need fallen pawns');
    const need = Math.min(2, pawnSlots);
    // targets: [defId, Coord, defId, Coord, ...]
    if (targets.length < need * 2) {
      const chosen = Math.floor(targets.length / 2);
      if (targets.length % 2 === 1) {
        const defId = targets[targets.length - 1] as string;
        const name = getPieceDef(defId).name;
        return {
          state: ctx.state,
          done: false,
          message: `Pick an empty allied square for ${name} (${chosen + 1}/${need})`,
        };
      }
      return {
        state: ctx.state,
        done: false,
        message: `Choose pawn variant ${chosen + 1} of ${need}`,
      };
    }
    for (let n = 0; n < need; n++) {
      const defId = targets[n * 2] as string;
      const pos = targets[n * 2 + 1] as Coord;
      const def = getPieceDef(defId);
      if (def.class !== 'pawn') throw new Error('Must be a pawn variant');
      if (isPieceBanned(ctx.state, def.id)) throw new Error(`${def.name} was banned this game`);
      if (!isAlliedTerritory(ctx.player, pos) || pieceAt(ctx.state, pos)) throw new Error('Invalid square');
      const idx = gy.findIndex((g) => g.class === 'pawn');
      if (idx < 0) throw new Error('Need fallen pawns');
      gy.splice(idx, 1);
      ctx.state.pieces.push({
        id: uid('pawn'),
        defId: def.id,
        class: 'pawn',
        color: ctx.player,
        pos,
        hasMoved: false,
        startPos: pos,
        effects: [],
      });
    }
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'pocket_castle',
  name: 'Pocket Castle',
  description: ['Lets your King swap places with any allied piece.', 'No range limit.'],
  image: '/cards/Pocket_Castle.png',
  targeting: 'allied_piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick an allied piece to swap with your King' };
    const king = ctx.state.pieces.find((p) => p.color === ctx.player && p.class === 'king');
    const other = requirePiece(ctx.state, targets[0] as string);
    if (!king || other.color !== ctx.player || other.id === king.id) throw new Error('Invalid target');
    if (endBestBuddy(ctx.state, other, other.pos)) log(ctx.state, 'Best Buddy ended');
    const tmp = { ...king.pos };
    king.pos = { ...other.pos };
    other.pos = tmp;
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'portal',
  name: 'Portal',
  description: [
    'Place two portal tokens on empty squares.',
    'Pieces may travel between them; landing on an occupied portal captures.',
  ],
  image: '/cards/Portal.png',
  targeting: 'empty_any',
  targetCount: 2,
  play: (ctx, targets) => {
    if (targets.length < 2) return { state: ctx.state, done: false, message: 'Pick two empty squares' };
    const a = targets[0] as Coord;
    const b = targets[1] as Coord;
    if (pieceAt(ctx.state, a) || pieceAt(ctx.state, b)) throw new Error('Must be empty');
    // replace existing portals from this player
    ctx.state.tokens = ctx.state.tokens.filter((t) => !(t.kind === 'portal' && t.owner === ctx.player));
    const id = uid('portal');
    ctx.state.tokens.push(
      { id: `${id}_a`, kind: 'portal', pos: a, owner: ctx.player, data: { link: `${id}_b` } },
      { id: `${id}_b`, kind: 'portal', pos: b, owner: ctx.player, data: { link: `${id}_a` } },
    );
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'blind_gambit',
  name: 'Blind Gambit',
  description: ["Take an opponent's magic card at random."],
  image: '/cards/Blind_Gambit.png',
  targeting: 'none',
  play: (ctx) => {
    const enemy = ctx.state.players[opposite(ctx.player)];
    if (!enemy.hand.length) throw new Error('Opponent has no cards');
    if (ctx.state.players[ctx.player].hand.length >= 5) {
      // will discard self card first when resolving; steal may need discard
    }
    const idx = Math.floor(ctx.rng() * enemy.hand.length);
    const [stolen] = enemy.hand.splice(idx, 1);
    if (ctx.state.players[ctx.player].hand.length >= 5) {
      ctx.state.discardPile.push(stolen);
      log(ctx.state, 'Hand full — stolen card discarded');
    } else {
      ctx.state.players[ctx.player].hand.push(stolen);
    }
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'gamblers_gambit',
  name: "Gambler's Gambit",
  description: [
    'Roll 2 dice (2–12) and resolve the matching effect:',
    '2–4: Opponent chooses one of your non-king / non-queen pieces to remove.',
    '5–6: Your next turn is skipped.',
    '7–9: Choose a non-king class; immobilize all enemy pieces of that class for 2 turns.',
    '10: Opponent revives one piece.',
    '11: You revive one of your pieces.',
    '12: Gain a Queen on an empty square near your frontline.',
  ],
  image: '/cards/Gamblers_Gambit.png',
  targeting: 'none',
  play: (ctx) => {
    const roll = 1 + Math.floor(ctx.rng() * 6) + 1 + Math.floor(ctx.rng() * 6);
    ctx.state.players[ctx.player].lastPlayedCardDefId = 'gamblers_gambit';
    log(ctx.state, `${ctx.player} played Gambler's Gambit`);
    log(ctx.state, `Gambler's Gambit rolled ${roll}`);
    ctx.state.pendingPrompt = {
      type: 'gambler_choice',
      color: ctx.player,
      cardDefId: 'gamblers_gambit',
      roll,
      message: gamblerMessage(roll),
    };
    // card consumed by engine after prompt resolved — mark via data
    (ctx.state.pendingPrompt as { _instanceId?: string })._instanceId = ctx.card.instanceId;
    return { state: ctx.state, done: false, message: gamblerMessage(roll) };
  },
});

registerCard({
  id: 'gamblers_delight',
  name: "Gambler's Delight",
  description: [
    'Roll 2 dice (2–12) and resolve the matching effect:',
    '2–4: Opponent chooses one of your pawns to remove (if any).',
    '5–6: Nothing happens.',
    '7–9: Choose a non-king class; all pieces of that class (both sides) cannot move for 3 turns.',
    '10–11: Choose a class; both players revive one piece of that class if available.',
    '12: Gain a Queen variant on an empty square near your frontline.',
  ],
  image: '/cards/Gamblers_Delight.png',
  targeting: 'none',
  play: (ctx) => {
    const roll = 1 + Math.floor(ctx.rng() * 6) + 1 + Math.floor(ctx.rng() * 6);
    ctx.state.players[ctx.player].lastPlayedCardDefId = 'gamblers_delight';
    log(ctx.state, `${ctx.player} played Gambler's Delight`);
    log(ctx.state, `Gambler's Delight rolled ${roll}`);
    ctx.state.pendingPrompt = {
      type: 'gambler_choice',
      color: ctx.player,
      cardDefId: 'gamblers_delight',
      roll,
      message: delightMessage(roll),
    };
    (ctx.state.pendingPrompt as { _instanceId?: string })._instanceId = ctx.card.instanceId;
    return { state: ctx.state, done: false, message: delightMessage(roll) };
  },
});

function gamblerMessage(roll: number): string {
  if (roll <= 4) return `Rolled ${roll}: Opponent chooses one of your non-king/non-queen pieces to lose.`;
  if (roll <= 6) return `Rolled ${roll}: Your next turn is skipped.`;
  if (roll <= 9) return `Rolled ${roll}: Choose a non-king type; immobilize all enemy pieces of that type for 2 turns.`;
  if (roll === 10) return `Rolled ${roll}: Opponent revives one piece.`;
  if (roll === 11) return `Rolled ${roll}: Revive one of your pieces.`;
  return `Rolled ${roll}: Gain a Queen (not Royal/special-locked).`;
}

registerCard({
  id: 'cloak',
  name: 'Cloak',
  description: [
    'Online only.',
    'Pick one of your non-king pieces: it becomes invisible to your opponent for its next 5 moves.',
    'Its moves show up in the opponent’s battle log as <REDACTED>.',
  ],
  image: '/cards/Cloak.png',
  targeting: 'allied_piece',
  onlineOnly: true,
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick an allied piece to cloak' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.color !== ctx.player) throw new Error('Cloak only works on your own pieces');
    if (piece.class === 'king') throw new Error('The king cannot be cloaked');
    removeEffects(piece, 'cloaked');
    addEffect(piece, { id: uid('cloak'), kind: 'cloaked', sourceCardId: 'cloak', data: { movesLeft: 5 } });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'in_spirit',
  name: 'In-Spirit',
  description: [
    'Pick one of your pieces.',
    'For 2 turns it captures anything within its normal moves without leaving its square.',
  ],
  image: '/cards/In_Spirit.png',
  targeting: 'allied_piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick an allied piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.color !== ctx.player) throw new Error('In-Spirit only works on your own pieces');
    removeEffects(piece, 'in_spirit');
    addEffect(piece, { id: uid('spirit'), kind: 'in_spirit', turnsRemaining: 2, sourceCardId: 'in_spirit' });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'coordinated_shuffle',
  name: 'Coordinated Shuffle',
  description: ['Pick any 2 non-king pieces, allied or enemy.', 'They swap positions.'],
  image: '/cards/Coordinated_Shuffle.png',
  targeting: 'any_piece_non_king',
  targetCount: 2,
  play: (ctx, targets) => {
    if (targets.length < 2) {
      return { state: ctx.state, done: false, message: `Pick ${2 - targets.length} more piece(s) to swap` };
    }
    const a = requirePiece(ctx.state, targets[0] as string);
    const b = requirePiece(ctx.state, targets[1] as string);
    if (a.id === b.id) throw new Error('Pick two different pieces');
    if (a.class === 'king' || b.class === 'king') throw new Error('Kings cannot be shuffled');
    if (sameCoord(a.pos, b.pos)) throw new Error('Those pieces share a square');
    const aFrom = { ...a.pos };
    const bFrom = { ...b.pos };
    if (endBestBuddy(ctx.state, a, aFrom)) log(ctx.state, 'Best Buddy ended');
    if (endBestBuddy(ctx.state, b, bFrom)) log(ctx.state, 'Best Buddy ended');
    a.pos = bFrom;
    b.pos = aFrom;
    log(
      ctx.state,
      `Coordinated Shuffle: ${a.color} ${getPieceDef(a.defId).name} ↔ ${b.color} ${getPieceDef(b.defId).name}`,
    );
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'gamblers_high',
  name: 'Gamblers High',
  description: [
    'Roll 2 dice (2–12):',
    '2–4: Swap hands with your opponent.',
    '5–6: Draw until you hold 5 cards.',
    '7: Swap all your cards for new ones.',
    '8: Summon a Gambler on any empty tile in allied territory.',
    '9: Your knight variants become a new knight variant.',
    '10: Both players lose a queen.',
    '11: Rows 5–6 become neutral territory for 5 turns (no spells, no captures there).',
    '12: Both kings return to their starting squares, unless that would put one in check.',
  ],
  image: '/cards/Gamblers_High.png',
  targeting: 'none',
  play: (ctx) => {
    const roll = 1 + Math.floor(ctx.rng() * 6) + 1 + Math.floor(ctx.rng() * 6);
    ctx.state.players[ctx.player].lastPlayedCardDefId = 'gamblers_high';
    log(ctx.state, `${ctx.player} played Gamblers High`);
    log(ctx.state, `Gamblers High rolled ${roll}`);
    ctx.state.pendingPrompt = {
      type: 'gambler_choice',
      color: ctx.player,
      cardDefId: 'gamblers_high',
      roll,
      message: highMessage(roll),
    };
    (ctx.state.pendingPrompt as { _instanceId?: string })._instanceId = ctx.card.instanceId;
    return { state: ctx.state, done: false, message: highMessage(roll) };
  },
});

registerCard({
  id: 'lava_tsunami',
  name: 'Lava Tsunami',
  description: [
    'Rows 5–6 heat up from orange to red over 3 turn cycles.',
    'Then they turn to lava for 1 turn cycle: every non-king piece on them is destroyed,',
    'and any piece that moves into or through the lava burns. Kings cannot enter it.',
  ],
  image: '/cards/Lava_Tsunami.png',
  targeting: 'none',
  play: (ctx) => {
    const zones = ctx.state.zones ?? [];
    if (zones.some((z) => z.kind === 'lava_warning' || z.kind === 'lava')) {
      throw new Error('A Lava Tsunami is already underway');
    }
    ctx.state.zones = [
      ...zones,
      {
        id: uid('lava'),
        kind: 'lava_warning',
        rows: [...MIDDLE_ROWS],
        owner: ctx.player,
        turnsRemaining: 3,
        total: 3,
        createdTurn: ctx.state.turnCount,
      },
    ];
    log(ctx.state, 'Lava Tsunami: rows 5–6 begin to heat up…');
    return { state: ctx.state, done: true };
  },
});

function highMessage(roll: number): string {
  if (roll <= 4) return `Rolled ${roll}: You swap hands with your opponent.`;
  if (roll <= 6) return `Rolled ${roll}: Draw until you hold 5 cards.`;
  if (roll === 7) return `Rolled ${roll}: Swap all of your cards for new ones.`;
  if (roll === 8) return `Rolled ${roll}: Click an empty tile in allied territory to summon a Gambler.`;
  if (roll === 9) return `Rolled ${roll}: Your knights become a new knight variant.`;
  if (roll === 10) return `Rolled ${roll}: Both players lose a queen.`;
  if (roll === 11) return `Rolled ${roll}: Rows 5–6 become neutral territory for 5 turns.`;
  return `Rolled ${roll}: Both kings return to their starting squares (unless that puts one in check).`;
}

function delightMessage(roll: number): string {
  if (roll <= 4) return `Rolled ${roll}: Opponent chooses one of your pawns to lose (if any).`;
  if (roll <= 6) return `Rolled ${roll}: Nothing happens.`;
  if (roll <= 9) return `Rolled ${roll}: Choose a non-king type; ALL pieces of that type cannot move for 3 turns.`;
  if (roll <= 11) return `Rolled ${roll}: Pick a type; both players revive one of that type if available.`;
  return `Rolled ${roll}: Gain a Queen variant.`;
}

