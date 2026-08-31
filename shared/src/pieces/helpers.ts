import type { Color, Coord, GameState, PieceClass, PieceState } from '../types.js';
import {
  chebyshev,
  hasEffect,
  inBounds,
  isFrozen,
  movementBonus,
  pawnDirection,
  pieceAt,
  sameCoord,
} from '../utils.js';

export interface MoveOption {
  to: Coord;
  capture?: boolean;
  special?: string;
  meta?: Record<string, unknown>;
}

export interface PieceDefinition {
  id: string;
  name: string;
  class: PieceClass;
  symbol: string;
  description?: string;
  /** Day/night restrictions */
  canAct?: (piece: PieceState, state: GameState) => boolean;
  getMoves: (piece: PieceState, state: GameState) => MoveOption[];
  onAfterMove?: (piece: PieceState, state: GameState, from: Coord, to: Coord) => void;
  onCapture?: (attacker: PieceState, victim: PieceState, state: GameState) => void;
  promoteOptions?: string[];
}

export function fortifyBlocksCapture(attacker: PieceState, victim: PieceState): boolean {
  return Boolean(hasEffect(victim, 'fortify')) && (attacker.class === 'pawn' || attacker.class === 'knight');
}

export function yetiBlocksPawnCapture(attacker: PieceState, victim: PieceState): boolean {
  return victim.defId === 'yeti' && attacker.class === 'pawn';
}

export function emptyOrEnemy(
  state: GameState,
  pos: Coord,
  color: Color,
  attacker?: PieceState,
): MoveOption | null {
  if (!inBounds(pos)) return null;
  if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, pos))) return null;
  const occ = pieceAt(state, pos);
  if (!occ) return { to: pos };
  if (occ.color !== color && !hasEffect(occ, 'invincible') && !hasEffect(occ, 'pause')) {
    if (attacker && (fortifyBlocksCapture(attacker, occ) || yetiBlocksPawnCapture(attacker, occ))) {
      return null;
    }
    return { to: pos, capture: true };
  }
  return null;
}

export function rayMoves(
  piece: PieceState,
  state: GameState,
  dirs: Coord[],
  max: number,
  canJump = false,
): MoveOption[] {
  const moves: MoveOption[] = [];
  const range = max + movementBonus(piece);
  for (const d of dirs) {
    for (let i = 1; i <= range; i++) {
      const to = { row: piece.pos.row + d.row * i, col: piece.pos.col + d.col * i };
      if (!inBounds(to)) break;
      if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, to))) {
        if (!canJump) break;
        continue;
      }
      const occ = pieceAt(state, to);
      if (!occ) {
        moves.push({ to });
        continue;
      }
      if (
        occ.color !== piece.color &&
        !hasEffect(occ, 'invincible') &&
        !hasEffect(occ, 'pause') &&
        !fortifyBlocksCapture(piece, occ) &&
        !yetiBlocksPawnCapture(piece, occ)
      ) {
        moves.push({ to, capture: true });
      }
      if (!canJump) break;
    }
  }
  return moves;
}

export function areaMoves(
  piece: PieceState,
  state: GameState,
  radius: number,
  includeCenter = false,
): MoveOption[] {
  const moves: MoveOption[] = [];
  const r = radius + Math.floor(movementBonus(piece) / 1);
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= dcMax(r, dr); dc++) {
      if (!includeCenter && dr === 0 && dc === 0) continue;
      if (chebyshev({ row: 0, col: 0 }, { row: dr, col: dc }) > r) continue;
      const opt = emptyOrEnemy(state, { row: piece.pos.row + dr, col: piece.pos.col + dc }, piece.color, piece);
      if (opt) moves.push(opt);
    }
  }
  return moves;
}

/** True if any square on a king-step path between `from` and `to` (excluding endpoints) is blocked. */
export function chebyshevPathBlocked(from: Coord, to: Coord, state: GameState): boolean {
  let r = from.row;
  let c = from.col;
  for (let n = 0; n < 20; n++) {
    const stepR = Math.sign(to.row - r);
    const stepC = Math.sign(to.col - c);
    if (stepR === 0 && stepC === 0) return false;
    r += stepR;
    c += stepC;
    if (r === to.row && c === to.col) return false;
    const pos = { row: r, col: c };
    if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, pos))) return true;
    if (pieceAt(state, pos)) return true;
  }
  return false;
}

function dcMax(_r: number, _dr: number): number {
  return _r;
}

export function knightMoves(
  piece: PieceState,
  state: GameState,
  long = 2,
  short = 1,
  canJump = true,
  passThroughAllies = false,
): MoveOption[] {
  const moves: MoveOption[] = [];
  for (const to of knightTargetCoords(piece, state, long, short, canJump, passThroughAllies)) {
    const opt = emptyOrEnemy(state, to, piece.color, piece);
    if (opt) moves.push(opt);
  }
  return moves;
}

/** L-destination coords reachable with the same path rules as knightMoves. */
export function knightTargetCoords(
  piece: PieceState,
  state: GameState,
  long = 2,
  short = 1,
  canJump = true,
  passThroughAllies = false,
): Coord[] {
  const targets: Coord[] = [];
  const bonus = movementBonus(piece);
  const longs = [long, long + (bonus ? 1 : 0)].filter((v, i, a) => a.indexOf(v) === i);
  for (const L of longs) {
    const deltas = [
      [L, short],
      [L, -short],
      [-L, short],
      [-L, -short],
      [short, L],
      [short, -L],
      [-short, L],
      [-short, -L],
    ];
    for (const [dr, dc] of deltas) {
      const to = { row: piece.pos.row + dr, col: piece.pos.col + dc };
      if (!inBounds(to)) continue;
      const stepR = Math.sign(dr);
      const stepC = Math.sign(dc);
      let blocked = false;
      const pathBlocked = (pos: Coord) => {
        if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, pos))) return true;
        if (!canJump) {
          const occ = pieceAt(state, pos);
          if (!occ || occ.id === piece.id) return false;
          // Pig-only: allies on the long leg do not block.
          if (passThroughAllies && occ.color === piece.color) return false;
          return true;
        }
        return false;
      };
      if (Math.abs(dr) > Math.abs(dc)) {
        for (let i = 1; i < Math.abs(dr); i++) {
          if (pathBlocked({ row: piece.pos.row + stepR * i, col: piece.pos.col })) {
            blocked = true;
            break;
          }
        }
      } else {
        for (let i = 1; i < Math.abs(dc); i++) {
          if (pathBlocked({ row: piece.pos.row, col: piece.pos.col + stepC * i })) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) continue;
      targets.push(to);
    }
  }
  return targets;
}

export function isKnightLanding(
  piece: PieceState,
  state: GameState,
  to: Coord,
  long = 2,
  short = 1,
  canJump = false,
  passThroughAllies = false,
): boolean {
  return knightTargetCoords(piece, state, long, short, canJump, passThroughAllies).some((c) =>
    sameCoord(c, to),
  );
}

/** True only for a Pig L (2×1, plus movement-bonus extra long). Does not allow teleports. */
export function isPigLShape(from: Coord, to: Coord, extraLong = 0): boolean {
  const dr = Math.abs(from.row - to.row);
  const dc = Math.abs(from.col - to.col);
  const longs = extraLong > 0 ? [2, 2 + extraLong] : [2];
  return longs.some((L) => (dr === L && dc === 1) || (dr === 1 && dc === L));
}

export function filterLegal(piece: PieceState, state: GameState, moves: MoveOption[]): MoveOption[] {
  if (isFrozen(piece) || (piece.disabledTurns ?? 0) > 0) return [];
  if (hasEffect(piece, 'cannot_move')) return [];
  return moves;
}

export function standardPawnMoves(piece: PieceState, state: GameState, diagonalMove = false): MoveOption[] {
  const moves: MoveOption[] = [];
  const dir = pawnDirection(piece.color);
  const forward = { row: piece.pos.row + dir, col: piece.pos.col };
  const bonus = movementBonus(piece);

  if (diagonalMove) {
    for (const dc of [-1, 1]) {
      const to = { row: piece.pos.row + dir, col: piece.pos.col + dc };
      if (inBounds(to) && !pieceAt(state, to) && !state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, to))) {
        moves.push({ to });
      }
    }
    // first move: 2 diagonally up
    if (!piece.hasMoved) {
      for (const dc of [-1, 1]) {
        const mid = { row: piece.pos.row + dir, col: piece.pos.col + dc };
        const to = { row: piece.pos.row + dir * 2, col: piece.pos.col + dc * 2 };
        if (inBounds(to) && !pieceAt(state, mid) && !pieceAt(state, to)) moves.push({ to });
      }
    }
    // capture vertically
    const cap = emptyOrEnemy(state, forward, piece.color, piece);
    if (cap?.capture) moves.push(cap);
  } else {
    if (inBounds(forward) && !pieceAt(state, forward) && !state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, forward))) {
      moves.push({ to: forward });
      if (!piece.hasMoved) {
        const two = { row: piece.pos.row + dir * (2 + bonus), col: piece.pos.col };
        // allow 2 (or bonus) if path clear
        let clear = true;
        for (let i = 1; i <= 1 + bonus; i++) {
          const p = { row: piece.pos.row + dir * i, col: piece.pos.col };
          if (pieceAt(state, p) || state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, p))) {
            clear = false;
            break;
          }
        }
        if (clear && inBounds(two)) moves.push({ to: { row: piece.pos.row + dir * 2, col: piece.pos.col } });
      } else if (bonus > 0) {
        const extra = { row: piece.pos.row + dir * (1 + bonus), col: piece.pos.col };
        let clear = true;
        for (let i = 1; i <= 1 + bonus; i++) {
          const p = { row: piece.pos.row + dir * i, col: piece.pos.col };
          if (i > 1 && (pieceAt(state, p) || state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, p)))) {
            clear = false;
            break;
          }
        }
        if (clear && inBounds(extra) && !pieceAt(state, extra)) moves.push({ to: extra });
      }
    }
    for (const dc of [-1, 1]) {
      const to = { row: piece.pos.row + dir, col: piece.pos.col + dc };
      const opt = emptyOrEnemy(state, to, piece.color, piece);
      if (opt?.capture) moves.push(opt);
    }
  }
  return moves;
}
