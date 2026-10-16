import type { Coord, GameState, PieceState, PrototypeForm, PrototypeState } from '../types.js';
import { inBounds, movementBonus, pieceAt, sameCoord } from '../utils.js';
import type { MoveOption } from './helpers.js';
import { emptyOrEnemy, filterLegal, knightMoves, rayMoves } from './helpers.js';

export interface FormeInfo {
  id: PrototypeForm;
  name: string;
  /** Eye colour on the art, and the accent used in the UI. */
  eyes: string;
  color: string;
  icon: string;
  summary: string;
  perks: string[];
}

export const FORME_SWAP_COOLDOWN = 5;
export const FORME_FIELD_COOLDOWN = 20;
/** Owner turns a non-Speed forme lasts, counting the swap turn. */
export const FORME_DURATION = 6;
/** Forme reach: a square for Defense, a diamond for Temporal. */
export const FORME_RADIUS = 2;

export const TIMED_PERK = `Lasts ${FORME_DURATION} turns (the swap turn plus ${FORME_DURATION - 1} more), then the Prototype shuts down for 1 turn and returns to Speed Forme.`;

export const FORMES: Record<PrototypeForm, FormeInfo> = {
  speed: {
    id: 'speed',
    name: 'Speed Forme',
    eyes: 'Blue',
    color: '#38b6ff',
    icon: '💨',
    summary: 'The starting forme, built to get around.',
    perks: ['Moves like a Knight (jumping over pieces), or 1 square diagonally.'],
  },
  attack: {
    id: 'attack',
    name: 'Attack Forme',
    eyes: 'Red',
    color: '#ff4a3d',
    icon: '⚔️',
    summary: 'Strikes, then strikes again.',
    perks: [
      'Moves up to 2 squares diagonally, or 1 square horizontally.',
      'After capturing, takes a bonus move with Knight movement.',
      TIMED_PERK,
    ],
  },
  defense: {
    id: 'defense',
    name: 'Defense Forme',
    eyes: 'Yellow',
    color: '#f5c542',
    icon: '🛡️',
    summary: 'Plants itself and guards nearby allies.',
    perks: [
      `When an ally within ${FORME_RADIUS} squares is captured, an Attack Drone spawns on that ally's starting square (if empty). Once every ${FORME_FIELD_COOLDOWN} turns.`,
      'The Prototype cannot move in this forme.',
      TIMED_PERK,
    ],
  },
  temporal: {
    id: 'temporal',
    name: 'Temporal Forme',
    eyes: 'Purple',
    color: '#b26bff',
    icon: '⏳',
    summary: 'Stops time around itself.',
    perks: [
      `Every piece in a diamond ${FORME_RADIUS} orthogonal steps around it (both sides, Kings excepted) cannot move.`,
      `Can be entered once every ${FORME_FIELD_COOLDOWN} turns.`,
      'The Prototype cannot move in this forme.',
      TIMED_PERK,
    ],
  },
};

export const FORME_ORDER: PrototypeForm[] = ['speed', 'attack', 'defense', 'temporal'];

export function newPrototypeState(): PrototypeState {
  return { form: 'speed', droneCooldown: 0, temporalCooldown: 0 };
}

export function ensureProto(piece: PieceState): PrototypeState {
  if (!piece.proto) piece.proto = newPrototypeState();
  return piece.proto;
}

export function protoForm(piece: { proto?: PrototypeState }): PrototypeForm {
  return piece.proto?.form ?? 'speed';
}

/** The forme whose powers are in effect, or null while the Prototype is rebooting. */
export function activeForm(piece: { proto?: PrototypeState }): PrototypeForm | null {
  return piece.proto?.rebooting ? null : protoForm(piece);
}

/** Defense and Temporal Forme root the Prototype in place, as does rebooting. */
export function formeRooted(piece: PieceState): boolean {
  const form = activeForm(piece);
  return form === null || form === 'defense' || form === 'temporal';
}

/** Temporal Forme's reach is a diamond: at most FORME_RADIUS orthogonal steps away. */
export function inTemporalField(center: Coord, pos: Coord): boolean {
  return Math.abs(center.row - pos.row) + Math.abs(center.col - pos.col) <= FORME_RADIUS;
}

/** Temporal Forme: non-King pieces within reach of any Temporal Prototype cannot move. */
export function temporalFrozen(state: GameState, piece: PieceState): boolean {
  if (piece.class === 'king') return false;
  return state.pieces.some(
    (p) =>
      p.defId === 'prototype' &&
      p.id !== piece.id &&
      activeForm(p) === 'temporal' &&
      inTemporalField(p.pos, piece.pos),
  );
}

const ORTH: Coord[] = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
];
const DIAG: Coord[] = [
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 1 },
];

export function prototypeMoves(piece: PieceState, state: GameState): MoveOption[] {
  const form = activeForm(piece);
  if (form === null || form === 'defense' || form === 'temporal') return [];
  if (form === 'attack') {
    return filterLegal(piece, state, [
      ...rayMoves(piece, state, DIAG, 2),
      ...rayMoves(piece, state, ORTH.filter((d) => d.row === 0), 1),
    ]);
  }
  return filterLegal(piece, state, [...knightMoves(piece, state, 2, 1, true), ...rayMoves(piece, state, DIAG, 1)]);
}

/** Attack Forme's bonus move: Knight movement only. */
export function prototypeBonusMoves(piece: PieceState, state: GameState): MoveOption[] {
  return filterLegal(piece, state, knightMoves(piece, state, 2, 1, true));
}

export function droneMoves(piece: PieceState, state: GameState): MoveOption[] {
  const moves: MoveOption[] = [];
  for (const d of ORTH) {
    for (let i = 1; i <= 2 + movementBonus(piece); i++) {
      const to = { row: piece.pos.row + d.row * i, col: piece.pos.col + d.col * i };
      if (!inBounds(to) || pieceAt(state, to)) break;
      if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, to))) break;
      moves.push({ to });
    }
  }
  for (const d of [...ORTH, ...DIAG]) {
    const opt = emptyOrEnemy(state, { row: piece.pos.row + d.row, col: piece.pos.col + d.col }, piece.color, piece);
    if (opt?.capture) moves.push(opt);
  }
  return filterLegal(piece, state, moves);
}
