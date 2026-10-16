import type { Color, Coord, GameState } from '../types.js';
import type { MoveOption } from '../pieces/helpers.js';
import { cloneState, log, mulberry32, opposite } from '../utils.js';
import {
  applyMove,
  cancelPrompt,
  endTurn,
  listMoves,
  openQueuedLawPrompt,
  refreshCheckState,
  resolvePrompt,
} from './game.js';

export function turnTimerKey(state: GameState): string {
  return `${state.turnCount}:${state.turn}`;
}

/**
 * Start, pause, or resume the Chess but Fast clock to match the current state.
 * Mutates `state`. The clock pauses while the side to move is in check (check is
 * untimed) or while it waits on the opponent's prompt.
 */
export function syncTurnTimer(state: GameState, now: number): void {
  const secs = state.rules?.turnTimerSeconds;
  if (!secs || state.phase !== 'playing' || state.winner) {
    if (state.turnTimer) delete state.turnTimer;
    return;
  }
  const key = turnTimerKey(state);
  const durationMs = secs * 1000;
  let timer = state.turnTimer;
  if (!timer || timer.key !== key) {
    timer = { key, durationMs, deadline: now + durationMs, remainingMs: durationMs, paused: null };
    state.turnTimer = timer;
  }
  const paused: 'check' | 'waiting' | null =
    state.check === state.turn
      ? 'check'
      : state.pendingPrompt &&
          (state.pendingPrompt.color !== state.turn || state.pendingPrompt.type === 'law_choice')
        ? 'waiting'
        : null;
  if (paused && timer.deadline != null) {
    timer.remainingMs = Math.max(0, timer.deadline - now);
    timer.deadline = null;
  } else if (!paused && timer.deadline == null) {
    timer.deadline = now + timer.remainingMs;
  }
  timer.paused = paused;
}

/** True when the running clock for the current turn has hit zero. */
export function turnTimerExpired(state: GameState, now: number): boolean {
  const timer = state.turnTimer;
  return Boolean(
    timer && timer.deadline != null && timer.key === turnTimerKey(state) && now >= timer.deadline,
  );
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function firstSuccess(attempts: Array<() => GameState>): GameState | null {
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      /* try the next option */
    }
  }
  return null;
}

/** Answer (or abandon) a prompt the timed-out player left open. */
function autoResolvePrompt(state: GameState, color: Color, rng: () => number): GameState {
  const prompt = state.pendingPrompt;
  if (!prompt) return state;
  const attempts: Array<() => GameState> = [];
  switch (prompt.type) {
    case 'promote':
      for (const opt of shuffled(prompt.options, rng)) attempts.push(() => resolvePrompt(state, color, opt));
      break;
    case 'discard_to_draw':
      for (const card of shuffled(state.players[color].hand, rng)) {
        attempts.push(() => resolvePrompt(state, color, card.instanceId));
      }
      break;
    case 'ability_target':
      for (const opt of shuffled(prompt.options ?? [], rng)) attempts.push(() => resolvePrompt(state, color, opt));
      attempts.push(() => cancelPrompt(state, color));
      break;
    case 'gadget_choice':
      attempts.push(() => cancelPrompt(state, color));
      break;
    case 'gnome_hole_travel':
      attempts.push(() => resolvePrompt(state, color, 'skip'));
      break;
    case 'law_choice':
      for (const opt of shuffled(prompt.options, rng)) attempts.push(() => resolvePrompt(state, color, opt));
      break;
    case 'spring_bounce': {
      const dests: Coord[] = [];
      for (const dr of [-2, 0, 2]) {
        for (const dc of [-2, 0, 2]) {
          if (dr || dc) dests.push({ row: prompt.from.row + dr, col: prompt.from.col + dc });
        }
      }
      for (const dest of shuffled(dests, rng)) attempts.push(() => resolvePrompt(state, color, dest));
      break;
    }
    case 'opponent_choose_piece':
      for (const piece of shuffled(state.pieces.filter((p) => p.color === prompt.forPlayer), rng)) {
        attempts.push(() => resolvePrompt(state, color, piece.id));
      }
      break;
    case 'gambler_choice':
      for (const who of [color, opposite(color)]) {
        for (const payload of [null, 0, { idx: 0 }]) attempts.push(() => resolvePrompt(state, who, payload));
      }
      break;
    default:
      break;
  }
  const resolved = firstSuccess(attempts);
  if (resolved) return resolved;
  const cleared = cloneState(state);
  cleared.pendingPrompt = null;
  return cleared;
}

function settleOwnPrompts(state: GameState, color: Color, rng: () => number): GameState {
  let s = state;
  for (let i = 0; i < 6 && s.phase === 'playing' && s.pendingPrompt?.color === color; i++) {
    s = autoResolvePrompt(s, color, rng);
  }
  return s;
}

/**
 * The side to move ran out of time: close any prompt they left open, then play
 * a random legal move for them (plain moves first, special moves as a fallback).
 */
export function forceTimeoutMove(state: GameState): GameState {
  const color = state.turn;
  const key = turnTimerKey(state);
  const rng = mulberry32((state.rngSeed ^ Math.imul(state.turnCount + 1, 0x9e3779b1)) >>> 0);
  let s = cloneState(state);
  log(s, `${color} ran out of time — a random move was played`);

  s = settleOwnPrompts(s, color, rng);
  if (s.phase !== 'playing' || turnTimerKey(s) !== key || s.pendingPrompt) {
    openQueuedLawPrompt(s);
    refreshCheckState(s);
    return s;
  }

  const plain: Array<{ pieceId: string; move: MoveOption }> = [];
  const special: Array<{ pieceId: string; move: MoveOption }> = [];
  for (const piece of s.pieces.filter((p) => p.color === color)) {
    let moves: MoveOption[] = [];
    try {
      moves = listMoves(s, piece.id);
    } catch {
      continue;
    }
    for (const move of moves) (move.special ? special : plain).push({ pieceId: piece.id, move });
  }

  const before = s;
  const moved = firstSuccess(
    [...shuffled(plain, rng), ...shuffled(special, rng)].map(({ pieceId, move }) => () =>
      applyMove(
        before,
        color,
        pieceId,
        move.to,
        move.special ? { special: move.special, ...(move.meta ?? {}) } : undefined,
      ),
    ),
  );
  s = moved ?? endTurn(cloneState(before), color, false);
  s = settleOwnPrompts(s, color, rng);
  openQueuedLawPrompt(s);
  refreshCheckState(s);
  return s;
}
