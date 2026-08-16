import type { Color, Coord, GameState, PieceState, PlayerState } from '../types.js';
import { BOARD_SIZE } from '../types.js';
import { DRAFT_ORDER, getPieceDef, PIECES, VARIANTS_BY_CLASS } from '../pieces/index.js';
import type { MoveOption } from '../pieces/helpers.js';
import { buildDeck, drawCard, getCardDef } from '../cards/index.js';
import {
  backRow,
  cloneState,
  frontRow,
  getKing,
  hasEffect,
  inBounds,
  isAlliedTerritory,
  log,
  mulberry32,
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
  } else if (move.special === 'best_buddy') {
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
        // grant up to 3 turns — represent as skipTurns negative? use extraTurns
        (next.players[color] as PlayerState & { bonusTurns?: number }).bonusTurns =
          ((next.players[color] as PlayerState & { bonusTurns?: number }).bonusTurns ?? 0) + 3;
      }
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
      // stay on board under new owner at same square — piece moved onto it so place adjacent?
      const dest = nearestEmptyAround(next, to) ?? to;
      // actually demon takes and converts — remove then readd as ally at square
      // We'll convert in place: attacker stays? Rules: convert the piece. Demon moves onto square.
      next.pieces = next.pieces.filter((p) => p.id !== captured!.id);
      const converted = { ...captured, color, id: `conv_${captured.id}` };
      // Demon occupies square; converted goes to nearest
      const park = nearestEmptyAround(next, to);
      if (park) {
        converted.pos = park;
        next.pieces.push(converted);
      }
      captured = undefined;
    } else {
      removePiece(next, captured, color);
    }

    if (piece.defId === 'snake') piece.bloodlust = true;

    // Reaper charge consume
    if (piece.defId === 'reaper' && (piece.charges ?? 0) > 0) {
      const charges = piece.charges ?? 0;
      // soul lock / world shatterer simplified
      if (charges >= 3 && next.dayNight === 'night' && captured) {
        // already in graveyard — revive as ally on reaper start if free
        const spot = nearestEmptyAround(next, piece.startPos);
        if (spot && charges >= 3) {
          const gy = next.players[color].graveyard;
          // victim was enemy
        }
      }
      if (charges >= 5 && captured) {
        const cls = captured.class;
        const victims = next.pieces.filter((p) => p.color !== color && p.class === cls);
        for (const v of victims) removePiece(next, v, color);
      }
      const disable = Math.floor(charges * 2.5);
      piece.charges = 0;
      piece.disabledTurns = disable;
      const home = nearestEmptyAround(next, piece.startPos);
      if (home) piece.pos = home;
    }
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
  next.lastMove = { pieceId, from, to, capturedId: captured?.id, defId: piece.defId } as GameState['lastMove'] & {
    defId: string;
  };

  // Echo
  const echo = hasEffect(piece, 'echo_armed');
  if (echo) {
    addEchoOption(next, piece, from, to);
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
  if (!isOppTurn && next.turnPhase !== 'spell' && !def.playOnOpponentTurn) {
    throw new Error('Spell phase only');
  }
  if (player.spellsThisTurn >= player.maxSpellsThisTurn && !def.playOnOpponentTurn) {
    throw new Error('Already cast max spells this turn');
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
      // reaper gains charge at night if alive
      if (next.dayNight === 'night') {
        for (const p of next.pieces) {
          if (p.defId === 'reaper' && (p.disabledTurns ?? 0) <= 0) {
            p.charges = (p.charges ?? 0) + 1;
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

  const nk = getKing(next, nextColor);
  if (nk) {
    if (hasEffect(nk, 'doublecast_ready')) {
      next.players[nextColor].maxSpellsThisTurn = 2;
      removeEffects(nk, 'doublecast_ready');
    }
  }

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
    // speed plus pending
    for (const e of [...piece.effects]) {
      if (e.turnsRemaining == null) continue;
      // decrement on owner turn for allied effects
      if (piece.color === color || e.kind === 'pause' || e.kind === 'immobilized' || e.kind === 'frozen') {
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

  // bloodlust clears after snake move turn — clear if snake moved last
  if (state.lastMove) {
    const snake = state.pieces.find((p) => p.id === state.lastMove!.pieceId && p.defId === 'snake');
    if (snake && snake.bloodlust && snake.hasMoved) {
      // keep until after next snake turn used — clear at end of that turn
      snake.bloodlust = false;
    }
  }
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
