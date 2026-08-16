import type { GameState, PieceState } from '../types.js';
import { hasEffect, inBounds, pieceAt, sameCoord } from '../utils.js';
import {
  areaMoves,
  emptyOrEnemy,
  filterLegal,
  knightMoves,
  type PieceDefinition,
  rayMoves,
  standardPawnMoves,
} from './helpers.js';

const ORTH: { row: number; col: number }[] = [
  { row: 1, col: 0 },
  { row: -1, col: 0 },
  { row: 0, col: 1 },
  { row: 0, col: -1 },
];
const DIAG: { row: number; col: number }[] = [
  { row: 1, col: 1 },
  { row: 1, col: -1 },
  { row: -1, col: 1 },
  { row: -1, col: -1 },
];
const ALL8 = [...ORTH, ...DIAG];

function dayOnly(_p: PieceState, state: GameState) {
  return state.dayNight === 'day';
}
function nightOnly(_p: PieceState, state: GameState) {
  return state.dayNight === 'night';
}

export const PIECES: Record<string, PieceDefinition> = {
  pawn: {
    id: 'pawn',
    name: 'Pawn',
    class: 'pawn',
    symbol: '♟',
    promoteOptions: ['queen', 'angel', 'ghost', 'reaper'],
    getMoves: (p, s) => filterLegal(p, s, standardPawnMoves(p, s, false)),
  },
  nwap: {
    id: 'nwap',
    name: 'nwaP',
    class: 'pawn',
    symbol: '♙',
    promoteOptions: ['horse', 'snake', 'pig', 'bishop', 'scamman', 'wizard', 'rook', 'stoneman', 'gnome', 'demon', 'mimic'],
    getMoves: (p, s) => filterLegal(p, s, standardPawnMoves(p, s, true)),
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    class: 'pawn',
    symbol: '♟',
    promoteOptions: ['bishop', 'scamman', 'wizard', 'rook', 'stoneman', 'gnome'],
    getMoves: (p, s) => {
      const moves = [];
      const dir = p.color === 'white' ? -1 : 1;
      const up = emptyOrEnemy(s, { row: p.pos.row + dir, col: p.pos.col }, p.color);
      if (up && !up.capture) moves.push(up);
      for (const dc of [-1, 1]) {
        const down = emptyOrEnemy(s, { row: p.pos.row - dir, col: p.pos.col + dc }, p.color);
        if (down && !down.capture) moves.push(down);
      }
      if (!p.hasMoved) {
        for (const dc of [-1, 1]) {
          const to = { row: p.pos.row + dir * 2, col: p.pos.col + dc * 2 };
          const mid = { row: p.pos.row + dir, col: p.pos.col + dc };
          if (inBounds(to) && !pieceAt(s, mid) && !pieceAt(s, to)) moves.push({ to });
        }
      }
      // captures
      for (const dc of [-1, 1]) {
        const capUp = emptyOrEnemy(s, { row: p.pos.row + dir, col: p.pos.col + dc }, p.color);
        if (capUp?.capture) moves.push(capUp);
        const capDownDiag = emptyOrEnemy(s, { row: p.pos.row - dir, col: p.pos.col + dc }, p.color);
        if (capDownDiag?.capture) moves.push(capDownDiag);
      }
      const capDown = emptyOrEnemy(s, { row: p.pos.row - dir, col: p.pos.col }, p.color);
      if (capDown?.capture) moves.push(capDown);
      return filterLegal(p, s, moves);
    },
  },
  enchanted_pawn: {
    id: 'enchanted_pawn',
    name: 'Enchanted Pawn',
    class: 'pawn',
    symbol: '♟',
    promoteOptions: ['rook', 'stoneman', 'gnome'],
    getMoves: (p, s) => {
      const moves = [];
      const bonus = hasEffect(p, 'movement_plus') ? 1 : 0;
      const max = (!p.hasMoved ? 2 : 1) + bonus;
      for (const d of ORTH) {
        for (let i = 1; i <= max; i++) {
          const to = { row: p.pos.row + d.row * i, col: p.pos.col + d.col * i };
          if (!inBounds(to)) break;
          const barrier = s.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, to));
          if (barrier) continue; // phase over barriers
          const occ = pieceAt(s, to);
          if (occ) break;
          moves.push({ to });
          if (p.hasMoved && i >= 1 + bonus) break;
        }
      }
      for (const d of DIAG) {
        const to = { row: p.pos.row + d.row, col: p.pos.col + d.col };
        const opt = emptyOrEnemy(s, to, p.color);
        if (opt?.capture) moves.push(opt);
      }
      return filterLegal(p, s, moves);
    },
  },
  rook: {
    id: 'rook',
    name: 'Rook',
    class: 'rook',
    symbol: '♜',
    getMoves: (p, s) => {
      const moves = filterLegal(p, s, rayMoves(p, s, ORTH, 10));
      // castle: swap with adjacent king
      for (const d of [-1, 1]) {
        const kingPos = { row: p.pos.row, col: p.pos.col + d };
        const k = pieceAt(s, kingPos);
        if (k && k.class === 'king' && k.color === p.color) {
          moves.push({ to: kingPos, special: 'castle_swap', meta: { withId: k.id } });
        }
      }
      return moves;
    },
  },
  stoneman: {
    id: 'stoneman',
    name: 'Stoneman',
    class: 'rook',
    symbol: '♜',
    getMoves: (p, s) => filterLegal(p, s, rayMoves(p, s, ORTH, 3)),
  },
  gnome: {
    id: 'gnome',
    name: 'Gnome',
    class: 'rook',
    symbol: '♜',
    getMoves: (p, s) => filterLegal(p, s, rayMoves(p, s, ORTH, 2)),
  },
  horse: {
    id: 'horse',
    name: 'Horse',
    class: 'knight',
    symbol: '♞',
    getMoves: (p, s) => filterLegal(p, s, knightMoves(p, s, 2, 1, true)),
  },
  snake: {
    id: 'snake',
    name: 'Snake',
    class: 'knight',
    symbol: '♞',
    getMoves: (p, s) => {
      const jump = Boolean(p.bloodlust);
      const moves = knightMoves(p, s, 3, 1, jump);
      return filterLegal(p, s, moves);
    },
    onCapture: (attacker) => {
      attacker.bloodlust = true;
    },
  },
  pig: {
    id: 'pig',
    name: 'Pig',
    class: 'knight',
    symbol: '♞',
    canAct: dayOnly,
    getMoves: (p, s) => {
      const moves = knightMoves(p, s, 2, 1, false);
      // best buddy: share tile with allied non-king
      for (const ally of s.pieces.filter((x) => x.color === p.color && x.class !== 'king' && x.id !== p.id)) {
        moves.push({ to: ally.pos, special: 'best_buddy', meta: { withId: ally.id } });
      }
      return filterLegal(p, s, moves);
    },
  },
  bishop: {
    id: 'bishop',
    name: 'Bishop',
    class: 'bishop',
    symbol: '♝',
    getMoves: (p, s) => filterLegal(p, s, rayMoves(p, s, DIAG, 10)),
  },
  scamman: {
    id: 'scamman',
    name: 'TheScamMan',
    class: 'bishop',
    symbol: '♝',
    getMoves: (p, s) => filterLegal(p, s, rayMoves(p, s, DIAG, 1)),
  },
  wizard: {
    id: 'wizard',
    name: 'Wizard',
    class: 'bishop',
    symbol: '♝',
    getMoves: (p, s) => filterLegal(p, s, rayMoves(p, s, DIAG, 2)),
  },
  queen: {
    id: 'queen',
    name: 'Queen',
    class: 'queen',
    symbol: '♛',
    getMoves: (p, s) => filterLegal(p, s, rayMoves(p, s, ALL8, 10)),
  },
  angel: {
    id: 'angel',
    name: 'Angel',
    class: 'queen',
    symbol: '♛',
    getMoves: (p, s) => {
      // cannot move consecutively
      if (s.lastMove?.pieceId === p.id) return [];
      // cannot capture
      return filterLegal(
        p,
        s,
        rayMoves(p, s, ORTH, 1).filter((m) => !m.capture),
      );
    },
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    class: 'queen',
    symbol: '♛',
    getMoves: (p, s) => {
      // locked until first night
      if (!hasEffect(p, 'ghost_unlocked') && s.dayNight === 'day' && s.cycleCount < 5) {
        // unlock after first night begins; until then locked
        if (s.cycleCount === 0 && s.dayNight === 'day') return [];
      }
      if (s.cycleCount === 0 && s.dayNight === 'day') return [];
      return filterLegal(p, s, areaMoves(p, s, 2));
    },
  },
  reaper: {
    id: 'reaper',
    name: 'Reaper',
    class: 'queen',
    symbol: '♛',
    getMoves: (p, s) => {
      const moves = filterLegal(p, s, areaMoves(p, s, 1));
      const charges = p.charges ?? 0;
      if (charges >= 2) {
        moves.push(...filterLegal(p, s, areaMoves(p, s, 2)));
      }
      if (charges >= 4) {
        // death stare capture without moving
        for (const m of areaMoves(p, s, 2)) {
          if (m.capture) moves.push({ ...m, special: 'death_stare' });
        }
      }
      return moves;
    },
  },
  prince_princess: {
    id: 'prince_princess',
    name: 'Prince & Princess',
    class: 'wildcard',
    symbol: '♚',
    getMoves: (p, s) => {
      const moves = [
        ...rayMoves(p, s, ORTH, 3),
        ...rayMoves(p, s, DIAG, 1),
      ];
      return filterLegal(p, s, moves);
    },
  },
  demon: {
    id: 'demon',
    name: 'Demon',
    class: 'wildcard',
    symbol: '♟',
    canAct: nightOnly,
    getMoves: (p, s) => filterLegal(p, s, areaMoves(p, s, 1)),
    onCapture: (attacker, victim, state) => {
      // convert victim
      victim.color = attacker.color;
      victim.id = `converted_${victim.id}_${Date.now()}`;
      // keep on board by undoing graveyard push - handled in engine via special flag
      (victim as PieceState & { _convert?: boolean }).effects.push({
        id: `life_shard_${Date.now()}`,
        kind: 'converted',
      });
    },
  },
  mimic: {
    id: 'mimic',
    name: 'Mimic',
    class: 'wildcard',
    symbol: '♟',
    getMoves: (p, s) => {
      const last = s.lastMove;
      if (!last) return filterLegal(p, s, areaMoves(p, s, 1));
      const copied = s.pieces.find((x) => x.id === last.pieceId) ?? null;
      // use last moved piece's def even if captured: look at history via meta
      const defId = (last as { defId?: string }).defId;
      const id = copied?.defId ?? defId;
      if (!id || id === 'mimic') return filterLegal(p, s, areaMoves(p, s, 1));
      const def = PIECES[id];
      if (!def) return filterLegal(p, s, areaMoves(p, s, 1));
      // temporary: ignore day/night via timeless energy
      return def.getMoves(p, s);
    },
  },
  king: {
    id: 'king',
    name: 'King',
    class: 'king',
    symbol: '♚',
    getMoves: (p, s) => {
      let moves;
      if (hasEffect(p, 'kingsstead')) {
        moves = knightMoves(p, s, 2, 1, true);
      } else {
        const range = hasEffect(p, 'speed_plus') ? 2 : 1;
        moves = areaMoves(p, s, range);
      }
      return filterLegal(p, s, moves);
    },
  },
};

export const VARIANTS_BY_CLASS: Record<string, string[]> = {
  pawn: ['pawn', 'nwap', 'rogue', 'enchanted_pawn'],
  rook: ['rook', 'stoneman', 'gnome'],
  knight: ['horse', 'snake', 'pig'],
  bishop: ['bishop', 'scamman', 'wizard'],
  wildcard: ['prince_princess', 'demon', 'mimic'],
  queen: ['queen', 'angel', 'ghost', 'reaper'],
  king: ['king'],
};

export const DRAFT_ORDER: Array<keyof typeof VARIANTS_BY_CLASS> = [
  'pawn',
  'rook',
  'knight',
  'bishop',
  'wildcard',
  'queen',
];

export function getPieceDef(id: string): PieceDefinition {
  const def = PIECES[id];
  if (!def) throw new Error(`Unknown piece: ${id}`);
  return def;
}
