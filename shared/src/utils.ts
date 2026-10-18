import type { Color, Coord, GameState, PieceState, StatusEffect } from './types.js';
import { ALLIED_ROWS, BOARD_SIZE } from './types.js';

/** Pieces banned in the ban phase (kept for the whole game once the draft ends). */
export function bannedPieceIds(state: Pick<GameState, 'bannedPieces' | 'draft'>): string[] {
  if (state.bannedPieces) return state.bannedPieces;
  const bans = state.draft?.bans;
  return bans ? [...bans.white, ...bans.black] : [];
}

export function isPieceBanned(state: Pick<GameState, 'bannedPieces' | 'draft'>, defId: string): boolean {
  return bannedPieceIds(state).includes(defId);
}

/** First candidate that isn't banned (undefined entries are skipped). */
export function firstUnbanned(
  state: Pick<GameState, 'bannedPieces' | 'draft'>,
  candidates: Array<string | undefined>,
): string | undefined {
  return candidates.find((id): id is string => Boolean(id) && !isPieceBanned(state, id!));
}

export function hasBloodlust(piece: PieceState): boolean {
  return (piece.bloodlustTurnsRemaining ?? 0) > 0;
}

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

export function clearLineOfSight(state: GameState, from: Coord, to: Coord): boolean {
  if (sameCoord(from, to)) return true;
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  if (dr === 0 && dc === 0) return false;
  const rowDiff = Math.abs(to.row - from.row);
  const colDiff = Math.abs(to.col - from.col);
  if (from.row !== to.row && from.col !== to.col && rowDiff !== colDiff) return false;
  let r = from.row + dr;
  let c = from.col + dc;
  while (r !== to.row || c !== to.col) {
    const pos = { row: r, col: c };
    if (pieceAt(state, pos)) return false;
    if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, pos))) return false;
    r += dr;
    c += dc;
  }
  return true;
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

/** Record an ability trigger so every client can play its sound. */
export function abilityFx(state: GameState, id: string): void {
  const list = state.abilityFx ?? [];
  const seq = (list[list.length - 1]?.seq ?? 0) + 1;
  list.push({ seq, id });
  if (list.length > 12) list.splice(0, list.length - 12);
  state.abilityFx = list;
}

export function movementBonus(piece: PieceState): number {
  let bonus = 0;
  for (const e of piece.effects) {
    if (e.kind === 'movement_plus') bonus += Number(e.data?.amount ?? 1);
    if (e.kind === 'mathematical') bonus += 1;
    if (e.kind === 'wizard_enchant') bonus += 1;
    if (e.kind === 'merchant_range') bonus += 1;
  }
  return bonus;
}

export function isFrozen(piece: PieceState): boolean {
  return Boolean(
    hasEffect(piece, 'frozen') ||
      hasEffect(piece, 'immobilized') ||
      hasEffect(piece, 'webbed') ||
      hasEffect(piece, 'stunned') ||
      hasEffect(piece, 'asleep'),
  );
}

export function isInvincible(piece: PieceState): boolean {
  return Boolean(hasEffect(piece, 'invincible') || hasEffect(piece, 'pause'));
}

/** Spell cards unlock at the first night (after 5 mutual turn cycles) and stay available thereafter. */
export function spellsUnlocked(state: {
  cycleCount: number;
  dayNight: string;
  rules?: { cardsDisabled?: boolean };
}): boolean {
  if (state.rules?.cardsDisabled) return false;
  return state.cycleCount >= 5 || state.dayNight === 'night';
}

export function nextDayNightFlipCycle(cycleCount: number): number {
  const step = 5 - (cycleCount % 5);
  return cycleCount + (step === 0 ? 5 : step);
}

/** True when Magic Be-gone or the Magic Prohibition law has silenced this player's spells and magical abilities. */
export function isMagicDisabled(
  state: {
    cycleCount: number;
    players: Record<string, { magicDisabledUntilCycle?: number }>;
    laws?: Array<{ id: string }>;
  },
  color: string,
): boolean {
  if (state.laws?.some((l) => l.id === 'magic_ban')) return true;
  const until = state.players[color]?.magicDisabledUntilCycle;
  return until != null && state.cycleCount < until;
}

export function reaperCapturesUntilRest(charges: number): number {
  const c = Math.max(0, Math.min(5, Math.floor(charges)));
  return 6 - c;
}

/** Blood Token counts at which the Vampire's night radius grows to 2, 3 and 4. */
export const VAMPIRE_RADIUS_MILESTONES = [2, 5, 10] as const;

/** Night Chebyshev radius. 0–1 tokens → 1; 2 → 2; 5 → 3; 10+ → 4. */
export function vampireNightRadius(tokens: number): number {
  return 1 + VAMPIRE_RADIUS_MILESTONES.filter((m) => tokens >= m).length;
}

export function ownWizards(
  state: { pieces: Array<{ defId: string; color: string; magicBegoneUsed?: number }> },
  color: string,
) {
  return state.pieces.filter((p) => p.defId === 'wizard' && p.color === color);
}

export function bothOwnWizardsAlive(
  state: { pieces: Array<{ defId: string; color: string }> },
  color: string,
): boolean {
  return ownWizards(state, color).length >= 2;
}

export function magicBegoneUses(
  state: { pieces: Array<{ defId: string; color: string; magicBegoneUsed?: number }> },
  color: string,
): number {
  return ownWizards(state, color).reduce((n, p) => n + (p.magicBegoneUsed ?? 0), 0);
}

export function barriersAdjacent(state: GameState, pos: Coord): boolean {
  return state.tokens.some((t) => {
    if (t.kind !== 'barrier') return false;
    return chebyshev(t.pos, pos) === 1;
  });
}

export function immuneToWeb(piece: PieceState): boolean {
  return piece.class === 'king' || piece.defId === 'spider_queen';
}

export function webTokenAt(state: GameState, pos: Coord) {
  return state.tokens.find((t) => t.kind === 'web' && sameCoord(t.pos, pos));
}

/** Rows 5 and 6 (ranks counted from White's side) — the two middle rows of the board. */
export const MIDDLE_ROWS = [4, 5];

export function zoneOnRow(
  state: Pick<GameState, 'zones'>,
  row: number,
  kind: 'neutral' | 'lava_warning' | 'lava',
): boolean {
  return (state.zones ?? []).some((z) => z.kind === kind && z.rows.includes(row));
}

/** Gamblers High neutral territory: nothing there can be captured or targeted by spells. */
export function inNeutralZone(state: Pick<GameState, 'zones'>, pos: Coord): boolean {
  return zoneOnRow(state, pos.row, 'neutral');
}

export function isLava(state: Pick<GameState, 'zones'>, pos: Coord): boolean {
  return zoneOnRow(state, pos.row, 'lava');
}

/** Squares a move explicitly crosses (e.g. a Skirmisher ricochet), when it records them. */
export function movePath(move: { meta?: Record<string, unknown> }): Coord[] | undefined {
  const path = move.meta?.path;
  return Array.isArray(path) ? (path as Coord[]) : undefined;
}

/**
 * First lava square a move crosses: every square of a straight ray, or just the landing square of a leap.
 * An explicit `path` is followed instead, up to `to`.
 */
export function lavaOnPath(state: Pick<GameState, 'zones'>, from: Coord, to: Coord, path?: Coord[]): Coord | null {
  if (!state.zones?.some((z) => z.kind === 'lava')) return null;
  if (path) {
    const end = path.findIndex((p) => sameCoord(p, to));
    return (end >= 0 ? path.slice(0, end + 1) : path).find((p) => isLava(state, p)) ?? null;
  }
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  const absR = Math.abs(to.row - from.row);
  const absC = Math.abs(to.col - from.col);
  if ((dr === 0 || dc === 0 || absR === absC) && (absR > 0 || absC > 0)) {
    for (let i = 1; i <= Math.max(absR, absC); i++) {
      const pos = { row: from.row + dr * i, col: from.col + dc * i };
      if (isLava(state, pos)) return pos;
    }
    return null;
  }
  return isLava(state, to) ? to : null;
}

/** First empty-or-enemy web on a queen-style ray (or an explicit `path`), else destination web for leaps. */
export function firstWebOnPath(state: GameState, from: Coord, to: Coord, mover: PieceState, path?: Coord[]): Coord | null {
  if (immuneToWeb(mover)) return null;
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  const absR = Math.abs(to.row - from.row);
  const absC = Math.abs(to.col - from.col);
  const isRay = (dr === 0 || dc === 0 || absR === absC) && (absR > 0 || absC > 0);
  const consider = (pos: Coord): boolean => {
    if (!webTokenAt(state, pos)) return false;
    const occ = pieceAt(state, pos);
    if (!occ) return true;
    return occ.color !== mover.color;
  };
  if (path) return path.find(consider) ?? null;
  if (isRay) {
    const steps = Math.max(absR, absC);
    for (let i = 1; i <= steps; i++) {
      const pos = { row: from.row + dr * i, col: from.col + dc * i };
      if (consider(pos)) return pos;
    }
    return null;
  }
  return consider(to) ? to : null;
}
