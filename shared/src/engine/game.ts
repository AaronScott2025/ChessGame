import type { Color, Coord, GameState, PieceState, PlayerState } from '../types.js';
import { BOARD_SIZE } from '../types.js';
import { DRAFT_ORDER, getPieceDef, PIECES, VARIANTS_BY_CLASS } from '../pieces/index.js';
import type { MoveOption } from '../pieces/helpers.js';
import { buildDeck, drawCard, getCardDef } from '../cards/index.js';
import {
  addEffect,
  backRow,
  barriersAdjacent,
  chebyshev,
  cloneState,
  frontRow,
  getKing,
  hasEffect,
  inBounds,
  isAlliedTerritory,
  log,
  mulberry32,
  nearestEmptyAdjacent,
  nearestEmptyAround,
  opposite,
  pieceAt,
  removeEffects,
  sameCoord,
  shuffleInPlace,
} from '../utils.js';

function emptyPlayer(color: Color, name: string): PlayerState {
  return {
    color,
    connected: false,
    name,
    army: {},
    hand: [],
    discard: [],
    graveyard: [],
    activeSpells: [],
    spellsThisTurn: 0,
    maxSpellsThisTurn: 1,
    openingRedrawUsed: false,
    skipTurns: 0,
  };
}

export function createLobbyState(roomCode: string, seed = Date.now()): GameState {
  return {
    roomCode,
    phase: 'lobby',
    boardSize: BOARD_SIZE,
    pieces: [],
    tokens: [],
    players: {
      white: emptyPlayer('white', 'White'),
      black: emptyPlayer('black', 'Black'),
    },
    turn: 'white',
    turnPhase: 'spell',
    dayNight: 'day',
    turnCount: 0,
    cycleCount: 0,
    deck: [],
    discardPile: [],
    draft: null,
    check: null,
    winner: null,
    history: ['Room created. Waiting for players…'],
    snapshots: [],
    pendingPrompt: null,
    rngSeed: seed,
  };
}

export function startDraft(state: GameState): GameState {
  const next = cloneState(state);
  next.phase = 'draft';
  next.draft = {
    pickingColor: 'white',
    blackChoseFirstPicker: null,
    order: [...DRAFT_ORDER],
    index: 0,
  };
  log(next, 'Draft started — Black chooses who picks first.');
  return next;
}

export function chooseFirstPicker(state: GameState, whitePicksFirst: boolean): GameState {
  if (state.phase !== 'draft' || !state.draft || state.draft.blackChoseFirstPicker != null) {
    throw new Error('Cannot choose first picker now');
  }
  const next = cloneState(state);
  next.draft!.blackChoseFirstPicker = whitePicksFirst;
  next.draft!.pickingColor = whitePicksFirst ? 'white' : 'black';
  log(next, `Black decided ${whitePicksFirst ? 'White' : 'Black'} picks first.`);
  return next;
}

export function draftPick(state: GameState, color: Color, defId: string): GameState {
  if (state.phase !== 'draft' || !state.draft) throw new Error('Not drafting');
  if (state.draft.blackChoseFirstPicker == null) throw new Error('Black must choose who picks first');
  if (state.draft.pickingColor !== color) throw new Error('Not your pick');
  const cls = state.draft.order[state.draft.index];
  const options = VARIANTS_BY_CLASS[cls];
  if (!options.includes(defId)) throw new Error('Invalid variant for this slot');
  const next = cloneState(state);
  next.players[color].army[cls] = defId;
  // opponent picks same class next, then advance
  const other = opposite(color);
  if (!next.players[other].army[cls]) {
    next.draft!.pickingColor = other;
  } else {
    next.draft!.index += 1;
    if (next.draft!.index >= next.draft!.order.length) {
      return finishDraftAndSetup(next);
    }
    next.draft!.pickingColor = next.draft!.blackChoseFirstPicker ? 'white' : 'black';
  }
  log(next, `${color} drafted ${getPieceDef(defId).name}`);
  return next;
}

function finishDraftAndSetup(state: GameState): GameState {
  const next = state;
  next.phase = 'opening_draw';
  next.draft = null;
  next.pieces = spawnArmies(next);
  next.deck = buildDeck(next.rngSeed);
  for (const color of ['white', 'black'] as Color[]) {
    for (let i = 0; i < 3; i++) {
      drawCard(next, color, { avoidRally: true, avoidDupes: true });
    }
  }
  next.pendingPrompt = { type: 'opening_mulligan', color: 'white' };
  log(next, 'Armies placed. Opening hand draw — White mulligan first.');
  return next;
}

function spawnArmies(state: GameState): PieceState[] {
  const pieces: PieceState[] = [];
  for (const color of ['white', 'black'] as Color[]) {
    const army = state.players[color].army;
    const back = backRow(color);
    const front = frontRow(color);
    const pawnId = army.pawn ?? 'pawn';
    // back row: R N W B Q K B W N R
    const backDefs = [
      army.rook ?? 'rook',
      army.knight ?? 'horse',
      army.wildcard ?? 'mimic',
      army.bishop ?? 'bishop',
      army.queen ?? 'queen',
      'king',
      army.bishop ?? 'bishop',
      army.wildcard ?? 'mimic',
      army.knight ?? 'horse',
      army.rook ?? 'rook',
    ];
    backDefs.forEach((defId, col) => {
      const def = getPieceDef(defId);
      const id = `${color}_${defId}_${col}`;
      const piece: PieceState = {
        id,
        defId,
        class: def.class,
        color,
        pos: { row: back, col },
        hasMoved: false,
        startPos: { row: back, col },
        effects: [],
        charges: defId === 'reaper' ? 0 : undefined,
        reviveCount: defId === 'angel' ? 0 : undefined,
      };
      pieces.push(piece);
    });

    // link prince & princess if chosen
    if (army.wildcard === 'prince_princess') {
      const pair = pieces.filter((p) => p.color === color && p.defId === 'prince_princess');
      if (pair.length === 2) {
        pair[0].linkedPieceId = pair[1].id;
        pair[1].linkedPieceId = pair[0].id;
      }
    }

    for (let col = 0; col < BOARD_SIZE; col++) {
      if (pawnId === 'enchanted_pawn' && (col === 0 || col === BOARD_SIZE - 1)) {
        // barriers on sides of frontline instead of pawns
        state.tokens.push({
          id: `${color}_start_barrier_${col}`,
          kind: 'barrier',
          pos: { row: front, col },
          owner: color,
        });
        continue;
      }
      const id = `${color}_pawn_${col}`;
      pieces.push({
        id,
        defId: pawnId,
        class: 'pawn',
        color,
        pos: { row: front, col },
        hasMoved: false,
        startPos: { row: front, col },
        effects: [],
      });
    }
  }
  return pieces;
}

export function openingKeep(state: GameState, color: Color): GameState {
  const next = cloneState(state);
  if (next.pendingPrompt?.type !== 'opening_mulligan' || next.pendingPrompt.color !== color) {
    throw new Error('Not your mulligan');
  }
  if (color === 'white') {
    next.pendingPrompt = { type: 'opening_mulligan', color: 'black' };
  } else {
    next.pendingPrompt = null;
    next.phase = 'playing';
    next.turn = 'white';
    next.turnPhase = 'spell';
    pushSnapshot(next);
    log(next, 'Game start — White to play.');
  }
  return next;
}

export function openingRedraw(state: GameState, color: Color, instanceId: string): GameState {
  const next = cloneState(state);
  const p = next.players[color];
  if (p.openingRedrawUsed) throw new Error('Already used opening redraw');
  if (next.pendingPrompt?.type !== 'opening_mulligan' || next.pendingPrompt.color !== color) {
    throw new Error('Not your mulligan');
  }
  const idx = p.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) throw new Error('Card not in hand');
  const [card] = p.hand.splice(idx, 1);
  next.deck.unshift(card);
  drawCard(next, color, { avoidRally: true, avoidDupes: true });
  p.openingRedrawUsed = true;
  log(next, `${color} redrew one opening card`);
  return next;
}

function pushSnapshot(state: GameState): void {
  const copy = cloneState(state);
  copy.snapshots = [];
  state.snapshots.unshift(JSON.stringify(copy));
  if (state.snapshots.length > 12) state.snapshots.length = 12;
}

export function isSquareAttacked(state: GameState, pos: Coord, byColor: Color): boolean {
  for (const piece of state.pieces) {
    if (piece.color !== byColor) continue;
    const def = PIECES[piece.defId];
    if (!def) continue;
    if (def.canAct && !def.canAct(piece, state)) continue;
    // Angel cannot take
    if (piece.defId === 'angel') continue;
    let moves: MoveOption[] = [];
    try {
      moves = def.getMoves(piece, state);
    } catch {
      continue;
    }
    if (moves.some((m) => sameCoord(m.to, pos) && (m.capture || !pieceAt(state, pos)))) {
      // king attacked if enemy can move onto king square
      if (sameCoord(mFix(mFind(moves, pos)), pos)) return true;
    }
    if (moves.some((m) => sameCoord(m.to, pos))) return true;
  }
  return false;
}

function mFind(moves: MoveOption[], pos: Coord) {
  return moves.find((m) => sameCoord(m.to, pos))!;
}
function mFix(m: MoveOption) {
  return m.to;
}

export function isInCheck(state: GameState, color: Color): boolean {
  const king = getKing(state, color);
  if (!king) return true;
  return isSquareAttacked(state, king.pos, opposite(color));
}

export function listMoves(state: GameState, pieceId: string): MoveOption[] {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) return [];
  const def = getPieceDef(piece.defId);
  if (def.canAct && !def.canAct(piece, state)) return [];
  let moves = def.getMoves(piece, state);

  // Blink return
  const blink = hasEffect(piece, 'blink');
  if (blink?.data?.tokenPos) {
    const tp = blink.data.tokenPos as Coord;
    if (!pieceAt(state, tp)) moves.push({ to: tp, special: 'blink_return' });
  }

  // Portal travel as extra destinations when standing on portal — handled after move in applyMove

  // Filter moves that leave own king in check
  return moves.filter((m) => {
    const trial = cloneState(state);
    const tp = trial.pieces.find((p) => p.id === pieceId)!;
    const occ = pieceAt(trial, m.to);
    if (occ && occ.color !== tp.color) {
      trial.pieces = trial.pieces.filter((p) => p.id !== occ.id);
    }
    if (m.special === 'castle_swap' && m.meta?.withId) {
      const other = trial.pieces.find((p) => p.id === m.meta!.withId)!;
      const tmp = { ...tp.pos };
      tp.pos = { ...other.pos };
      other.pos = tmp;
    } else if (m.special === 'ancient_shuffle' || m.special === 'swap_of_fates') {
      const other = trial.pieces.find((p) => p.id === m.meta!.withId)!;
      const tmp = { ...tp.pos };
      tp.pos = { ...other.pos };
      other.pos = tmp;
    } else if (m.special === 'best_buddy') {
      tp.pos = { ...m.to };
      tp.coOccupantId = m.meta?.withId as string;
    } else if (m.special === 'death_stare') {
      trial.pieces = trial.pieces.filter((p) => !(sameCoord(p.pos, m.to) && p.color !== tp.color));
    } else {
      tp.pos = { ...m.to };
    }
    return !isInCheck(trial, piece.color);
  });
}

export function availableAbilities(state: GameState, pieceId: string): Array<{ id: string; name: string; ready: boolean; hint?: string }> {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) return [];
  const out: Array<{ id: string; name: string; ready: boolean; hint?: string }> = [];

  if (piece.defId === 'gnome') {
    out.push({
      id: 'gadget_deploy',
      name: 'Gadget Deploy',
      ready: !piece.gadgetUsed && (piece.disabledTurns ?? 0) <= 0,
      hint: 'Once per game: place Ice Floor, Spring Board, or Gnome Hole on an adjacent empty tile',
    });
  }
  if (piece.defId === 'wizard') {
    out.push({
      id: 'enchant',
      name: 'Enchant',
      ready: (piece.abilityCooldown ?? 0) <= 0 && (piece.disabledTurns ?? 0) <= 0,
      hint: '+1 movement to an adjacent piece for 2 turns (4-turn cooldown)',
    });
  }
  if (piece.defId === 'angel') {
    const canRevive =
      (piece.reviveCount ?? 0) < 3 &&
      (piece.ritualTurns == null || piece.ritualTurns <= 0) &&
      state.lastMove?.pieceId !== piece.id &&
      (piece.disabledTurns ?? 0) <= 0;
    out.push({
      id: 'revive',
      name: 'Revive Ritual',
      ready: canRevive,
      hint: 'Start a ritual to revive a piece from your graveyard (consumes turn)',
    });
  }
  if (piece.defId === 'enchanted_pawn') {
    const hasBarrier = state.tokens.some((t) => t.kind === 'barrier' && t.owner === piece.color);
    out.push({
      id: 'barrier_shift',
      name: 'Barrier Shift',
      ready: hasBarrier && (piece.disabledTurns ?? 0) <= 0,
      hint: 'Move one of your barriers to an empty allied-territory square (uses turn)',
    });
  }
  return out;
}

export function useAbility(
  state: GameState,
  color: Color,
  pieceId: string,
  abilityId: string,
  targets?: unknown,
): GameState {
  if (state.phase !== 'playing') throw new Error('Not playing');
  if (state.turn !== color) throw new Error('Not your turn');
  if (state.pendingPrompt) throw new Error('Resolve pending prompt first');

  const next = cloneState(state);
  if (next.turnPhase === 'spell') next.turnPhase = 'move';

  const piece = next.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.color !== color) throw new Error('Invalid piece');
  if ((piece.disabledTurns ?? 0) > 0) throw new Error('Piece is disabled');

  const avail = availableAbilities(next, pieceId).find((a) => a.id === abilityId);
  if (!avail?.ready) throw new Error('Ability not available');

  if (abilityId === 'gadget_deploy') {
    if (!targets) {
      next.pendingPrompt = {
        type: 'gadget_choice',
        color,
        pieceId,
        message: 'Choose a gadget: ice_floor, spring_board, or gnome_hole',
      };
      return next;
    }
    const payload = targets as { kind: string; pos: Coord };
    return finishGadgetDeploy(next, color, pieceId, payload.kind, payload.pos);
  }

  if (abilityId === 'enchant') {
    const targetId = targets as string | undefined;
    if (!targetId) {
      next.pendingPrompt = {
        type: 'ability_target',
        color,
        pieceId,
        abilityId: 'enchant',
        message: 'Enchant: click an adjacent allied or enemy piece (not a king)',
      };
      return next;
    }
    return finishWizardEnchant(next, color, pieceId, targetId);
  }

  if (abilityId === 'revive') {
    const defId = targets as string | undefined;
    if (!defId) {
      next.pendingPrompt = {
        type: 'ability_target',
        color,
        pieceId,
        abilityId: 'revive',
        message: 'Revive: choose a piece from your graveyard',
      };
      return next;
    }
    return finishAngelReviveStart(next, color, pieceId, defId);
  }

  if (abilityId === 'barrier_shift') {
    const payload = targets as { from?: Coord; to?: Coord } | undefined;
    if (payload?.from && payload?.to) {
      return finishBarrierShift(next, color, pieceId, payload.from, payload.to);
    }
    if (payload?.from) {
      const token = next.tokens.find(
        (t) => t.kind === 'barrier' && t.owner === color && sameCoord(t.pos, payload.from!),
      );
      if (!token) throw new Error('No barrier there');
      next.pendingPrompt = {
        type: 'ability_target',
        color,
        pieceId,
        abilityId: 'barrier_shift',
        message: 'Barrier Shift: click an empty square in allied territory',
        selected: [payload.from],
      };
      return next;
    }
    next.pendingPrompt = {
      type: 'ability_target',
      color,
      pieceId,
      abilityId: 'barrier_shift',
      message: 'Barrier Shift: click one of your barriers, then an empty allied square',
      selected: [],
    };
    return next;
  }

  throw new Error('Unknown ability');
}

function emptyAdjacentCount(state: GameState, pos: Coord): number {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const p = { row: pos.row + dr, col: pos.col + dc };
      if (!inBounds(p)) continue;
      if (!pieceAt(state, p)) n += 1;
    }
  }
  return n;
}

function finishGadgetDeploy(
  state: GameState,
  color: Color,
  pieceId: string,
  kind: string,
  pos: Coord,
): GameState {
  const piece = state.pieces.find((p) => p.id === pieceId)!;
  if (!['ice_floor', 'spring_board', 'gnome_hole'].includes(kind)) throw new Error('Invalid gadget');
  if (chebyshev(piece.pos, pos) !== 1) throw new Error('Gadget must be adjacent');
  if (!inBounds(pos) || pieceAt(state, pos)) throw new Error('Target square must be empty');
  if (state.tokens.some((t) => sameCoord(t.pos, pos))) throw new Error('Square occupied by token');

  const homes = state.pieces
    .filter((p) => p.color === color && p.defId === 'gnome')
    .map((p) => ({ ...p.startPos }));

  state.tokens.push({
    id: `gadget_${color}_${Date.now()}`,
    kind,
    pos: { ...pos },
    owner: color,
    data: { homes },
  });
  piece.gadgetUsed = true;
  state.pendingPrompt = null;
  log(state, `${color} Gnome deployed ${kind}`);
  if (isInCheck(state, opposite(color))) {
    state.check = opposite(color);
    return endTurn(state, color, true);
  }
  return endTurn(state, color, false);
}

function finishWizardEnchant(state: GameState, color: Color, pieceId: string, targetId: string): GameState {
  const wizard = state.pieces.find((p) => p.id === pieceId)!;
  const target = state.pieces.find((p) => p.id === targetId);
  if (!target) throw new Error('Invalid target');
  if (target.class === 'king') throw new Error('Cannot enchant a king');
  if (chebyshev(wizard.pos, target.pos) !== 1) throw new Error('Target must be adjacent');
  addEffect(target, {
    id: `wiz_ench_${target.id}_${Date.now()}`,
    kind: 'wizard_enchant',
    turnsRemaining: 2,
  });
  wizard.abilityCooldown = 4;
  state.pendingPrompt = null;
  log(state, `Wizard enchanted ${target.defId} (+1 move, 2 turns)`);
  if (isInCheck(state, opposite(color))) {
    state.check = opposite(color);
    return endTurn(state, color, true);
  }
  return endTurn(state, color, false);
}

function finishAngelReviveStart(state: GameState, color: Color, pieceId: string, defId: string): GameState {
  const angel = state.pieces.find((p) => p.id === pieceId)!;
  if (state.lastMove?.pieceId === angel.id) throw new Error('Cannot revive after moving this Angel');
  const gy = state.players[color].graveyard;
  const idx = gy.findIndex((g) => g.defId === defId);
  if (idx < 0) throw new Error('Piece not in graveyard');
  if (defId === 'angel') throw new Error('Angel cannot revive angels');

  const emptyAdj = emptyAdjacentCount(state, angel.pos);
  const duration = Math.max(1, 10 - emptyAdj);
  angel.ritualTurns = duration;
  angel.ritualTargetDefId = defId;
  state.pendingPrompt = null;
  log(state, `Angel began revive ritual for ${defId} (${duration} turns)`);
  // Revive consumes the turn (cannot move then revive; ritual start ends turn)
  if (isInCheck(state, opposite(color))) {
    state.check = opposite(color);
    return endTurn(state, color, true);
  }
  return endTurn(state, color, false);
}

function completeAngelRevive(state: GameState, angel: PieceState): void {
  const defId = angel.ritualTargetDefId;
  angel.ritualTurns = undefined;
  angel.ritualTargetDefId = undefined;
  if (!defId) return;

  const gy = state.players[angel.color].graveyard;
  const idx = gy.findIndex((g) => g.defId === defId);
  if (idx < 0) {
    log(state, 'Angel revive failed — piece no longer in graveyard');
    return;
  }
  const spot = nearestEmptyAdjacent(state, angel.pos);
  if (!spot) {
    log(state, 'Angel revive failed — no adjacent space');
    return;
  }
  const [entry] = gy.splice(idx, 1);
  const def = getPieceDef(entry.defId);
  state.pieces.push({
    id: `revived_${angel.color}_${entry.defId}_${Date.now()}`,
    defId: entry.defId,
    class: def.class,
    color: angel.color,
    pos: spot,
    hasMoved: false,
    startPos: spot,
    effects: [],
    charges: entry.defId === 'reaper' ? 0 : undefined,
    reviveCount: entry.defId === 'angel' ? 0 : undefined,
  });
  angel.reviveCount = (angel.reviveCount ?? 0) + 1;
  log(state, `Angel revived ${entry.defId}`);
  if ((angel.reviveCount ?? 0) >= 3) {
    removePiece(state, angel, opposite(angel.color));
    log(state, 'Angel perished after 3 revives');
  }
}

function finishBarrierShift(
  state: GameState,
  color: Color,
  pieceId: string,
  from: Coord,
  to: Coord,
): GameState {
  const actor = state.pieces.find((p) => p.id === pieceId);
  if (!actor || actor.color !== color || actor.defId !== 'enchanted_pawn') {
    throw new Error('Barrier Shift requires an Enchanted Pawn');
  }
  const token = state.tokens.find((t) => t.kind === 'barrier' && t.owner === color && sameCoord(t.pos, from));
  if (!token) throw new Error('No barrier there');
  if (!isAlliedTerritory(color, to)) throw new Error('Must place in allied territory');
  if (pieceAt(state, to) || state.tokens.some((t) => sameCoord(t.pos, to) && t.id !== token.id)) {
    throw new Error('Destination occupied');
  }
  // Temporarily move off to check adjacency against other barriers
  const old = { ...token.pos };
  token.pos = { row: -10, col: -10 };
  if (barriersAdjacent(state, to)) {
    token.pos = old;
    throw new Error('Barriers cannot be adjacent');
  }
  token.pos = { ...to };
  state.pendingPrompt = null;
  log(state, `${color} shifted a barrier`);
  if (isInCheck(state, opposite(color))) {
    state.check = opposite(color);
    return endTurn(state, color, true);
  }
  return endTurn(state, color, false);
}

function resolveGadgetLanding(state: GameState, piece: PieceState, from: Coord, to: Coord, color: Color): boolean {
  // returns true if a prompt was opened (turn should not end yet)
  const tokens = state.tokens.filter((t) => sameCoord(t.pos, to));
  for (const t of tokens) {
    if (t.kind === 'ice_floor') {
      const dr = Math.sign(to.row - from.row);
      const dc = Math.sign(to.col - from.col);
      if (dr === 0 && dc === 0) continue;
      const slide = { row: to.row + dr, col: to.col + dc };
      if (!inBounds(slide)) continue;
      if (state.tokens.some((x) => x.kind === 'barrier' && sameCoord(x.pos, slide))) continue;
      const occ = pieceAt(state, slide);
      if (occ) {
        if (occ.color === piece.color) continue;
        removePiece(state, occ, color);
      }
      piece.pos = slide;
      log(state, `${piece.defId} slid on ice`);
    }
    if (t.kind === 'spring_board') {
      state.pendingPrompt = {
        type: 'spring_bounce',
        color,
        pieceId: piece.id,
        from: { ...piece.pos },
        message: 'Spring Board: choose bounce direction (click a square 2 steps away in a straight line)',
      };
      return true;
    }
    if (t.kind === 'gnome_hole' && piece.color === t.owner) {
      const homes = (t.data?.homes as Coord[] | undefined) ?? [];
      const options = homes.filter(
        (h) => inBounds(h) && !pieceAt(state, h) && !state.tokens.some((x) => x.kind === 'barrier' && sameCoord(x.pos, h)),
      );
      if (options.length) {
        state.pendingPrompt = {
          type: 'gnome_hole_travel',
          color,
          pieceId: piece.id,
          options,
          message: 'Gnome Hole: click a gnome starting square to travel (or skip via confirm elsewhere)',
        };
        return true;
      }
    }
  }
  return false;
}

export function applyMove(
  state: GameState,
  color: Color,
  pieceId: string,
  to: Coord,
  meta?: Record<string, unknown>,
): GameState {
  if (state.phase !== 'playing') throw new Error('Not playing');
  if (state.turn !== color) throw new Error('Not your turn');
  if (state.turnPhase !== 'move' && state.turnPhase !== 'spell') {
    // allow move after skipping spell; turnPhase should be move
  }
  if (state.pendingPrompt) throw new Error('Resolve pending prompt first');

  const next = cloneState(state);
  if (next.turnPhase === 'spell') {
    // implicit skip spell
    next.turnPhase = 'move';
  }
  const piece = next.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.color !== color) throw new Error('Invalid piece');
  const legal = listMoves(next, pieceId);
  const move = legal.find((m) => sameCoord(m.to, to) && (!meta?.special || m.special === meta.special));
  if (!move) throw new Error('Illegal move');

  const from = { ...piece.pos };

  // cancel recall if moves
  if (hasEffect(piece, 'recall')) removeEffects(piece, 'recall');
  // enchant fails if moves
  if (hasEffect(piece, 'enchant_ritual')) removeEffects(piece, 'enchant_ritual');

  // blink mark
  const blink = hasEffect(piece, 'blink');
  if (blink && move.special !== 'blink_return') {
    next.tokens = next.tokens.filter((t) => !(t.kind === 'blink' && t.owner === color));
    next.tokens.push({ id: `blink_${color}`, kind: 'blink', pos: from, owner: color });
    blink.data = { tokenPos: from };
  }
  if (move.special === 'blink_return') {
    next.tokens = next.tokens.filter((t) => !(t.kind === 'blink' && t.owner === color));
    if (blink) blink.data = { tokenPos: null };
  }

  // cancel blink token if someone steps on it
  next.tokens = next.tokens.filter((t) => !(t.kind === 'blink' && sameCoord(t.pos, to)));

  let captured: PieceState | undefined;

  if (move.special === 'castle_swap' && move.meta?.withId) {
    const other = next.pieces.find((p) => p.id === move.meta!.withId)!;
    const tmp = { ...piece.pos };
    piece.pos = { ...other.pos };
    other.pos = tmp;
  } else if (
    (move.special === 'ancient_shuffle' || move.special === 'swap_of_fates') &&
    move.meta?.withId
  ) {
    const other = next.pieces.find((p) => p.id === move.meta!.withId)!;
    const tmp = { ...piece.pos };
    piece.pos = { ...other.pos };
    other.pos = tmp;
    if (move.special === 'ancient_shuffle') log(next, 'Ancient Shuffle!');
    if (move.special === 'swap_of_fates') log(next, 'Swap of Fates!');
  } else if (move.special === 'best_buddy') {
    // clear previous buddy links involving this pig
    for (const p of next.pieces) {
      if (p.coOccupantId === piece.id) p.coOccupantId = undefined;
    }
    piece.pos = { ...to };
    piece.coOccupantId = move.meta?.withId as string;
  } else if (move.special === 'death_stare') {
    captured = pieceAt(next, to);
  } else {
    captured = pieceAt(next, to);
    // pig co-occupy capture
    if (captured) {
      const pig = next.pieces.find(
        (p) => p.defId === 'pig' && p.coOccupantId === captured!.id && sameCoord(p.pos, to),
      );
      if (pig) {
        removePiece(next, pig, color);
        (next.players[color] as PlayerState & { bonusTurns?: number }).bonusTurns =
          ((next.players[color] as PlayerState & { bonusTurns?: number }).bonusTurns ?? 0) + 3;
      }
    }
    // leaving a shared tile clears buddy
    if (piece.coOccupantId) piece.coOccupantId = undefined;
    for (const p of next.pieces) {
      if (p.coOccupantId === piece.id) p.coOccupantId = undefined;
    }
    piece.pos = { ...to };
  }

  if (captured && captured.color !== color) {
    // fortify vs pawn/knight
    if (hasEffect(captured, 'fortify') && (piece.class === 'pawn' || piece.class === 'knight')) {
      throw new Error('Target is fortified against pawns/knights');
    }
    if (hasEffect(captured, 'invincible') || hasEffect(captured, 'pause')) {
      throw new Error('Target is invincible');
    }

    // ScamMan fraud
    if (captured.defId === 'scamman' && piece.class !== 'pawn') {
      piece.defId = 'pawn';
      piece.class = 'pawn';
      log(next, `${piece.id} was scammed into a pawn!`);
    }

    // Demon convert
    if (piece.defId === 'demon') {
      captured.color = color;
      next.pieces = next.pieces.filter((p) => p.id !== captured!.id);
      const converted = {
        ...captured,
        color,
        id: `conv_${captured.id}`,
        effects: [...captured.effects, { id: `life_shard_${Date.now()}`, kind: 'converted' }],
      };
      const park = nearestEmptyAround(next, to);
      if (park) {
        converted.pos = park;
        next.pieces.push(converted);
      }
      captured = undefined;
    } else {
      const victimSnapshot = { ...captured };
      removePiece(next, captured, color);

      // Reaper charge consume on capture
      if (piece.defId === 'reaper' && (piece.charges ?? 0) > 0) {
        const charges = piece.charges ?? 0;
        // Soul Lock (3+): night capture revives victim as ally on reaper start
        if (charges >= 3 && next.dayNight === 'night') {
          const spot = nearestEmptyAround(next, piece.startPos);
          if (spot) {
            const def = getPieceDef(victimSnapshot.defId);
            next.pieces.push({
              id: `soul_lock_${Date.now()}`,
              defId: victimSnapshot.defId,
              class: def.class,
              color,
              pos: spot,
              hasMoved: false,
              startPos: spot,
              effects: [{ id: `sl_${Date.now()}`, kind: 'soul_locked' }],
            });
            // remove from enemy graveyard if present
            const egy = next.players[opposite(color)].graveyard;
            const gi = egy.findIndex((g) => g.defId === victimSnapshot.defId);
            if (gi >= 0) egy.splice(gi, 1);
            log(next, 'Soul Lock — captive joins your ranks');
          }
        }
        // World Shatterer (5+): wipe class at night
        if (charges >= 5 && next.dayNight === 'night') {
          const cls = victimSnapshot.class;
          const victims = next.pieces.filter((p) => p.color !== color && p.class === cls);
          for (const v of [...victims]) removePiece(next, v, color);
          log(next, `World Shatterer — ${cls}s annihilated`);
        }
        const disable = Math.floor(charges * 2.5);
        piece.charges = 0;
        piece.disabledTurns = disable;
        const home = nearestEmptyAround(next, piece.startPos);
        if (home) piece.pos = home;
        log(next, `Reaper spent ${charges} charges (disabled ${disable} turns)`);
      }
    }

    const hadBloodlust = Boolean(piece.bloodlust);
    if (piece.defId === 'snake') {
      if (hadBloodlust) piece.bloodlust = false;
      piece.bloodlust = true;
    }
  } else if (piece.defId === 'snake' && piece.bloodlust) {
    piece.bloodlust = false;
  }

  // Prince & Princess mirror
  if (piece.defId === 'prince_princess' && piece.linkedPieceId) {
    const other = next.pieces.find((p) => p.id === piece.linkedPieceId);
    if (other) {
      const dr = to.row - from.row;
      const dc = to.col - from.col;
      // mirror horizontal: if one moves left, other moves right
      const mirror = { row: other.pos.row + dr, col: other.pos.col - dc };
      if (!inBounds(mirror)) throw new Error('Mirror move illegal');
      const occ = pieceAt(next, mirror);
      if (occ && occ.color === color) throw new Error('Mirror blocked');
      if (occ && occ.color !== color) removePiece(next, occ, color);
      other.pos = mirror;
    }
  }

  // True love: if one dies both die — handled in removePiece

  piece.hasMoved = true;
  let copiedDefId: string | undefined;
  if (piece.defId === 'mimic' && next.lastMove && next.lastMove.color !== color) {
    copiedDefId =
      next.lastMove.defId === 'mimic'
        ? (next.lastMove as { copiedDefId?: string }).copiedDefId
        : next.lastMove.defId;
  }
  next.lastMove = {
    pieceId,
    from,
    to: { ...piece.pos },
    capturedId: captured?.id,
    defId: piece.defId,
    color,
    ...(copiedDefId ? { copiedDefId } : {}),
  } as GameState['lastMove'];

  // Echo
  const echo = hasEffect(piece, 'echo_armed');
  if (echo) {
    addEchoOption(next, piece, from, to);
  }

  // Gadget tile effects (ice / spring / gnome hole)
  if (
    move.special !== 'castle_swap' &&
    move.special !== 'ancient_shuffle' &&
    move.special !== 'swap_of_fates' &&
    move.special !== 'death_stare'
  ) {
    const waiting = resolveGadgetLanding(next, piece, from, piece.pos, color);
    if (waiting) {
      log(next, `${color} triggered a gadget`);
      return next;
    }
  }

  // Promotion
  const promoteRow = color === 'white' ? 0 : BOARD_SIZE - 1;
  if (piece.class === 'pawn' && piece.pos.row === promoteRow) {
    const opts = getPieceDef(piece.defId).promoteOptions ?? ['queen'];
    next.pendingPrompt = { type: 'promote', color, pieceId: piece.id, options: opts };
    log(next, `${color} pawn awaiting promotion`);
    return next;
  }

  // Check ends turn immediately
  const enemy = opposite(color);
  if (isInCheck(next, enemy)) {
    next.check = enemy;
    log(next, `${enemy} is in check — turn ends immediately`);
    return endTurn(next, color, true);
  }
  next.check = isInCheck(next, color) ? color : null;

  return endTurn(next, color, false);
}

function addEchoOption(state: GameState, piece: PieceState, from: Coord, to: Coord): void {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const echoTo = { row: to.row + dr, col: to.col + dc };
  if (!inBounds(echoTo) || pieceAt(state, echoTo)) {
    removeEffects(piece, 'echo_armed');
    return;
  }
  // auto-apply echo non-capture
  piece.pos = echoTo;
  removeEffects(piece, 'echo_armed');
  log(state, `Echo repeated move for ${piece.defId}`);
}

function removePiece(state: GameState, piece: PieceState, byColor: Color): void {
  // enchant fails if ally taken
  for (const p of state.pieces) {
    const ench = hasEffect(p, 'enchant_ritual');
    if (ench && p.color === piece.color) removeEffects(p, 'enchant_ritual');
  }
  state.pieces = state.pieces.filter((p) => p.id !== piece.id);
  state.players[piece.color].graveyard.push({ defId: piece.defId, class: piece.class });

  // prince princess true love
  if (piece.defId === 'prince_princess' && piece.linkedPieceId) {
    const other = state.pieces.find((p) => p.id === piece.linkedPieceId);
    if (other) {
      state.pieces = state.pieces.filter((p) => p.id !== other.id);
      state.players[other.color].graveyard.push({ defId: other.defId, class: other.class });
      log(state, 'True Love\'s Gambit — both fall');
    }
  }

  // win check
  if (piece.class === 'king') {
    state.phase = 'ended';
    state.winner = byColor;
    state.winReason = 'King captured';
  }
  void isAlliedTerritory;
}

export function skipSpell(state: GameState, color: Color): GameState {
  if (state.turn !== color || state.turnPhase !== 'spell') throw new Error('Cannot skip spell now');
  const next = cloneState(state);
  next.turnPhase = 'move';
  return next;
}

export function playCard(state: GameState, color: Color, instanceId: string, targets: unknown[] = []): GameState {
  const next = cloneState(state);
  const player = next.players[color];
  const card = player.hand.find((c) => c.instanceId === instanceId);
  if (!card) throw new Error('Card not in hand');
  const def = getCardDef(card.defId);

  const isOppTurn = next.turn !== color;
  if (isOppTurn && !def.playOnOpponentTurn) throw new Error('Cannot play that on opponent turn');
  if (!isOppTurn && next.turnPhase !== 'spell') {
    throw new Error('Spell phase only');
  }
  if (!isOppTurn && player.spellsThisTurn >= player.maxSpellsThisTurn) {
    throw new Error('Already cast a spell this turn');
  }

  // Cannot cast abilities on enemy king — enforced per-card

  const rng = mulberry32(next.rngSeed + next.turnCount * 31);
  const result = def.play({ state: next, player: color, card, rng }, targets);

  if (!result.done) {
    if (!next.pendingPrompt) {
      next.pendingPrompt = {
        type: 'card_target',
        color,
        cardInstanceId: instanceId,
        cardDefId: card.defId,
        step: targets.length,
        message: result.message ?? `Targeting ${def.name}`,
        selected: targets,
      };
    }
    return next;
  }

  // consume
  const idx = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx >= 0) {
    const [used] = player.hand.splice(idx, 1);
    next.discardPile.push(used);
  }
  player.spellsThisTurn += 1;
  player.lastPlayedCardDefId = def.id;
  log(next, `${color} played ${def.name}`);

  // One spell per turn (unless an effect raised the cap): leave spell phase when spent
  if (!isOppTurn && player.spellsThisTurn >= player.maxSpellsThisTurn) {
    next.turnPhase = 'move';
  }

  if (isInCheck(next, opposite(color))) {
    next.check = opposite(color);
    log(next, 'Check from spell — turn passes');
    return endTurn(next, next.turn, true);
  }
  return next;
}

export function resolvePrompt(state: GameState, color: Color, payload: unknown): GameState {
  const next = cloneState(state);
  const prompt = next.pendingPrompt;
  if (!prompt) throw new Error('No prompt');

  if (prompt.type === 'opening_mulligan') {
    throw new Error('Use keep/redraw actions');
  }

  if (prompt.type === 'promote') {
    if (prompt.color !== color) throw new Error('Not your prompt');
    const defId = payload as string;
    if (!prompt.options.includes(defId)) throw new Error('Invalid promotion');
    const piece = next.pieces.find((p) => p.id === prompt.pieceId)!;
    const def = getPieceDef(defId);
    piece.defId = def.id;
    piece.class = def.class;
    next.pendingPrompt = null;
    if (isInCheck(next, opposite(color))) return endTurn(next, color, true);
    return endTurn(next, color, false);
  }

  if (prompt.type === 'card_target') {
    if (prompt.color !== color) throw new Error('Not your prompt');
    const selected = [...prompt.selected, payload];
    next.pendingPrompt = null;
    return playCard(next, color, prompt.cardInstanceId, selected);
  }

  if (prompt.type === 'gambler_choice') {
    if (prompt.color !== color && prompt.cardDefId === 'gamblers_gambit') {
      // some rolls need opponent — handled via payload shape
    }
    next.pendingPrompt = null;
    applyGambler(next, prompt.cardDefId, prompt.roll, color, payload);
    const inst = (prompt as { _instanceId?: string })._instanceId;
    if (inst) {
      const idx = next.players[prompt.color].hand.findIndex((c) => c.instanceId === inst);
      if (idx >= 0) next.discardPile.push(...next.players[prompt.color].hand.splice(idx, 1));
      next.players[prompt.color].spellsThisTurn += 1;
      if (
        next.turn === prompt.color &&
        next.players[prompt.color].spellsThisTurn >= next.players[prompt.color].maxSpellsThisTurn
      ) {
        next.turnPhase = 'move';
      }
    }
    return next;
  }

  if (prompt.type === 'discard_to_draw') {
    if (prompt.color !== color) throw new Error('Not your prompt');
    const instanceId = payload as string;
    const idx = next.players[color].hand.findIndex((c) => c.instanceId === instanceId);
    if (idx >= 0) next.discardPile.push(...next.players[color].hand.splice(idx, 1));
    next.pendingPrompt = null;
    drawCard(next, color);
    return next;
  }

  if (prompt.type === 'gadget_choice') {
    if (prompt.color !== color) throw new Error('Not your prompt');
    const data = payload as { kind: string; pos: Coord };
    next.pendingPrompt = null;
    return finishGadgetDeploy(next, color, prompt.pieceId, data.kind, data.pos);
  }

  if (prompt.type === 'ability_target') {
    if (prompt.color !== color) throw new Error('Not your prompt');
    if (prompt.abilityId === 'enchant') {
      next.pendingPrompt = null;
      return finishWizardEnchant(next, color, prompt.pieceId, payload as string);
    }
    if (prompt.abilityId === 'revive') {
      next.pendingPrompt = null;
      return finishAngelReviveStart(next, color, prompt.pieceId, payload as string);
    }
    if (prompt.abilityId === 'barrier_shift') {
      const selected = [...(prompt.selected ?? []), payload];
      if (selected.length < 2) {
        next.pendingPrompt = {
          ...prompt,
          selected,
          message: 'Barrier Shift: now click destination (empty allied square)',
        };
        return next;
      }
      next.pendingPrompt = null;
      return finishBarrierShift(
        next,
        color,
        prompt.pieceId,
        selected[0] as Coord,
        selected[1] as Coord,
      );
    }
  }

  if (prompt.type === 'spring_bounce') {
    if (prompt.color !== color) throw new Error('Not your prompt');
    const dest = payload as Coord;
    const piece = next.pieces.find((p) => p.id === prompt.pieceId);
    if (!piece) throw new Error('Piece gone');
    const dr = dest.row - prompt.from.row;
    const dc = dest.col - prompt.from.col;
    const orth = (Math.abs(dr) === 2 && dc === 0) || (dr === 0 && Math.abs(dc) === 2);
    const diag = Math.abs(dr) === 2 && Math.abs(dc) === 2;
    if (!orth && !diag) throw new Error('Bounce must be exactly 2 tiles in a chosen direction');
    if (!inBounds(dest)) throw new Error('Out of bounds');
    const occ = pieceAt(next, dest);
    if (occ) removePiece(next, occ, color);
    piece.pos = { ...dest };
    next.pendingPrompt = null;
    log(next, 'Spring Board bounce!');
    if (isInCheck(next, opposite(color))) return endTurn(next, color, true);
    return endTurn(next, color, false);
  }

  if (prompt.type === 'gnome_hole_travel') {
    if (prompt.color !== color) throw new Error('Not your prompt');
    if (payload === null || payload === 'skip') {
      next.pendingPrompt = null;
      if (isInCheck(next, opposite(color))) return endTurn(next, color, true);
      return endTurn(next, color, false);
    }
    const dest = payload as Coord;
    if (!prompt.options.some((o) => sameCoord(o, dest))) throw new Error('Invalid gnome hole destination');
    const piece = next.pieces.find((p) => p.id === prompt.pieceId);
    if (!piece) throw new Error('Piece gone');
    if (pieceAt(next, dest)) throw new Error('Occupied');
    piece.pos = { ...dest };
    next.pendingPrompt = null;
    log(next, 'Traveled through Gnome Hole');
    if (isInCheck(next, opposite(color))) return endTurn(next, color, true);
    return endTurn(next, color, false);
  }

  next.pendingPrompt = null;
  return next;
}

function applyGambler(
  state: GameState,
  cardDefId: string,
  roll: number,
  actor: Color,
  payload: unknown,
): void {
  if (cardDefId === 'gamblers_gambit') {
    if (roll <= 4) {
      const pieceId = payload as string;
      const piece = state.pieces.find((p) => p.id === pieceId && p.color === actor);
      if (!piece || piece.class === 'king' || piece.class === 'queen') throw new Error('Invalid loss');
      removePiece(state, piece, opposite(actor));
    } else if (roll <= 6) {
      state.players[actor].skipTurns += 1;
    } else if (roll <= 9) {
      const cls = payload as string;
      for (const p of state.pieces) {
        if (p.color !== actor && p.class === cls) {
          p.effects.push({ id: `imm_${p.id}`, kind: 'immobilized', turnsRemaining: 2 });
        }
      }
    } else if (roll === 10) {
      // opponent revive — payload {idx, pos}
    } else if (roll === 11) {
      // self revive
    } else if (roll === 12) {
      const spot = nearestEmptyAround(state, {
        row: frontRow(actor),
        col: 4,
      });
      if (spot) {
        state.pieces.push({
          id: `bonus_queen_${actor}`,
          defId: 'queen',
          class: 'queen',
          color: actor,
          pos: spot,
          hasMoved: false,
          startPos: spot,
          effects: [],
        });
      }
    }
  } else {
    // delight
    if (roll <= 4) {
      const pieceId = payload as string | null;
      if (pieceId) {
        const piece = state.pieces.find((p) => p.id === pieceId && p.color === actor && p.class === 'pawn');
        if (piece) removePiece(state, piece, opposite(actor));
      }
    } else if (roll <= 6) {
      log(state, 'Gambler\'s Delight: nothing happens');
    } else if (roll <= 9) {
      const cls = payload as string;
      for (const p of state.pieces) {
        if (p.class === cls && p.class !== 'king') {
          p.effects.push({ id: `imm_${p.id}`, kind: 'immobilized', turnsRemaining: 3 });
        }
      }
    } else if (roll === 12) {
      const spot = nearestEmptyAround(state, { row: frontRow(actor), col: 5 });
      if (spot) {
        state.pieces.push({
          id: `bonus_queen2_${actor}`,
          defId: 'angel',
          class: 'queen',
          color: actor,
          pos: spot,
          hasMoved: false,
          startPos: spot,
          effects: [],
          reviveCount: 0,
        });
      }
    }
  }
}

export function endTurn(state: GameState, color: Color, fromCheck: boolean): GameState {
  const next = state;
  tickEffectsOnTurnEnd(next, color);

  next.players[color].spellsThisTurn = 0;
  next.players[color].maxSpellsThisTurn = 1;

  // doublecast activation
  const king = getKing(next, color);
  if (king) {
    const pending = hasEffect(king, 'doublecast_pending');
    if (pending) {
      removeEffects(king, 'doublecast_pending');
      // grant to next own turn — mark ready
      king.effects.push({ id: `dc_ready`, kind: 'doublecast_ready', turnsRemaining: 2 });
    }
    const ready = hasEffect(king, 'doublecast_ready');
    if (ready && next.turn === color) {
      // applied at start
    }
  }

  next.turnCount += 1;

  // Day/night: every 5 turn cycles (both players) switch
  // cycleCount increments when black finishes (a full mutual turn)
  if (color === 'black' || (color === 'white' && fromCheck && next.turn === 'white')) {
    // increment cycle when a full white+black completed; approximate: each endTurn from black
  }
  if (color === 'black') {
    next.cycleCount += 1;
    if (next.cycleCount % 5 === 0) {
      next.dayNight = next.dayNight === 'day' ? 'night' : 'day';
      log(next, `It is now ${next.dayNight}`);
      if (next.dayNight === 'day') {
        // first day of cycle both draw
        for (const c of ['white', 'black'] as Color[]) {
          tryDrawWithHandLimit(next, c);
        }
      }
      // reaper gains charge at night if alive; ghosts unlock permanently
      if (next.dayNight === 'night') {
        for (const p of next.pieces) {
          if (p.defId === 'reaper' && (p.disabledTurns ?? 0) <= 0) {
            p.charges = (p.charges ?? 0) + 1;
          }
          if (p.defId === 'ghost' && !hasEffect(p, 'ghost_unlocked')) {
            addEffect(p, { id: `ghost_unlock_${p.id}`, kind: 'ghost_unlocked' });
          }
        }
      }
    }
    if (next.cycleCount % 10 === 0) {
      for (const c of ['white', 'black'] as Color[]) tryDrawWithHandLimit(next, c);
    }
  }

  let nextColor = opposite(color);
  // skip turns
  while (next.players[nextColor].skipTurns > 0) {
    next.players[nextColor].skipTurns -= 1;
    log(next, `${nextColor}'s turn skipped`);
    nextColor = opposite(nextColor);
  }

  // bonus turns from pig
  const bonus = (next.players[color] as PlayerState & { bonusTurns?: number }).bonusTurns ?? 0;
  if (bonus > 0 && !fromCheck) {
    (next.players[color] as PlayerState & { bonusTurns?: number }).bonusTurns = bonus - 1;
    nextColor = color;
    log(next, `${color} continues (Best Buddy bonus turn)`);
  }

  next.turn = nextColor;
  next.turnPhase = 'spell';
  next.players[nextColor].maxSpellsThisTurn = 1;

  pushSnapshot(next);

  // checkmate-ish: if no moves and in check
  if (isInCheck(next, nextColor)) {
    next.check = nextColor;
    const hasAny = next.pieces.some((p) => p.color === nextColor && listMoves(next, p.id).length > 0);
    if (!hasAny) {
      next.phase = 'ended';
      next.winner = opposite(nextColor);
      next.winReason = 'Checkmate';
    }
  } else {
    next.check = null;
  }

  return next;
}

function tryDrawWithHandLimit(state: GameState, color: Color): void {
  const p = state.players[color];
  if (p.hand.length >= 5) {
    state.pendingPrompt = {
      type: 'discard_to_draw',
      color,
      message: 'Hand full — discard a card to draw',
    };
    return;
  }
  drawCard(state, color);
}

function tickEffectsOnTurnEnd(state: GameState, color: Color): void {
  for (const piece of state.pieces) {
    if ((piece.disabledTurns ?? 0) > 0 && piece.color === color) {
      piece.disabledTurns! -= 1;
    }
    if ((piece.abilityCooldown ?? 0) > 0 && piece.color === color) {
      piece.abilityCooldown! -= 1;
    }
    // Angel revive ritual countdown
    if (piece.defId === 'angel' && piece.color === color && (piece.ritualTurns ?? 0) > 0) {
      piece.ritualTurns! -= 1;
      if (piece.ritualTurns! <= 0) {
        completeAngelRevive(state, piece);
      }
    }
    // speed plus pending
    for (const e of [...piece.effects]) {
      if (e.turnsRemaining == null) continue;
      // decrement on owner turn for allied effects
      if (piece.color === color || e.kind === 'pause' || e.kind === 'immobilized' || e.kind === 'frozen' || e.kind === 'wizard_enchant') {
        e.turnsRemaining -= 1;
        if (e.turnsRemaining <= 0) {
          if (e.kind === 'speed_plus_pending') {
            removeEffects(piece, 'speed_plus_pending');
            piece.effects.push({
              id: `sp_${piece.id}`,
              kind: 'speed_plus',
              turnsRemaining: Number(e.data?.duration ?? 8),
            });
          } else if (e.kind === 'movement_plus_pending') {
            removeEffects(piece, 'movement_plus_pending');
            piece.effects.push({
              id: `mp_${piece.id}`,
              kind: 'mathematical',
            });
          } else if (e.kind === 'enchant_ritual') {
            // success
            piece.defId = 'queen';
            piece.class = 'queen';
            removeEffects(piece, 'enchant_ritual');
            log(state, `${piece.id} enchantment completed → Queen`);
          } else {
            removeEffects(piece, e.kind);
          }
        }
      }
    }
    // recall idle
    const recall = hasEffect(piece, 'recall');
    if (recall && piece.color === color) {
      const idle = Number(recall.data?.idleTurns ?? 0) + 1;
      recall.data = { idleTurns: idle };
      if (idle >= 2) {
        const dest = nearestEmptyAround(state, piece.startPos);
        if (dest) piece.pos = dest;
        removeEffects(piece, 'recall');
        log(state, `${piece.defId} recalled home`);
      }
    }
  }

  // barriers tick
  for (const t of state.tokens) {
    if (t.kind === 'barrier' && t.turnsRemaining != null && t.owner === color) {
      t.turnsRemaining -= 1;
    }
  }
  state.tokens = state.tokens.filter((t) => t.turnsRemaining == null || t.turnsRemaining > 0);
}

export function publicState(state: GameState, viewer: Color | null): GameState {
  const view = cloneState(state);
  if (!viewer) return view;
  // hide opponent hand details? show count only — keep defIds hidden
  for (const c of ['white', 'black'] as Color[]) {
    if (c !== viewer) {
      view.players[c].hand = view.players[c].hand.map((card) => ({
        instanceId: card.instanceId,
        defId: 'hidden',
      }));
    }
  }
  return view;
}

export function getDraftOptions(state: GameState): string[] {
  if (!state.draft) return [];
  const cls = state.draft.order[state.draft.index];
  return VARIANTS_BY_CLASS[cls] ?? [];
}

export { VARIANTS_BY_CLASS, PIECES, DRAFT_ORDER, shuffleInPlace };
