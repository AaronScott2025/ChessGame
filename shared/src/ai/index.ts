import type { Color, Coord, GameState, PieceState } from '../types.js';
import { BOARD_SIZE, MAX_HAND } from '../types.js';
import type { MoveOption } from '../pieces/helpers.js';
import { fortifyBlocksCapture } from '../pieces/helpers.js';
import { DRAFT_ORDER, VARIANTS_BY_CLASS } from '../pieces/index.js';
import { getCardDef } from '../cards/index.js';
import {
  cloneState,
  hasEffect,
  inBounds,
  isAlliedTerritory,
  isFrozen,
  isInvincible,
  isMagicDisabled,
  isPieceBanned,
  opposite,
  pieceAt,
  spellsUnlocked,
} from '../utils.js';
import {
  applyMove,
  availableAbilities,
  chooseFirstPicker,
  declareCheckmateIfStuck,
  draftBan,
  draftPick,
  endTurn,
  getDraftOptions,
  listMoves,
  openingKeep,
  openQueuedLawPrompt,
  playCard,
  promptActor,
  refreshCheckState,
  resolvePrompt,
  cancelPrompt,
  useAbility,
} from '../engine/game.js';
import { autoResolvePrompt } from '../engine/timer.js';

export type AiDifficulty = 'easy' | 'medium' | 'hard';
export const AI_DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'medium', 'hard'];

type Rng = () => number;

const WIN = 100_000;

const CLASS_VALUE: Record<string, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3.2,
  rook: 5,
  wildcard: 3.5,
  queen: 9,
  king: 0,
};

const PIECE_VALUE: Record<string, number> = {
  rogue: 1.1,
  leapfrog: 1.1,
  spider: 1.1,
  enchanted_pawn: 1.2,
  gnome: 4.8,
  yeti: 5.2,
  snake: 3.2,
  pig: 3.1,
  archer: 3.3,
  wizard: 3.4,
  worm: 3.1,
  skirmisher: 3.3,
  spider_queen: 8.5,
  angel: 8.5,
  ghost: 8.5,
  reaper: 8.5,
  vampire: 8.3,
  president: 8,
  merchant: 3,
  demon: 3.8,
  mimic: 3.4,
  gambler: 3.2,
  prototype: 4,
  snail: 3,
  musician: 3.6,
  drone: 2,
};

/** How much the AI likes holding each card (lowest is discarded first). */
const CARD_VALUE: Record<string, number> = {
  revive: 3,
  rewind: 2.5,
  pawn_summon: 2,
  pause: 2,
  coordinated_shuffle: 2,
  enchant: 1.8,
  teleport: 1.5,
  pocket_castle: 1.5,
  repel: 1.5,
  rally: 1.5,
  in_spirit: 1.5,
  fortify: 1.2,
  refresh: 1.2,
  blind_gambit: 1.2,
  swap: 1,
  cloak: 1,
  mathematical: 0.8,
  lava_tsunami: 0.8,
};

/** Cards Medium and Hard leave alone: pure gambles, or effects the evaluator can't judge. */
const SMART_SKIP = new Set([
  'gamblers_gambit',
  'gamblers_delight',
  'gamblers_high',
  'barrier',
  'portal',
  'rearrange',
  'cloak',
  'rally',
  'lava_tsunami',
  'recall',
  'doublecast',
]);

const NOISE: Record<AiDifficulty, number> = { easy: 1.2, medium: 0.25, hard: 0.04 };

/** Wall-clock caps for Hard's deeper checks, so crowded boards don't stall the game. */
const HARD_REPLY_BUDGET_MS = 1500;
const HARD_SPELL_BUDGET_MS = 1200;

// ---------------------------------------------------------------------------
// Turn routing
// ---------------------------------------------------------------------------

/** The seat that must act next, or null when nobody can (lobby, game over). */
export function seatToAct(state: GameState): Color | null {
  if (state.phase === 'lobby' || state.phase === 'ended' || state.winner) return null;
  if (state.pendingPrompt) return promptActor(state.pendingPrompt);
  if (state.phase === 'draft' && state.draft) {
    return state.draft.blackChoseFirstPicker == null ? 'black' : state.draft.pickingColor;
  }
  if (state.phase === 'playing') return state.turn;
  return null;
}

/**
 * Take one decision for `color` (a draft pick, a prompt answer, a spell or a move)
 * and return the resulting state. Call repeatedly while `seatToAct` is `color`.
 */
export function aiStep(state: GameState, color: Color, difficulty: AiDifficulty, rng: Rng = Math.random): GameState {
  if (seatToAct(state) !== color) throw new Error('It is not the computer’s turn');
  let next: GameState;
  if (state.pendingPrompt) next = answerPrompt(state, color, difficulty, rng);
  else if (state.phase === 'draft') next = draftStep(state, color, difficulty, rng);
  else next = playStep(state, color, difficulty, rng);
  openQueuedLawPrompt(next);
  refreshCheckState(next);
  declareCheckmateIfStuck(next);
  return next;
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

function draftStep(state: GameState, color: Color, difficulty: AiDifficulty, rng: Rng): GameState {
  const draft = state.draft!;
  if (draft.blackChoseFirstPicker == null) return chooseFirstPicker(state, rng() < 0.5);
  const options = getDraftOptions(state, color);
  if (!options.length) throw new Error('No draft options');
  const noise = difficulty === 'easy' ? 100 : difficulty === 'medium' ? 0.6 : 0.15;
  const ranked = options
    .map((id) => ({ id, score: defValue(id) + (rng() - 0.5) * 2 * noise }))
    .sort((a, b) => b.score - a.score);
  const act = draft.stage === 'ban' ? draftBan : draftPick;
  for (const { id } of ranked) {
    try {
      return act(state, color, id);
    } catch {
      /* try the next option */
    }
  }
  throw new Error('No legal draft choice');
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function answerPrompt(state: GameState, color: Color, difficulty: AiDifficulty, rng: Rng): GameState {
  const prompt = state.pendingPrompt!;
  if (prompt.type === 'opening_mulligan') return openingKeep(state, color);

  if (prompt.type === 'discard_to_draw') {
    const hand = [...state.players[color].hand].sort((a, b) => cardValue(a.defId) - cardValue(b.defId));
    for (const card of hand) {
      try {
        return resolvePrompt(state, color, card.instanceId);
      } catch {
        /* next */
      }
    }
  }

  if (prompt.type === 'promote' && difficulty !== 'easy') {
    const best = [...prompt.options].sort((a, b) => defValue(b) - defValue(a));
    for (const defId of best) {
      try {
        return resolvePrompt(state, color, defId);
      } catch {
        /* next */
      }
    }
  }

  const sim = lite(state);
  const payloads = shuffled(promptPayloads(state, color), rng);
  const results: Array<{ answer: (s: GameState) => GameState; next: GameState }> = [];
  for (const payload of payloads.slice(0, 60)) {
    const answer = (s: GameState) => resolvePrompt(s, color, payload);
    try {
      results.push({ answer, next: answer(sim) });
    } catch {
      /* invalid payload */
    }
  }
  if (prompt.type === 'ability_target' || prompt.type === 'gadget_choice') {
    const answer = (s: GameState) => cancelPrompt(s, color);
    try {
      results.push({ answer, next: answer(sim) });
    } catch {
      /* not cancelable */
    }
  }
  if (results.length) {
    let best = results[Math.floor(rng() * results.length)]!;
    if (difficulty !== 'easy') {
      let bestScore = -Infinity;
      for (const r of results) {
        const s = evaluate(r.next, color) + (rng() - 0.5) * 2 * NOISE[difficulty];
        if (s > bestScore) {
          bestScore = s;
          best = r;
        }
      }
    }
    try {
      return best.answer(state);
    } catch {
      /* fall through to the engine's default */
    }
  }
  return autoResolvePrompt(state, color, rng);
}

/** Every payload worth trying for the open prompt; invalid ones are filtered by the engine. */
function promptPayloads(state: GameState, color: Color): unknown[] {
  const prompt = state.pendingPrompt!;
  switch (prompt.type) {
    case 'promote':
      return [...prompt.options];
    case 'law_choice':
      return [...prompt.options];
    case 'ability_target':
      return [...(prompt.options ?? [])];
    case 'gnome_hole_travel':
      return [...prompt.options, 'skip'];
    case 'spring_bounce': {
      const out: Coord[] = [];
      for (const dr of [-2, 0, 2]) {
        for (const dc of [-2, 0, 2]) {
          const to = { row: prompt.from.row + dr, col: prompt.from.col + dc };
          if ((dr || dc) && inBounds(to)) out.push(to);
        }
      }
      return out;
    }
    case 'opponent_choose_piece':
      return state.pieces.filter((p) => p.color === prompt.forPlayer).map((p) => p.id);
    case 'gambler_choice': {
      const out: unknown[] = [];
      for (const p of state.pieces) if (p.color === prompt.color) out.push(p.id);
      for (const cls of DRAFT_ORDER) out.push(cls);
      for (const c of [color, opposite(color)]) {
        state.players[c].graveyard.forEach((g, idx) => {
          out.push(idx, { idx }, { class: g.class, idx });
        });
      }
      for (const sq of emptyAlliedSquares(state, prompt.color, 12)) out.push(sq);
      out.push(null);
      return out;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

interface Candidate {
  pieceId: string;
  move: MoveOption;
}

function playStep(state: GameState, color: Color, difficulty: AiDifficulty, rng: Rng): GameState {
  const freeAction = chooseFreeAction(state, color, difficulty, rng);
  if (freeAction) return freeAction;
  const moves = legalMoves(lite(state), color);
  if (state.turnPhase === 'spell') {
    const cast = chooseSpell(state, color, difficulty, rng, moves);
    if (cast) return cast;
  }
  const moved = chooseMove(state, color, difficulty, rng, moves);
  if (moved) return moved;
  return endTurn(cloneState(state), color, false);
}

interface FreePlay {
  pieceId: string;
  abilityId: string;
  target?: Coord;
}

const FREE_ACTION_PIECES = new Set(['musician', 'merchant']);
const isFreeAction = (id: string) => id.startsWith('song_') || id.startsWith('merchant_');

/** Musician songs and Merchant purchases are free actions: take the best one when it helps (or a random one on Easy). */
function chooseFreeAction(state: GameState, color: Color, difficulty: AiDifficulty, rng: Rng): GameState | null {
  if (state.bonusMove || state.pendingPrompt) return null;
  const plays: FreePlay[] = [];
  for (const p of state.pieces) {
    if (p.color !== color || !FREE_ACTION_PIECES.has(p.defId)) continue;
    let abilities;
    try {
      abilities = availableAbilities(state, p.id);
    } catch {
      continue;
    }
    for (const a of abilities) {
      if (!a.ready || !isFreeAction(a.id)) continue;
      try {
        const prompt = useAbility(lite(state), color, p.id, a.id).pendingPrompt;
        if (prompt?.type === 'ability_target' && prompt.options) {
          for (const target of prompt.options) plays.push({ pieceId: p.id, abilityId: a.id, target });
        } else {
          plays.push({ pieceId: p.id, abilityId: a.id });
        }
      } catch {
        /* not playable */
      }
    }
  }
  if (!plays.length) return null;
  const play = (s: GameState, sp: FreePlay) => useAbility(s, color, sp.pieceId, sp.abilityId, sp.target);

  if (difficulty === 'easy') {
    if (rng() < 0.5) return null;
    for (const sp of shuffled(plays, rng)) {
      try {
        return play(state, sp);
      } catch {
        /* next */
      }
    }
    return null;
  }

  const base = evaluate(state, color);
  let best: { sp: FreePlay; score: number } | null = null;
  for (const sp of plays) {
    let next: GameState;
    try {
      next = play(lite(state), sp);
    } catch {
      continue;
    }
    const score = evaluate(next, color) - base + freeActionBonus(state, next, color, sp) + (rng() - 0.5) * NOISE[difficulty];
    if (!best || score > best.score) best = { sp, score };
  }
  if (!best || best.score < 0.05) return null;
  try {
    return play(state, best.sp);
  } catch {
    return null;
  }
}

/** What a static evaluation misses: sleeping enemies, an Encore's tempo, and what a purchase is worth. */
function freeActionBonus(before: GameState, after: GameState, color: Color, sp: FreePlay): number {
  if (sp.abilityId === 'merchant_promote') return 0;
  if (sp.abilityId === 'merchant_card' || sp.abilityId === 'merchant_range') {
    const savingForPromotion = before.pieces.some(
      (p) => p.color === color && p.class === 'pawn' && p.defId !== 'enchanted_pawn' && p.defId !== 'spider',
    );
    if (savingForPromotion) return -1;
    if (sp.abilityId === 'merchant_card') return 0.3;
    const target = sp.target ? pieceAt(before, sp.target) : undefined;
    return target ? 0.7 + pieceValue(target) * 0.04 : 0;
  }
  if (sp.abilityId === 'song_encore') {
    const target = sp.target ? pieceAt(before, sp.target) : undefined;
    return target ? 0.35 + Math.min(0.3, pieceValue(target) * 0.03) : 0;
  }
  if (sp.abilityId === 'song_lullaby') {
    return after.pieces
      .filter((p) => p.color !== color && hasEffect(p, 'asleep'))
      .reduce((sum, p) => sum + 0.08 + pieceValue(p) * 0.03, 0);
  }
  if (sp.abilityId === 'song_discord') return 0.15;
  return 0.1;
}

function legalMoves(state: GameState, color: Color): Candidate[] {
  const out: Candidate[] = [];
  for (const piece of state.pieces) {
    if (piece.color !== color) continue;
    let moves: MoveOption[];
    try {
      moves = listMoves(state, piece.id);
    } catch {
      continue;
    }
    for (const move of moves) out.push({ pieceId: piece.id, move });
  }
  return out;
}

/** `c` must come from `legalMoves` on this same position. */
function applyCandidate(state: GameState, color: Color, c: Candidate): GameState | null {
  try {
    return applyMove(
      state,
      color,
      c.pieceId,
      c.move.to,
      c.move.special ? { special: c.move.special, ...(c.move.meta ?? {}) } : undefined,
      c.move,
    );
  } catch {
    return null;
  }
}

/** A copy without the log and undo snapshots, which are costly to clone on every simulated move. */
function lite(state: GameState): GameState {
  return cloneState({ ...state, history: [], snapshots: [] });
}

function captureValue(state: GameState, c: Candidate, color: Color): number {
  const victim = pieceAt(state, c.move.to);
  return victim && victim.color !== color ? pieceValue(victim) : 0;
}

function chooseMove(
  state: GameState,
  color: Color,
  difficulty: AiDifficulty,
  rng: Rng,
  moves: Candidate[],
): GameState | null {
  if (!moves.length) return null;

  if (difficulty === 'easy' && rng() < 0.35) {
    for (const c of shuffled(moves, rng)) {
      const next = applyCandidate(state, color, c);
      if (next) return next;
    }
    return null;
  }

  const root = lite(state);
  const scored = scoreMoves(root, color, moves, difficulty !== 'easy');
  if (!scored.length) return null;
  for (const s of scored) {
    if (Math.abs(s.score) < WIN / 2) s.score += (rng() - 0.5) * 2 * NOISE[difficulty];
  }
  scored.sort((a, b) => b.score - a.score);

  if (difficulty === 'hard') refineWithReplies(scored, color, 10, Date.now() + HARD_REPLY_BUDGET_MS);

  for (const s of scored) {
    const real = applyCandidate(state, color, s.c);
    if (real) return real;
  }
  return null;
}

interface Scored {
  c: Candidate;
  next: GameState;
  score: number;
}

function scoreMoves(root: GameState, color: Color, moves: Candidate[], threats: boolean): Scored[] {
  const out: Scored[] = [];
  for (const c of moves) {
    const next = applyCandidate(root, color, c);
    if (!next) continue;
    out.push({ c, next, score: evaluate(next, color, { threats }) });
  }
  return out;
}

/** Hard: re-score the best candidates against the opponent's strongest capturing replies. */
function refineWithReplies(scored: Scored[], color: Color, topK: number, deadline: number): void {
  const opp = opposite(color);
  const top = scored.slice(0, topK);
  for (const s of top) {
    if (Date.now() > deadline) break;
    const n = s.next;
    if (n.phase !== 'playing' || n.turn !== opp || n.pendingPrompt) continue;
    const replies = captureReplies(n, opp)
      .map((r) => ({ r, gain: captureValue(n, r, opp) }))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 6);
    let worst = s.score;
    for (const { r } of replies) {
      let after: GameState;
      try {
        after = applyMove(n, opp, r.pieceId, r.move.to);
      } catch {
        continue;
      }
      worst = Math.min(worst, evaluate(after, color));
    }
    s.score = worst;
  }
  top.sort((a, b) => b.score - a.score);
  scored.splice(0, top.length, ...top);
}

/** Pseudo-legal captures; `applyMove` rejects the ones that turn out to be illegal. */
function captureReplies(state: GameState, color: Color): Candidate[] {
  const out: Candidate[] = [];
  for (const p of state.pieces) {
    if (p.color !== color) continue;
    let moves: MoveOption[];
    try {
      moves = listMoves(state, p.id, { forAttack: true });
    } catch {
      continue;
    }
    for (const move of moves) {
      const victim = pieceAt(state, move.to);
      if (victim && victim.color !== color) out.push({ pieceId: p.id, move });
    }
  }
  return out;
}

/** Best 1-ply score available from `state` (Hard uses this to judge whether a spell helps). */
function bestMoveScore(state: GameState, color: Color): number {
  const root = lite(state);
  if (root.phase !== 'playing') return evaluate(root, color);
  if (root.turn !== color || root.pendingPrompt) return evaluate(root, color);
  const scored = scoreMoves(root, color, legalMoves(root, color), true);
  return scored.reduce((m, s) => Math.max(m, s.score), -WIN);
}

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

function canCastNow(state: GameState, color: Color): boolean {
  const p = state.players[color];
  return (
    spellsUnlocked(state) &&
    !isMagicDisabled(state, color) &&
    !state.bonusMove &&
    p.hand.length > 0 &&
    p.spellsThisTurn < p.maxSpellsThisTurn
  );
}

function tryCast(state: GameState, color: Color, instanceId: string, targets: unknown[]): GameState | null {
  try {
    const next = playCard(state, color, instanceId, targets);
    if (next.pendingPrompt?.type === 'card_target') return null;
    return next;
  } catch {
    return null;
  }
}

function chooseSpell(
  state: GameState,
  color: Color,
  difficulty: AiDifficulty,
  rng: Rng,
  moves: Candidate[],
): GameState | null {
  if (!canCastNow(state, color)) return null;
  const hand = state.players[color].hand;
  const mustCast = moves.length === 0;

  if (difficulty === 'easy') {
    if (!mustCast && rng() > 0.3) return null;
    for (const card of shuffled(hand, rng)) {
      for (const targets of shuffled(spellTargets(state, color, card.defId), rng).slice(0, 12)) {
        const next = tryCast(state, color, card.instanceId, targets);
        if (next) return next;
      }
    }
    return null;
  }

  const base = evaluate(state, color);
  const options: Array<{ instanceId: string; targets: unknown[]; next: GameState; score: number }> = [];
  for (const card of hand) {
    if (SMART_SKIP.has(card.defId) && !mustCast) continue;
    const sim = card.defId === 'rewind' ? state : lite(state);
    const candidates = shuffled(spellTargets(state, color, card.defId), rng).slice(0, 40);
    for (const targets of candidates) {
      const next = tryCast(sim, color, card.instanceId, targets);
      if (!next) continue;
      const score = evaluate(next, color) - base + cardBonus(state, color, card.defId, targets);
      options.push({ instanceId: card.instanceId, targets, next, score });
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => b.score - a.score);

  const handFull = hand.length >= MAX_HAND - 1;
  let pick: (typeof options)[number] | null = null;
  if (mustCast) {
    pick = options[0]!;
  } else if (difficulty === 'hard') {
    const deadline = Date.now() + HARD_SPELL_BUDGET_MS;
    const without = bestMoveScore(state, color);
    let bestGain = handFull ? 0.05 : 0.3;
    for (const o of options.slice(0, 2)) {
      if (o.score < -0.2) continue;
      if (Date.now() > deadline) break;
      const gain = bestMoveScore(o.next, color) - without + cardBonus(state, color, cardDefOf(state, color, o.instanceId), o.targets);
      if (gain > bestGain) {
        bestGain = gain;
        pick = o;
      }
    }
  } else {
    const threshold = handFull ? 0.15 : 0.5;
    if (options[0]!.score > threshold) pick = options[0]!;
  }
  if (!pick) return null;
  return tryCast(state, color, pick.instanceId, pick.targets);
}

function cardDefOf(state: GameState, color: Color, instanceId: string): string {
  return state.players[color].hand.find((c) => c.instanceId === instanceId)?.defId ?? '';
}

/** Small nudges for cards whose payoff a static evaluation can't see. */
function cardBonus(state: GameState, color: Color, defId: string, targets: unknown[]): number {
  const target = typeof targets[0] === 'string' ? state.pieces.find((p) => p.id === targets[0]) : undefined;
  switch (defId) {
    case 'blind_gambit':
      return 0.3;
    case 'mathematical':
      return target && target.color === color && pieceValue(target) >= 3 ? 0.2 : -0.2;
    case 'in_spirit':
      return target && pieceValue(target) >= 3 ? 0.3 : 0;
    case 'echo':
    case 'blink':
      return target && target.color === color && pieceValue(target) >= 3 ? 0.1 : -0.2;
    case 'speed_plus':
    case 'kingstead':
      return 0.1;
    case 'enchant':
      if (!target || target.color !== color || target.class === 'queen') return -1;
      return 1.2 - pieceValue(target) * 0.15;
    default:
      return 0;
  }
}

/** Target lists to try for a card. Invalid combinations are rejected by the card itself. */
function spellTargets(state: GameState, color: Color, defId: string): unknown[][] {
  let def;
  try {
    def = getCardDef(defId);
  } catch {
    return [];
  }
  const mine = state.pieces.filter((p) => p.color === color);
  const theirs = state.pieces.filter((p) => p.color !== color);
  const nonKing = (p: PieceState) => p.class !== 'king';

  switch (defId) {
    case 'teleport': {
      const out: unknown[][] = [];
      for (const p of mine) {
        if (!isAlliedTerritory(color, p.pos)) continue;
        for (const dr of [-2, 0, 2]) {
          for (const dc of [-2, 0, 2]) {
            const to = { row: p.pos.row + dr, col: p.pos.col + dc };
            if ((dr || dc) && inBounds(to) && !pieceAt(state, to)) out.push([p.id, to]);
          }
        }
      }
      return out;
    }
    case 'swap': {
      const out: unknown[][] = [];
      for (const p of mine) {
        if (p.class === 'king' || p.class === 'queen') continue;
        for (const v of VARIANTS_BY_CLASS[p.class] ?? []) {
          if (v !== p.defId && !isPieceBanned(state, v)) out.push([p.id, v]);
        }
      }
      return out;
    }
    case 'enchant': {
      const queen = [...(VARIANTS_BY_CLASS.queen ?? [])]
        .filter((id) => !isPieceBanned(state, id))
        .sort((a, b) => defValue(b) - defValue(a))[0];
      if (!queen) return [];
      return mine.filter((p) => p.class !== 'king' && p.class !== 'queen').map((p) => [p.id, queen]);
    }
    case 'revive': {
      const gy = state.players[color].graveyard;
      const best = gy
        .map((g, idx) => ({ idx, v: defValue(g.defId) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 2);
      const squares = emptyAlliedSquares(state, color, 6);
      return best.flatMap(({ idx }) => squares.map((sq) => [idx, sq]));
    }
    case 'pawn_summon': {
      const fallen = state.players[color].graveyard.filter((g) => g.class === 'pawn').length;
      const need = Math.min(2, fallen);
      if (!need) return [];
      const variant = [state.players[color].army.pawn ?? 'pawn', 'pawn'].find((id) => !isPieceBanned(state, id)) ?? 'pawn';
      const squares = emptyAlliedSquares(state, color, 6, true);
      const out: unknown[][] = [];
      for (let i = 0; i < squares.length; i++) {
        if (need === 1) out.push([variant, squares[i]]);
        else for (let j = i + 1; j < squares.length; j++) out.push([variant, squares[i], variant, squares[j]]);
      }
      return out;
    }
    case 'coordinated_shuffle': {
      const big = theirs.filter(nonKing).sort((a, b) => pieceValue(b) - pieceValue(a)).slice(0, 5);
      const small = mine.filter(nonKing).sort((a, b) => pieceValue(a) - pieceValue(b)).slice(0, 5);
      return big.flatMap((a) => small.map((b) => [a.id, b.id]));
    }
  }

  switch (def.targeting) {
    case 'none':
      return [[]];
    case 'allied_piece':
      return mine.map((p) => [p.id]);
    case 'enemy_piece':
      return theirs.map((p) => [p.id]);
    case 'piece':
      return state.pieces.map((p) => [p.id]);
    case 'any_piece_non_king':
      return state.pieces.filter(nonKing).map((p) => [p.id]);
    case 'empty_allied':
      return emptyAlliedSquares(state, color, 10).map((sq) => [sq]);
    default:
      return [];
  }
}

/** Empty allied squares, nearest the home rows (or the pawn line) first. */
function emptyAlliedSquares(state: GameState, color: Color, limit: number, pawnLine = false): Coord[] {
  const home = color === 'white' ? BOARD_SIZE - 1 : 0;
  const front = color === 'white' ? BOARD_SIZE - 2 : 1;
  const anchor = pawnLine ? front : home;
  const out: Array<{ pos: Coord; d: number }> = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const pos = { row, col };
      if (!isAlliedTerritory(color, pos) || pieceAt(state, pos)) continue;
      if (state.tokens.some((t) => t.kind === 'barrier' && t.pos.row === row && t.pos.col === col)) continue;
      out.push({ pos, d: Math.abs(row - anchor) * 2 + Math.abs(col - 4.5) * 0.5 });
    }
  }
  return out
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.pos);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function defValue(defId: string): number {
  if (PIECE_VALUE[defId] != null) return PIECE_VALUE[defId]!;
  for (const [cls, ids] of Object.entries(VARIANTS_BY_CLASS)) if (ids.includes(defId)) return CLASS_VALUE[cls] ?? 3;
  return 3;
}

export function pieceValue(p: PieceState): number {
  if (p.class === 'king') return 0;
  let v = PIECE_VALUE[p.defId] ?? CLASS_VALUE[p.class] ?? 3;
  if (p.defId === 'vampire') v += Math.min(10, p.charges ?? 0) * 0.2;
  if (p.defId === 'reaper') v += (p.charges ?? 0) * 0.2;
  if (p.defId === 'angel') v -= (p.reviveCount ?? 0) * 0.3;
  if ((p.disabledTurns ?? 0) > 0) v *= 0.85;
  return v;
}

function cardValue(defId: string): number {
  return CARD_VALUE[defId] ?? 0.5;
}

/** `lead` is the owner's material advantage; a side that's well ahead pushes pawns to promote. */
function positional(p: PieceState, lead: number): number {
  const { row, col } = p.pos;
  if (p.class === 'pawn') {
    const adv = p.color === 'white' ? BOARD_SIZE - 2 - row : row - 1;
    return adv * (lead > 4 ? 0.15 : 0.05) + (adv >= 6 ? 0.4 : 0);
  }
  if (p.class === 'king') {
    const home = p.color === 'white' ? BOARD_SIZE - 1 : 0;
    return -0.15 * Math.abs(row - home);
  }
  const d = Math.abs(row - 4.5) + Math.abs(col - 4.5);
  return (9 - d) * 0.025;
}

function canCapture(p: PieceState): boolean {
  return !(isFrozen(p) || hasEffect(p, 'pause') || hasEffect(p, 'cannot_move') || (p.disabledTurns ?? 0) > 0);
}

function attackMap(state: GameState, byColor: Color): Map<string, PieceState[]> {
  const map = new Map<string, PieceState[]>();
  for (const p of state.pieces) {
    if (p.color !== byColor || !canCapture(p)) continue;
    let moves: MoveOption[];
    try {
      moves = listMoves(state, p.id, { forAttack: true });
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const m of moves) {
      const key = `${m.to.row},${m.to.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
  }
  return map;
}

/** True if another piece of the victim's side could recapture on its square. */
function isDefended(state: GameState, victim: PieceState): boolean {
  const side = victim.color;
  victim.color = opposite(side);
  try {
    for (const p of state.pieces) {
      if (p.color !== side || p.id === victim.id || !canCapture(p)) continue;
      let moves: MoveOption[];
      try {
        moves = listMoves(state, p.id, { forAttack: true });
      } catch {
        continue;
      }
      if (moves.some((m) => m.to.row === victim.pos.row && m.to.col === victim.pos.col)) return true;
    }
    return false;
  } finally {
    victim.color = side;
  }
}

/** What `victimColor` stands to lose on each attacked piece, largest first. */
function hangingLosses(state: GameState, victimColor: Color, attacks: Map<string, PieceState[]>): number[] {
  const losses: number[] = [];
  for (const v of state.pieces) {
    if (v.color !== victimColor || v.class === 'king' || isInvincible(v)) continue;
    const attackers = (attacks.get(`${v.pos.row},${v.pos.col}`) ?? []).filter((a) => !fortifyBlocksCapture(a, v));
    if (!attackers.length) continue;
    const value = pieceValue(v);
    const cheapest = Math.min(...attackers.map((a) => (a.class === 'king' ? 50 : pieceValue(a))));
    const loss = isDefended(state, v) ? Math.max(0, value - cheapest) : value;
    if (loss > 0) losses.push(loss);
  }
  return losses.sort((a, b) => b - a);
}

/** How hunted the enemy king is: its open escape squares that `attacker` covers, and attackers nearby. */
function kingPressure(state: GameState, attacker: Color, attacks: Map<string, PieceState[]>): number {
  const king = state.pieces.find((p) => p.color !== attacker && p.class === 'king');
  if (!king) return 0;
  let covered = 0;
  try {
    for (const m of listMoves(state, king.id, { forAttack: true })) {
      if (attacks.has(`${m.to.row},${m.to.col}`)) covered++;
    }
  } catch {
    /* no escape squares to count */
  }
  let near = 0;
  for (const p of state.pieces) {
    if (p.color !== attacker || p.class === 'king' || p.class === 'pawn') continue;
    near += Math.max(0, 4 - Math.max(Math.abs(p.pos.row - king.pos.row), Math.abs(p.pos.col - king.pos.col)));
  }
  return covered * 0.1 + near * 0.04;
}

/** Score from `me`'s point of view: material, position, check, and pieces left hanging. */
export function evaluate(state: GameState, me: Color, opts: { threats?: boolean } = {}): number {
  if (state.phase === 'ended') return state.winner === me ? WIN : state.winner ? -WIN : 0;
  const opp = opposite(me);
  let score = 0;
  let material = 0;
  for (const p of state.pieces) material += p.color === me ? pieceValue(p) : -pieceValue(p);
  for (const p of state.pieces) {
    const lead = p.color === me ? material : -material;
    const v = pieceValue(p) + positional(p, lead);
    score += p.color === me ? v : -v;
  }
  if (state.check === opp) score += 0.4;
  else if (state.check === me) score -= 0.4;

  const prompt = state.pendingPrompt;
  if (prompt?.type === 'promote') score += prompt.color === me ? 7 : -7;

  if (!state.rules?.cardsDisabled) {
    score += 0.2 * (state.players[me].hand.length - state.players[opp].hand.length);
  }
  score += 0.12 * ((state.players[me].coins ?? 0) - (state.players[opp].coins ?? 0));
  for (const p of state.pieces) {
    if (p.defId === 'merchant' && isAlliedTerritory(opposite(p.color), p.pos)) score += p.color === me ? 0.3 : -0.3;
  }

  if (state.phase !== 'playing') return score;
  const myAttacks = attackMap(state, me);
  const oppAttacks = attackMap(state, opp);
  const pressureWeight = (lead: number) => (lead > 4 ? 2.5 : 1);
  score += kingPressure(state, me, myAttacks) * pressureWeight(material);
  score -= kingPressure(state, opp, oppAttacks) * pressureWeight(-material);

  if (opts.threats !== false) {
    const mover = state.turn;
    const moverLoss = hangingLosses(state, mover, mover === me ? oppAttacks : myAttacks);
    const otherLoss = hangingLosses(state, opposite(mover), mover === me ? myAttacks : oppAttacks);
    const forMover = 0.85 * (otherLoss[0] ?? 0) - 0.2 * (moverLoss[0] ?? 0) - 0.5 * (moverLoss[1] ?? 0);
    score += mover === me ? forMover : -forMover;
  }
  return score;
}

// ---------------------------------------------------------------------------

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
