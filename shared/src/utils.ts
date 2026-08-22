import type { Color, Coord, GameState, PieceState, StatusEffect } from './types.js';
import { ALLIED_ROWS, BOARD_SIZE } from './types.js';

export function cloneState<T>(state: T): T {
  return structuredClone(state);
}

export function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

export function inBounds(c: Coord): boolean {
  return c.row >= 0 && c.row < BOARD_SIZE && c.col >= 0 && c.col < BOARD_SIZE;
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

/** Break Best Buddy: pig stays on the vacated square; host/pig no longer share a tile. */
export function endBestBuddy(state: GameState, mover: PieceState, vacated: Coord): boolean {
  let ended = false;
  if (mover.coOccupantId) {
    mover.coOccupantId = undefined;
    ended = true;
  }
  for (const p of state.pieces) {
    if (p.id === mover.id) continue;
    if (p.coOccupantId === mover.id) {
      p.coOccupantId = undefined;
      p.pos = { row: vacated.row, col: vacated.col };
      ended = true;
    }
  }
  return ended;
}

export function pawnDirection(color: Color): number {
  return color === 'white' ? -1 : 1;
}

export function backRow(color: Color): number {
  return color === 'white' ? BOARD_SIZE - 1 : 0;
}

export function frontRow(color: Color): number {
  return color === 'white' ? BOARD_SIZE - 2 : 1;
}

export function isAlliedTerritory(color: Color, pos: Coord): boolean {
  if (color === 'white') return pos.row >= BOARD_SIZE - ALLIED_ROWS;
  return pos.row < ALLIED_ROWS;
}

export function pieceAt(state: GameState, pos: Coord): PieceState | undefined {
  return state.pieces.find((p) => sameCoord(p.pos, pos));
}

export function tokenAt(state: GameState, pos: Coord) {
  return state.tokens.filter((t) => sameCoord(t.pos, pos));
}

export function getKing(state: GameState, color: Color): PieceState | undefined {
  return state.pieces.find((p) => p.color === color && p.class === 'king');
}

export function hasEffect(piece: PieceState, kind: string): StatusEffect | undefined {
  return piece.effects.find((e) => e.kind === kind);
}

export function addEffect(piece: PieceState, effect: StatusEffect): void {
  piece.effects.push(effect);
}

export function removeEffects(piece: PieceState, kind: string): void {
  piece.effects = piece.effects.filter((e) => e.kind !== kind);
}

export function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

export function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

export function orthDir(from: Coord, to: Coord): Coord | null {
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  if (dr !== 0 && dc !== 0) return null;
  if (dr === 0 && dc === 0) return null;
  return { row: dr, col: dc };
}

export function clearOrthogonalLOS(state: GameState, from: Coord, to: Coord): boolean {
  const dir = orthDir(from, to);
  if (!dir) return false;
  let r = from.row + dir.row;
  let c = from.col + dir.col;
  while (r !== to.row || c !== to.col) {
    if (pieceAt(state, { row: r, col: c })) return false;
    if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, { row: r, col: c }))) {
      return false;
    }
    r += dir.row;
    c += dir.col;
  }
  return true;
}

export function nearestEmptyAdjacent(
  state: GameState,
  center: Coord,
  preferToward?: Coord,
): Coord | null {
  const candidates: Coord[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const p = { row: center.row + dr, col: center.col + dc };
      if (!inBounds(p)) continue;
      if (pieceAt(state, p)) continue;
      if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, p))) continue;
      candidates.push(p);
    }
  }
  if (!candidates.length) return null;
  if (preferToward) {
    candidates.sort(
      (a, b) =>
        manhattan(a, preferToward) - manhattan(b, preferToward) || a.row - b.row || a.col - b.col,
    );
  }
  return candidates[0];
}

export function nearestEmptyAround(
  state: GameState,
  center: Coord,
  maxRadius = 3,
): Coord | null {
  if (
    inBounds(center) &&
    !pieceAt(state, center) &&
    !state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, center))
  ) {
    return center;
  }
  for (let rad = 1; rad <= maxRadius; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const p = { row: center.row + dr, col: center.col + dc };
        if (!inBounds(p)) continue;
        if (pieceAt(state, p)) continue;
        if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, p))) continue;
        return p;
      }
    }
  }
  return null;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function log(state: GameState, message: string): void {
  const ts = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  state.history.unshift(`[${ts}] ${message}`);
  if (state.history.length > 80) state.history.length = 80;
}

export function movementBonus(piece: PieceState): number {
  let bonus = 0;
  for (const e of piece.effects) {
    if (e.kind === 'movement_plus') bonus += Number(e.data?.amount ?? 1);
    if (e.kind === 'mathematical') bonus += 1;
    if (e.kind === 'wizard_enchant') bonus += 1;
  }
  return bonus;
}

export function isFrozen(piece: PieceState): boolean {
  return Boolean(hasEffect(piece, 'frozen') || hasEffect(piece, 'immobilized') || hasEffect(piece, 'stunned'));
}

export function isInvincible(piece: PieceState): boolean {
  return Boolean(hasEffect(piece, 'invincible') || hasEffect(piece, 'pause'));
}

/** Spell cards unlock at the first night (after 5 mutual turn cycles) and stay available thereafter. */
export function spellsUnlocked(state: { cycleCount: number; dayNight: string }): boolean {
  return state.cycleCount >= 5 || state.dayNight === 'night';
}

export function nextDayNightFlipCycle(cycleCount: number): number {
  const step = 5 - (cycleCount % 5);
  return cycleCount + (step === 0 ? 5 : step);
}

/** True when Magic Be-gone has silenced this player's spells and magical abilities. */
export function isMagicDisabled(state: {
  cycleCount: number;
  players: Record<string, { magicDisabledUntilCycle?: number }>;
  pieces: Array<{ defId: string; color: string }>;
}, color: string): boolean {
  const until = state.players[color]?.magicDisabledUntilCycle;
  if (until == null || state.cycleCount >= until) return false;
  const whiteWizard = state.pieces.some((p) => p.defId === 'wizard' && p.color === 'white');
  const blackWizard = state.pieces.some((p) => p.defId === 'wizard' && p.color === 'black');
  return whiteWizard && blackWizard;
}

export function barriersAdjacent(state: GameState, pos: Coord): boolean {
  return state.tokens.some((t) => {
    if (t.kind !== 'barrier') return false;
    return chebyshev(t.pos, pos) === 1;
  });
}
