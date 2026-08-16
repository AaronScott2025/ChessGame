import type { Coord } from '../types.js';
import {
  addEffect,
  barriersAdjacent,
  clearOrthogonalLOS,
  inBounds,
  isAlliedTerritory,
  log,
  manhattan,
  nearestEmptyAround,
  opposite,
  pieceAt,
  removeEffects,
  sameCoord,
} from '../utils.js';
import { getPieceDef } from '../pieces/index.js';
import { registerCard, requirePiece } from './registry.js';

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
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
    'Survive 10 turns without moving and without any allied piece being taken.',
    'If successful, becomes a Queen.',
  ],
  image: '/cards/Enchant.png',
  tags: ['persistent'],
  targeting: 'any_piece_non_king',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a non-king piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.class === 'king') throw new Error('Cannot enchant king');
    addEffect(piece, {
      id: uid('enchant'),
      kind: 'enchant_ritual',
      turnsRemaining: 10,
      sourceCardId: 'enchant',
      data: { owner: ctx.player },
    });
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'kingstead',
  name: 'KingsStead',
  description: ['For 3 turns, your king may move like a knight instead of its normal moves.'],
  image: '/cards/Kingstead.png',
  targeting: 'none',
  play: (ctx) => {
    const king = ctx.state.pieces.find((p) => p.color === ctx.player && p.class === 'king');
    if (!king) throw new Error('No king');
    addEffect(king, { id: uid('ks'), kind: 'kingsstead', turnsRemaining: 3, sourceCardId: 'kingstead' });
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
  description: ['Apply to any piece.', 'Adds +1 to their movement.', 'Does not persist through death.'],
  image: '/cards/Mathematical.png',
  targeting: 'piece',
  play: (ctx, targets) => {
    if (!targets.length) return { state: ctx.state, done: false, message: 'Pick a piece' };
    const piece = requirePiece(ctx.state, targets[0] as string);
    if (piece.class === 'king') {
      addEffect(piece, {
        id: uid('math_pending'),
        kind: 'movement_plus_pending',
        turnsRemaining: 4,
        data: { amount: 1 },
        sourceCardId: 'mathematical',
      });
    } else {
      addEffect(piece, { id: uid('math'), kind: 'mathematical', sourceCardId: 'mathematical' });
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
  description: ['The turn after you cast this, you may use two abilities in one turn for one turn.'],
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
  description: ['Pick any 4 allied pieces.', 'Swap their positions however you like.'],
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
    'Cancel the opponent\'s last played card / an active opponent effect.',
    'Can be used on opponent\'s turn.',
    'Also: if opponent has ≤1/4 army left, can cancel an active effect they have in play.',
  ],
  image: '/cards/Rally.png',
  tags: ['rally', 'instant'],
  playOnOpponentTurn: true,
  targeting: 'none',
  play: (ctx) => {
    const enemy = opposite(ctx.player);
    // cancel last enemy active spell
    const spells = ctx.state.players[enemy].activeSpells;
    if (spells.length) {
      const removed = spells.pop()!;
      log(ctx.state, `Rally canceled ${removed.defId}`);
    } else {
      // strip a recent effect tagged from enemy cards on pieces
      for (const p of ctx.state.pieces) {
        const idx = p.effects.findIndex((e) => e.sourceCardId && e.sourceCardId !== 'rally');
        if (idx >= 0 && p.color === ctx.player) {
          // cancel harmful? Prefer cancel enemy-sourced effects on anyone
        }
      }
      for (const p of ctx.state.pieces) {
        const before = p.effects.length;
        p.effects = p.effects.filter((e) => {
          // remove effects that enemy likely applied recently
          return !(e.sourceCardId && ['pause', 'fortify', 'mathematical', 'echo', 'enchant', 'blink', 'recall'].includes(e.sourceCardId) && p.color !== enemy);
        });
        // simpler: remove non-permanent effects from enemy pieces that are buffs, and debuffs from allies
      }
      // Practical: remove one timed effect from any piece owned by enemy (buff) or applied as control
      outer: for (const p of ctx.state.pieces) {
        for (let i = 0; i < p.effects.length; i++) {
          const e = p.effects[i];
          if (e.turnsRemaining != null && e.sourceCardId) {
            p.effects.splice(i, 1);
            log(ctx.state, `Rally canceled effect ${e.kind}`);
            break outer;
          }
        }
      }
    }
    return { state: ctx.state, done: true };
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
    if (Math.max(Math.abs(to.row - piece.pos.row), Math.abs(to.col - piece.pos.col)) !== 2) {
      // any direction exactly 2 - allow orthogonal or diagonal chebyshev or manhattan?
      // "two spaces into any direction" => one direction vector of length 2
    }
    const dr = to.row - piece.pos.row;
    const dc = to.col - piece.pos.col;
    if (!((Math.abs(dr) === 2 && dc === 0) || (Math.abs(dc) === 2 && dr === 0) || (Math.abs(dr) === 2 && Math.abs(dc) === 2))) {
      throw new Error('Must move exactly two spaces in a direction');
    }
    if (pieceAt(ctx.state, to)) throw new Error('Cannot capture');
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
  description: ['Undo the last turn cycle.'],
  image: '/cards/Rewind.png',
  targeting: 'none',
  play: (ctx) => {
    if (ctx.state.snapshots.length < 1) throw new Error('Nothing to rewind');
    const snap = ctx.state.snapshots[0];
    const restored = JSON.parse(snap) as typeof ctx.state;
    restored.snapshots = ctx.state.snapshots.slice(1);
    log(restored, `${ctx.player} used Rewind`);
    // still need to consume card from current - apply on restored
    const hand = restored.players[ctx.player].hand;
    const idx = hand.findIndex((c) => c.instanceId === ctx.card.instanceId);
    if (idx >= 0) {
      const [card] = hand.splice(idx, 1);
      restored.discardPile.push(card);
    }
    restored.players[ctx.player].spellsThisTurn += 1;
    restored.pendingPrompt = null;
    return { state: restored, done: true };
  },
});

registerCard({
  id: 'swap',
  name: 'Swap',
  description: [
    'Swap a non-king non-queen piece with a different variant.',
    'Pieces must be in play.',
    'Piece returns to that piece\'s starting point.',
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
    const def = getPieceDef(newDefId);
    if (def.class !== piece.class) throw new Error('Must be same class');
    if (def.id === piece.defId) throw new Error('Must be different variant');
    piece.defId = def.id;
    piece.pos = nearestEmptyAround(ctx.state, piece.startPos) ?? piece.startPos;
    // clear start occupancy conflict already handled
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
    piece.pos = dest;
    return { state: ctx.state, done: true };
  },
});

registerCard({
  id: 'pawn_summon',
  name: 'Pawn Summon',
  description: ['Revive two pawns anywhere in allied territory.'],
  image: '/cards/Pawn_Summon.png',
  targeting: 'empty_allied',
  targetCount: 2,
  play: (ctx, targets) => {
    const pawns = ctx.state.players[ctx.player].graveyard
      .map((g, i) => ({ g, i }))
      .filter((x) => x.g.class === 'pawn');
    if (pawns.length < 1) throw new Error('Need fallen pawns');
    if (targets.length < Math.min(2, pawns.length)) {
      return { state: ctx.state, done: false, message: 'Pick empty allied squares for pawn revive(s)' };
    }
    const count = Math.min(2, pawns.length, targets.length);
    for (let n = 0; n < count; n++) {
      const pos = targets[n] as Coord;
      if (!isAlliedTerritory(ctx.player, pos) || pieceAt(ctx.state, pos)) throw new Error('Invalid square');
      const entry = pawns[n];
      const fallen = ctx.state.players[ctx.player].graveyard.splice(entry.i - n, 1)[0];
      ctx.state.pieces.push({
        id: uid('pawn'),
        defId: fallen.defId,
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
  description: ['Roll 2 dice for a chaotic effect (2–12).'],
  image: '/cards/Gamblers_Gambit.png',
  targeting: 'none',
  play: (ctx) => {
    const roll = 1 + Math.floor(ctx.rng() * 6) + 1 + Math.floor(ctx.rng() * 6);
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
  description: ['Roll 2 dice for a milder chaotic effect (2–12).'],
  image: '/cards/Gamblers_Delight.png',
  targeting: 'none',
  play: (ctx) => {
    const roll = 1 + Math.floor(ctx.rng() * 6) + 1 + Math.floor(ctx.rng() * 6);
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

function delightMessage(roll: number): string {
  if (roll <= 4) return `Rolled ${roll}: Opponent chooses one of your pawns to lose (if any).`;
  if (roll <= 6) return `Rolled ${roll}: Nothing happens.`;
  if (roll <= 9) return `Rolled ${roll}: Choose a non-king type; ALL pieces of that type cannot move for 3 turns.`;
  if (roll <= 11) return `Rolled ${roll}: Pick a type; both players revive one of that type if available.`;
  return `Rolled ${roll}: Gain a Queen variant.`;
}

