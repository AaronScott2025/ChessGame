import type { Coord, GameState, PieceState, PrototypeForm, PrototypeState } from '../types.js';
import { chebyshev, hasEffect, inBounds, movementBonus, mulberry32, pieceAt, sameCoord } from '../utils.js';
import type { MoveOption } from './helpers.js';
import { filterLegal, fortifyBlocksCapture } from './helpers.js';

export type MutationKind = 'offense' | 'mobility' | 'defense' | 'utility' | 'instability';

export const MUTATION_KINDS: Record<MutationKind, { label: string; color: string }> = {
  offense: { label: 'Offense', color: '#ff5a4a' },
  mobility: { label: 'Mobility', color: '#38d1ff' },
  defense: { label: 'Defense', color: '#6f8dff' },
  utility: { label: 'Utility', color: '#f5c542' },
  instability: { label: 'Instability', color: '#c06bff' },
};

export interface MutationInfo {
  name: string;
  icon: string;
  kind: MutationKind;
  text: string;
}

export const MUTATIONS: Record<string, MutationInfo> = {
  razor_limbs: {
    name: 'Razor Limbs',
    icon: '🔪',
    kind: 'offense',
    text: 'After capturing, may move 1 square in any direction (cannot capture).',
  },
  execution_protocol: {
    name: 'Execution Protocol',
    icon: '🎯',
    kind: 'offense',
    text: 'May capture an enemy one square beyond a knight landing (lunging strike).',
  },
  chain_assault: {
    name: 'Chain Assault',
    icon: '⛓️',
    kind: 'offense',
    text: 'Once per game: after capturing, immediately capture an adjacent enemy.',
  },
  overclock_weapons: {
    name: 'Overclock Weapons',
    icon: '💥',
    kind: 'offense',
    text: 'Its captures ignore defensive effects on the target (invincible, fortify, armor, revive-on-death).',
  },
  vector_thrusters: {
    name: 'Vector Thrusters',
    icon: '🚀',
    kind: 'mobility',
    text: 'May also move 1 square diagonally.',
  },
  spider_chassis: {
    name: 'Spider Chassis',
    icon: '🕷',
    kind: 'mobility',
    text: 'Pieces no longer block its path.',
  },
  teleport_relay: {
    name: 'Teleport Relay',
    icon: '🌀',
    kind: 'mobility',
    text: 'Every 3 turns: teleport to any empty square within 4 spaces.',
  },
  magnetic_leap: {
    name: 'Magnetic Leap',
    icon: '🧲',
    kind: 'mobility',
    text: 'Instead of moving: pull yourself next to an enemy within 3 squares (no capture).',
  },
  quantum_drive: {
    name: 'Quantum Drive',
    icon: '👻',
    kind: 'mobility',
    text: 'Once per game: blink to any empty square on the board.',
  },
  reinforced_hull: {
    name: 'Reinforced Hull',
    icon: '🛡',
    kind: 'defense',
    text: 'The first capture against it is ignored; the attacker stays where it is.',
  },
  reactive_plating: {
    name: 'Reactive Plating',
    icon: '🔄',
    kind: 'defense',
    text: 'At the end of each enemy turn, enemy pieces next to it (not the King) are knocked 1 square away if there is room.',
  },
  self_repair: {
    name: 'Self-Repair Nanites',
    icon: '🧬',
    kind: 'defense',
    text: 'At the start of your turn, it shakes off Frozen, Stunned, Immobilized and Webbed.',
  },
  energy_shield: {
    name: 'Energy Shield',
    icon: '🔷',
    kind: 'defense',
    text: 'The first enemy ability or spell used against it fails. Does not block direct captures.',
  },
  backup_core: {
    name: 'Backup Core',
    icon: '💾',
    kind: 'defense',
    text: 'When destroyed, a Backup Drone is placed on or next to its square.',
  },
  gravity_field: {
    name: 'Gravity Field',
    icon: '🌌',
    kind: 'utility',
    text: 'Adjacent enemy pieces lose 1 movement.',
  },
  emp_burst: {
    name: 'EMP Burst',
    icon: '⚡',
    kind: 'utility',
    text: 'Every 4 turns: disable enemy abilities within 2 squares until your next turn.',
  },
  drone_launcher: {
    name: 'Drone Launcher',
    icon: '🤖',
    kind: 'utility',
    text: 'Once: deploy a Drone on an adjacent empty square.',
  },
  battlefield_scanner: {
    name: 'Battlefield Scanner',
    icon: '📡',
    kind: 'utility',
    text: '+1 movement for each adjacent enemy (max +3).',
  },
  adaptive_reactor: {
    name: 'Adaptive Reactor',
    icon: '☢',
    kind: 'utility',
    text: 'Every third turn: an extra Prototype action after your turn (no capturing).',
  },
  power_surge: {
    name: 'Power Surge',
    icon: '⚠',
    kind: 'instability',
    text: 'Next turn the Prototype must move toward the closest enemy if it can.',
  },
  motor_failure: {
    name: 'Motor Failure',
    icon: '🔧',
    kind: 'instability',
    text: 'Next turn the Prototype only moves 1 square.',
  },
  logic_conflict: {
    name: 'Logic Conflict',
    icon: '🧠',
    kind: 'instability',
    text: 'Its navigation glitches: it is immediately shunted to a random empty square within 2.',
  },
  thermal_overload: {
    name: 'Thermal Overload',
    icon: '🔥',
    kind: 'instability',
    text: 'Next turn the Prototype cannot capture.',
  },
  core_fracture: {
    name: 'Core Fracture',
    icon: '💀',
    kind: 'instability',
    text: 'Next turn the Prototype is locked down: it cannot move, capture or use abilities.',
  },
};

export const PROTOTYPE_UPGRADES = Object.keys(MUTATIONS).filter((id) => MUTATIONS[id].kind !== 'instability');
export const PROTOTYPE_INSTABILITIES = Object.keys(MUTATIONS).filter((id) => MUTATIONS[id].kind === 'instability');

export const FINAL_EVOLUTION_AT = 6;

export interface FinalFormInfo {
  id: PrototypeForm;
  name: string;
  icon: string;
  color: string;
  summary: string;
  perks: string[];
}

export const FINAL_FORMS: Record<PrototypeForm, FinalFormInfo> = {
  assault: {
    id: 'assault',
    name: 'Assault',
    icon: '⚔️',
    color: '#ff5a4a',
    summary: 'All-out aggression: longer reach and nowhere safe beside it.',
    perks: [
      '+1 movement: the long leg of its L reaches one square farther.',
      'Can also capture an enemy directly beside it (up, down, left or right).',
    ],
  },
  fortress: {
    id: 'fortress',
    name: 'Fortress',
    icon: '🏰',
    color: '#6f8dff',
    summary: 'A walking bunker that is very hard to remove.',
    perks: [
      'Bulwark: the first capture against it each day and each night is ignored (the attacker stays put).',
      'Immune to enemy abilities and spells.',
    ],
  },
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    icon: '🌫️',
    color: '#38d1ff',
    summary: 'Slips through anything and is never where you expect.',
    perks: [
      'Pieces and barriers never block its moves.',
      'Ghost Step: may instead drift to any empty square within 2 (no capture).',
    ],
  },
};

export function finalFormHint(form: PrototypeForm): string {
  const info = FINAL_FORMS[form];
  return `${info.summary} ${info.perks.join(' ')} Free action.`;
}

export function newPrototypeState(): PrototypeState {
  return {
    gained: 0,
    upgrades: [],
    hull: 0,
    shield: 0,
    chainUses: 0,
    quantumUses: 0,
    teleportCooldown: 0,
    empCooldown: 0,
    reactorTurns: 0,
    surge: 0,
    motor: 0,
    thermal: 0,
    lockdown: 0,
  };
}

export function ensureProto(piece: PieceState): PrototypeState {
  if (!piece.proto) piece.proto = newPrototypeState();
  return piece.proto;
}

export function protoHas(piece: PieceState, id: string): boolean {
  return Boolean(piece.proto?.upgrades.includes(id));
}

/** Core Fracture: no moves, captures or abilities this turn. */
export function protoLockedDown(piece: PieceState): boolean {
  return (piece.proto?.lockdown ?? 0) > 0;
}

/** Thermal Overload: no captures this turn. */
export function protoCannotCapture(piece: PieceState): boolean {
  return (piece.proto?.thermal ?? 0) > 0;
}

export function protoTier(piece: { proto?: PrototypeState }): number {
  return Math.min(3, Math.floor((piece.proto?.gained ?? 0) / 2));
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic per piece + game moment, so server and client agree. */
export function protoRng(state: GameState, piece: PieceState, salt: number): () => number {
  const p = piece.proto;
  return mulberry32(
    (state.rngSeed + state.turnCount * 7919 + (p?.gained ?? 0) * 104729 + salt * 31337 + hashId(piece.id)) >>> 0,
  );
}

export function rollMutationId(state: GameState, piece: PieceState): string {
  const owned = piece.proto?.upgrades ?? [];
  const pool = [...PROTOTYPE_UPGRADES.filter((id) => !owned.includes(id)), ...PROTOTYPE_INSTABILITIES];
  const rng = protoRng(state, piece, 1);
  return pool[Math.floor(rng() * pool.length)] ?? 'core_fracture';
}

/** Capture check with Overclock Weapons ignoring defenses. */
export function protoCaptureOption(state: GameState, piece: PieceState, pos: Coord): MoveOption | null {
  if (!inBounds(pos)) return null;
  if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, pos))) return null;
  const occ = pieceAt(state, pos);
  if (!occ) return { to: pos };
  if (occ.color === piece.color) return null;
  if (protoHas(piece, 'overclock_weapons')) return { to: pos, capture: true };
  if (hasEffect(occ, 'invincible') || hasEffect(occ, 'pause')) return null;
  if (fortifyBlocksCapture(piece, occ)) return null;
  return { to: pos, capture: true };
}

function adjacentEnemies(state: GameState, piece: PieceState): number {
  return state.pieces.filter((p) => p.color !== piece.color && chebyshev(p.pos, piece.pos) === 1).length;
}

export function protoMovementBonus(state: GameState, piece: PieceState): number {
  let bonus = movementBonus(piece);
  if (piece.proto?.form === 'assault') bonus += 1;
  if (protoHas(piece, 'battlefield_scanner')) bonus += Math.min(3, adjacentEnemies(state, piece));
  return bonus;
}

const ALL8: Coord[] = [
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
];

function closestEnemyDistance(state: GameState, piece: PieceState, from: Coord): number {
  let best = Infinity;
  for (const p of state.pieces) {
    if (p.color === piece.color) continue;
    best = Math.min(best, chebyshev(p.pos, from));
  }
  return best;
}

/**
 * Knight base (blocked by pieces on the long leg, like an un-jumping Knight), extended by mutations.
 * Movement bonus lengthens the long leg (2, 3, …).
 */
export function prototypeMoves(piece: PieceState, state: GameState): MoveOption[] {
  const p = piece.proto;
  const moves: MoveOption[] = [];
  const add = (m: MoveOption | null) => {
    if (m && !moves.some((x) => sameCoord(x.to, m.to))) moves.push(m);
  };

  if (protoLockedDown(piece)) return [];
  const noCapture = (list: MoveOption[]) => (protoCannotCapture(piece) ? list.filter((m) => !m.capture) : list);

  if ((p?.motor ?? 0) > 0) {
    for (const d of ALL8) add(protoCaptureOption(state, piece, { row: piece.pos.row + d.row, col: piece.pos.col + d.col }));
    return filterLegal(piece, state, noCapture(moves));
  }

  const phase = p?.form === 'phantom';
  const jump = phase || protoHas(piece, 'spider_chassis');
  const bonus = Math.max(0, protoMovementBonus(state, piece));
  const blockedAt = (pos: Coord) => {
    if (!inBounds(pos)) return true;
    if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, pos))) return !phase;
    if (jump) return false;
    const occ = pieceAt(state, pos);
    return Boolean(occ && occ.id !== piece.id);
  };

  for (let long = 2; long <= 2 + bonus; long++) {
    for (const [dr, dc] of [
      [long, 1],
      [long, -1],
      [-long, 1],
      [-long, -1],
      [1, long],
      [-1, long],
      [1, -long],
      [-1, -long],
    ]) {
      const to = { row: piece.pos.row + dr, col: piece.pos.col + dc };
      if (!inBounds(to)) continue;
      const vertical = Math.abs(dr) > Math.abs(dc);
      const stepR = vertical ? Math.sign(dr) : 0;
      const stepC = vertical ? 0 : Math.sign(dc);
      let clear = true;
      for (let i = 1; i < long; i++) {
        if (blockedAt({ row: piece.pos.row + stepR * i, col: piece.pos.col + stepC * i })) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      add(protoCaptureOption(state, piece, to));

      if (protoHas(piece, 'execution_protocol')) {
        const lunge = { row: to.row + stepR, col: to.col + stepC };
        const occ = inBounds(lunge) ? pieceAt(state, lunge) : undefined;
        if (occ && occ.color !== piece.color && !blockedAt(to)) {
          const opt = protoCaptureOption(state, piece, lunge);
          if (opt?.capture) add(opt);
        }
      }
    }
  }

  if (protoHas(piece, 'vector_thrusters')) {
    for (const d of ALL8) {
      if (d.row === 0 || d.col === 0) continue;
      for (let i = 1; i <= 1 + bonus; i++) {
        const to = { row: piece.pos.row + d.row * i, col: piece.pos.col + d.col * i };
        if (!inBounds(to)) break;
        add(protoCaptureOption(state, piece, to));
        if (blockedAt(to)) break;
      }
    }
  }

  if (p?.form === 'assault') {
    for (const d of ALL8) {
      if (d.row !== 0 && d.col !== 0) continue;
      const opt = protoCaptureOption(state, piece, { row: piece.pos.row + d.row, col: piece.pos.col + d.col });
      if (opt?.capture) add(opt);
    }
  }

  if (phase) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const to = { row: piece.pos.row + dr, col: piece.pos.col + dc };
        if ((dr === 0 && dc === 0) || !inBounds(to) || pieceAt(state, to)) continue;
        if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, to))) continue;
        add({ to });
      }
    }
  }

  let out = noCapture(moves);
  if ((p?.surge ?? 0) > 0) {
    const now = closestEnemyDistance(state, piece, piece.pos);
    const toward = out.filter((m) => m.capture || closestEnemyDistance(state, piece, m.to) < now);
    if (toward.length) out = toward;
  }
  return filterLegal(piece, state, out);
}

export function droneMoves(piece: PieceState, state: GameState): MoveOption[] {
  const moves: MoveOption[] = [];
  for (const d of [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 },
  ]) {
    for (let i = 1; i <= 2 + movementBonus(piece); i++) {
      const to = { row: piece.pos.row + d.row * i, col: piece.pos.col + d.col * i };
      if (!inBounds(to) || pieceAt(state, to)) break;
      if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, to))) break;
      moves.push({ to });
    }
  }
  for (const d of ALL8) {
    const to = { row: piece.pos.row + d.row, col: piece.pos.col + d.col };
    const opt = protoCaptureOption(state, { ...piece, proto: undefined }, to);
    if (opt?.capture) moves.push(opt);
  }
  return filterLegal(piece, state, moves);
}
