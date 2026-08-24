import type { Coord, GameState, PieceClass, PieceState } from '../types.js';
import {
  clearOrthogonalLOS,
  hasEffect,
  inBounds,
  isAlliedTerritory,
  movementBonus,
  pieceAt,
  sameCoord,
  chebyshev,
  vampireNightRadius,
} from '../utils.js';
import {
  areaMoves,
  chebyshevPathBlocked,
  emptyOrEnemy,
  filterLegal,
  knightMoves,
  knightTargetCoords,
  isPigLShape,
  type MoveOption,
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

function coordKey(c: Coord): string {
  return `${c.row},${c.col}`;
}

function wormPathClear(
  state: GameState,
  from: Coord,
  dir: Coord,
  hop: number,
): Coord | null {
  for (let i = 1; i < hop; i++) {
    const mid = { row: from.row + dir.row * i, col: from.col + dir.col * i };
    if (!inBounds(mid)) return null;
    if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, mid))) return null;
    if (pieceAt(state, mid)) return null;
  }
  const dest = { row: from.row + dir.row * hop, col: from.col + dir.col * hop };
  if (!inBounds(dest)) return null;
  if (state.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, dest))) return null;
  return dest;
}

function wormAlliesOrtho(state: GameState, pos: Coord, piece: PieceState): PieceState[] {
  const allies: PieceState[] = [];
  for (const d of ORTH) {
    const n = { row: pos.row + d.row, col: pos.col + d.col };
    if (!inBounds(n)) continue;
    const occ = pieceAt(state, n);
    if (occ && occ.color === piece.color && occ.id !== piece.id) allies.push(occ);
  }
  return allies;
}

/** Squares within `radius` of an ally (clear king-step path from that ally). */
function wormBurrowFromAlly(
  state: GameState,
  ally: PieceState,
  piece: PieceState,
  radius: number,
): NonNullable<ReturnType<typeof emptyOrEnemy>>[] {
  const out: NonNullable<ReturnType<typeof emptyOrEnemy>>[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (chebyshev({ row: 0, col: 0 }, { row: dr, col: dc }) > radius) continue;
      const dest = { row: ally.pos.row + dr, col: ally.pos.col + dc };
      if (sameCoord(dest, piece.pos)) continue;
      if (chebyshevPathBlocked(ally.pos, dest, state)) continue;
      const opt = emptyOrEnemy(state, dest, piece.color, piece);
      if (opt) out.push(opt);
    }
  }
  return out;
}

function wormAlliesBeside(state: GameState, pos: Coord, piece: PieceState): PieceState[] {
  const allies: PieceState[] = [];
  for (const d of ALL8) {
    const n = { row: pos.row + d.row, col: pos.col + d.col };
    if (!inBounds(n)) continue;
    const occ = pieceAt(state, n);
    if (occ && occ.color === piece.color && occ.id !== piece.id) allies.push(occ);
  }
  return allies;
}

function wormAllyIsAhead(piece: PieceState, landing: Coord, ally: PieceState): boolean {
  return piece.color === 'white' ? ally.pos.row < landing.row : ally.pos.row > landing.row;
}

/**
 * 2 orthogonal, then Burrow: up to 2 from the first ally, then 1 from each
 * further ally that sits ahead of a square you can already reach.
 */
function wormMoves(piece: PieceState, state: GameState): MoveOption[] {
  const hop = 2 + movementBonus(piece);
  const firstRadius = 2 + movementBonus(piece);
  const chainRadius = 1 + movementBonus(piece);
  const moves: NonNullable<ReturnType<typeof emptyOrEnemy>>[] = [];
  const seenLand = new Set<string>();
  const usedAllies = new Set<string>();
  const allyQ: Array<{ ally: PieceState; radius: number }> = [];

  const addMove = (opt: NonNullable<ReturnType<typeof emptyOrEnemy>>) => {
    const k = coordKey(opt.to);
    if (seenLand.has(k)) return false;
    seenLand.add(k);
    moves.push(opt);
    return true;
  };

  const enqueueAlly = (ally: PieceState, radius: number) => {
    if (usedAllies.has(ally.id)) return;
    usedAllies.add(ally.id);
    allyQ.push({ ally, radius });
  };

  const chainFromLanding = (landing: Coord, radius: number) => {
    for (const ally of wormAlliesBeside(state, landing, piece)) {
      if (wormAllyIsAhead(piece, landing, ally)) enqueueAlly(ally, radius);
    }
  };

  for (const ally of wormAlliesOrtho(state, piece.pos, piece)) enqueueAlly(ally, firstRadius);

  for (const d of ORTH) {
    const dest = wormPathClear(state, piece.pos, d, hop);
    if (!dest) continue;
    const opt = emptyOrEnemy(state, dest, piece.color, piece);
    if (!opt) continue;
    addMove(opt);
    if (!opt.capture) chainFromLanding(dest, firstRadius);
  }

  while (allyQ.length) {
    const { ally, radius } = allyQ.shift()!;
    const nextRadius = chainRadius;
    for (const opt of wormBurrowFromAlly(state, ally, piece, radius)) {
      addMove(opt);
      if (!opt.capture) chainFromLanding(opt.to, nextRadius);
    }
  }

  return moves;
}

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
    promoteOptions: ['queen', 'angel', 'ghost', 'reaper', 'snail', 'vampire'],
    getMoves: (p, s) => filterLegal(p, s, standardPawnMoves(p, s, false)),
  },
  nwap: {
    id: 'nwap',
    name: 'nwaP',
    class: 'pawn',
    symbol: '♙',
    promoteOptions: ['horse', 'snake', 'pig', 'archer', 'bishop', 'scamman', 'wizard', 'worm', 'rook', 'stoneman', 'gnome', 'demon', 'mimic'],
    getMoves: (p, s) => filterLegal(p, s, standardPawnMoves(p, s, true)),
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    class: 'pawn',
    symbol: '♟',
    promoteOptions: ['bishop', 'scamman', 'wizard', 'worm', 'rook', 'stoneman', 'gnome'],
    getMoves: (p, s) => {
      const moves = [];
      const dir = p.color === 'white' ? -1 : 1;
      // Move 1 square up (non-capture)
      const up = emptyOrEnemy(s, { row: p.pos.row + dir, col: p.pos.col }, p.color, p);
      if (up && !up.capture) moves.push(up);
      // Move 1 square diagonally down (left or right, non-capture)
      for (const dc of [-1, 1]) {
        const down = emptyOrEnemy(s, { row: p.pos.row - dir, col: p.pos.col + dc }, p.color, p);
        if (down && !down.capture) moves.push(down);
      }
      // First move: up to 2 tiles forward (non-capture), path must be clear
      if (!p.hasMoved) {
        const mid = { row: p.pos.row + dir, col: p.pos.col };
        const two = { row: p.pos.row + dir * 2, col: p.pos.col };
        const blocked = (c: { row: number; col: number }) =>
          pieceAt(s, c) || s.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, c));
        if (inBounds(two) && !blocked(mid) && !blocked(two)) moves.push({ to: two });
      }
      // Captures: diagonally up, diagonally down, or vertically down
      for (const dc of [-1, 1]) {
        const capUp = emptyOrEnemy(s, { row: p.pos.row + dir, col: p.pos.col + dc }, p.color, p);
        if (capUp?.capture) moves.push(capUp);
        const capDownDiag = emptyOrEnemy(s, { row: p.pos.row - dir, col: p.pos.col + dc }, p.color, p);
        if (capDownDiag?.capture) moves.push(capDownDiag);
      }
      const capDown = emptyOrEnemy(s, { row: p.pos.row - dir, col: p.pos.col }, p.color, p);
      if (capDown?.capture) moves.push(capDown);
      return filterLegal(p, s, moves);
    },
  },
  leapfrog: {
    id: 'leapfrog',
    name: 'Leapfrog',
    class: 'pawn',
    symbol: '♟',
    promoteOptions: ['queen', 'angel', 'ghost', 'reaper', 'snail', 'vampire'],
    getMoves: (p, s) => {
      const moves = [];
      const dir = p.color === 'white' ? -1 : 1;
      const fwd = emptyOrEnemy(s, { row: p.pos.row + dir, col: p.pos.col }, p.color, p);
      if (fwd && !fwd.capture) moves.push(fwd);
      for (const dc of [-1, 1]) {
        const side = emptyOrEnemy(s, { row: p.pos.row, col: p.pos.col + dc }, p.color, p);
        if (side?.capture) moves.push(side);
      }
      for (const d of ALL8) {
        const mid = { row: p.pos.row + d.row, col: p.pos.col + d.col };
        const to = { row: p.pos.row + d.row * 2, col: p.pos.col + d.col * 2 };
        if (!inBounds(mid) || !inBounds(to)) continue;
        const ally = pieceAt(s, mid);
        if (!ally || ally.color !== p.color || ally.id === p.id) continue;
        const land = emptyOrEnemy(s, to, p.color, p);
        if (land) moves.push(land);
      }
      return filterLegal(p, s, moves);
    },
  },
  spider: {
    id: 'spider',
    name: 'Spider',
    class: 'pawn',
    symbol: '♟',
    getMoves: (p, s) => {
      const moves = [];
      const dir = p.color === 'white' ? -1 : 1;
      const blocked = (c: { row: number; col: number }) =>
        pieceAt(s, c) || s.tokens.some((t) => t.kind === 'barrier' && sameCoord(t.pos, c));
      const fwd = { row: p.pos.row + dir, col: p.pos.col };
      if (inBounds(fwd) && !blocked(fwd)) moves.push({ to: fwd });
      if (!p.hasMoved) {
        const two = { row: p.pos.row + dir * 2, col: p.pos.col };
        if (inBounds(fwd) && !blocked(fwd) && inBounds(two) && !blocked(two)) {
          moves.push({ to: two });
        }
        for (const dc of [-1, 1]) {
          const diag = { row: p.pos.row + dir, col: p.pos.col + dc };
          if (inBounds(diag) && !blocked(diag)) moves.push({ to: diag });
          const diagTwo = { row: p.pos.row + dir * 2, col: p.pos.col + dc * 2 };
          if (inBounds(diag) && !blocked(diag) && inBounds(diagTwo) && !blocked(diagTwo)) {
            moves.push({ to: diagTwo });
          }
        }
      }
      for (const dc of [-1, 1]) {
        const cap = emptyOrEnemy(s, { row: p.pos.row + dir, col: p.pos.col + dc }, p.color, p);
        if (cap?.capture) moves.push(cap);
      }
      return filterLegal(p, s, moves);
    },
  },
  enchanted_pawn: {
    id: 'enchanted_pawn',
    name: 'Crystalite',
    class: 'pawn',
    symbol: '♟',
    getMoves: (p, s) => {
      const moves = [];
      const bonus = movementBonus(p);
      const max = (!p.hasMoved ? 2 : 1) + bonus;
      for (const d of ORTH) {
        for (let i = 1; i <= max; i++) {
          const to = { row: p.pos.row + d.row * i, col: p.pos.col + d.col * i };
          if (!inBounds(to)) break;
          const occ = pieceAt(s, to);
          if (occ) break;
          // Barrier Phase: may occupy and pass through barrier tiles
          moves.push({ to });
        }
      }
      for (const d of DIAG) {
        const to = { row: p.pos.row + d.row, col: p.pos.col + d.col };
        if (!inBounds(to)) continue;
        const occ = pieceAt(s, to);
        if (
          occ &&
          occ.color !== p.color &&
          !hasEffect(occ, 'invincible') &&
          !hasEffect(occ, 'pause')
        ) {
          moves.push({ to, capture: true });
        }
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
    name: 'Golem',
    class: 'rook',
    symbol: '♜',
    getMoves: (p, s) => {
      const moves = rayMoves(p, s, ORTH, 3);
      // Ancient Shuffle: swap with allied piece while in allied territory with clear orth. LOS
      if (isAlliedTerritory(p.color, p.pos)) {
        for (const ally of s.pieces.filter((x) => x.color === p.color && x.id !== p.id)) {
          if (!isAlliedTerritory(p.color, ally.pos)) continue;
          if (!clearOrthogonalLOS(s, p.pos, ally.pos)) continue;
          moves.push({
            to: { ...ally.pos },
            special: 'ancient_shuffle',
            meta: { withId: ally.id },
          });
        }
      }
      return filterLegal(p, s, moves);
    },
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
      const moves = knightMoves(p, s, 2, 1, jump);
      // Bloodlust: +1/-1 on either leg of the L
      if (p.bloodlust) {
        moves.push(...knightMoves(p, s, 3, 1, true));
        moves.push(...knightMoves(p, s, 1, 1, true));
        moves.push(...knightMoves(p, s, 2, 2, true));
      }
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
      const moves = knightMoves(p, s, 2, 1, false, true);
      // Best Buddy: only allies on the Pig’s normal L landings (same path rules as movement)
      for (const to of knightTargetCoords(p, s, 2, 1, false, true)) {
        const ally = pieceAt(s, to);
        if (!ally || ally.color !== p.color || ally.id === p.id || ally.class === 'king') continue;
        if (!isPigLShape(p.pos, to, movementBonus(p))) continue;
        moves.push({ to: { ...to }, special: 'best_buddy', meta: { withId: ally.id } });
      }
      return filterLegal(p, s, moves);
    },
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    class: 'knight',
    symbol: '♞',
    getMoves: (p, s) => {
      const step = areaMoves(p, s, 1).filter((m) => !m.capture);
      const shots = knightMoves(p, s, 2, 1, true)
        .filter((m) => m.capture)
        .map((m) => ({ ...m, special: 'archer_shot' }));
      return filterLegal(p, s, [...step, ...shots]);
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
    name: 'Fleece',
    class: 'bishop',
    symbol: '♝',
    getMoves: (p, s) => {
      const stolen = p.copiedMoveDefId;
      if (stolen && stolen !== 'scamman') {
        const def = PIECES[stolen];
        if (def) {
          const copied = def.getMoves(p, s).filter((m) => !m.special);
          return filterLegal(p, s, copied);
        }
      }
      return filterLegal(p, s, rayMoves(p, s, DIAG, 1));
    },
  },
  wizard: {
    id: 'wizard',
    name: 'Wizard',
    class: 'bishop',
    symbol: '♝',
    getMoves: (p, s) => filterLegal(p, s, rayMoves(p, s, DIAG, 2)),
  },
  worm: {
    id: 'worm',
    name: 'Worm',
    class: 'bishop',
    symbol: '♝',
    getMoves: (p, s) => filterLegal(p, s, wormMoves(p, s)),
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
      // Locked until the first night of the game
      const unlocked =
        hasEffect(p, 'ghost_unlocked') || s.dayNight === 'night' || s.cycleCount >= 5;
      if (!unlocked) return [];
      let moves = areaMoves(p, s, 2);
      // Phase Walk: can move over pieces only during Night
      if (s.dayNight !== 'night') {
        moves = moves.filter((m) => !chebyshevPathBlocked(p.pos, m.to, s));
      }
      return filterLegal(p, s, moves);
    },
  },
  reaper: {
    id: 'reaper',
    name: 'Reaper',
    class: 'queen',
    symbol: '♛',
    getMoves: (p, s) => {
      const charges = p.charges ?? 0;
      const radius = charges >= 2 ? 2 : 1;
      const moves = areaMoves(p, s, radius);
      // Swap of Fates (1+ charges): swap with any allied piece
      if (charges >= 1) {
        for (const ally of s.pieces.filter((x) => x.color === p.color && x.id !== p.id)) {
          moves.push({
            to: { ...ally.pos },
            special: 'swap_of_fates',
            meta: { withId: ally.id },
          });
        }
      }
      // Death Stare (4+ charges): capture in area without moving
      if (charges >= 4) {
        for (const m of areaMoves(p, s, 2)) {
          if (m.capture) moves.push({ ...m, special: 'death_stare' });
        }
      }
      return filterLegal(p, s, moves);
    },
  },
  snail: {
    id: 'snail',
    name: 'Snail',
    class: 'queen',
    symbol: '♛',
    getMoves: (p, s) => {
      if (p.defId === 'snail' && (p.charges ?? 0) <= 0) return [];
      return filterLegal(p, s, areaMoves(p, s, 1));
    },
  },
  vampire: {
    id: 'vampire',
    name: 'Vampire',
    class: 'queen',
    symbol: '♛',
    getMoves: (p, s) => {
      if (s.dayNight !== 'night') {
        return filterLegal(p, s, rayMoves(p, s, ORTH, 1));
      }
      return filterLegal(p, s, areaMoves(p, s, vampireNightRadius(p.charges ?? 0)));
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
      // Copy opponent's last played piece movement only
      if (!last || last.color === p.color) {
        return filterLegal(p, s, areaMoves(p, s, 1));
      }
      let id = last.defId;
      if (id === 'mimic') {
        id = (last as { copiedDefId?: string }).copiedDefId;
      }
      if (!id || id === 'mimic') return filterLegal(p, s, areaMoves(p, s, 1));
      const def = PIECES[id];
      if (!def) return filterLegal(p, s, areaMoves(p, s, 1));
      // Timeless Energy: ignore day/night by calling getMoves directly (skip canAct).
      // Strip specials so abilities (Best Buddy, swaps, Death Stare, castle, …) are never copied.
      const copied = def.getMoves(p, s).filter((m) => !m.special);
      return filterLegal(p, s, copied);
    },
  },
  gambler: {
    id: 'gambler',
    name: 'Gambler',
    class: 'wildcard',
    symbol: '♟',
    getMoves: (p, s) => {
      if (s.dayNight === 'night') {
        return filterLegal(p, s, rayMoves(p, s, DIAG, 1));
      }
      const styleId = p.gamblerStyleDefId;
      if (!styleId || styleId === 'gambler' || !PIECES[styleId]) {
        return filterLegal(p, s, areaMoves(p, s, 1));
      }
      const copied = PIECES[styleId].getMoves(p, s).filter((m) => !m.special);
      return filterLegal(p, s, copied);
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
  pawn: ['pawn', 'nwap', 'rogue', 'enchanted_pawn', 'leapfrog', 'spider'],
  rook: ['rook', 'stoneman', 'gnome'],
  knight: ['horse', 'snake', 'pig', 'archer'],
  bishop: ['bishop', 'scamman', 'wizard', 'worm'],
  wildcard: ['prince_princess', 'demon', 'mimic', 'gambler'],
  queen: ['queen', 'angel', 'ghost', 'reaper', 'snail', 'vampire'],
  king: ['king'],
};

export const DRAFT_ORDER: PieceClass[] = [
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

export function rollGamblerStyles(state: GameState, rng: () => number, onlyUnrolled = false): string[] {
  const logs: string[] = [];
  const gamblers = state.pieces.filter((p) => p.defId === 'gambler');
  const taken = new Set(
    onlyUnrolled
      ? gamblers.map((g) => g.gamblerStyleDefId).filter((id): id is string => Boolean(id))
      : [],
  );
  for (const g of gamblers) {
    if (onlyUnrolled && g.gamblerStyleDefId) continue;
    const exclude = new Set(taken);
    if (g.gamblerPrevStyleDefId) exclude.add(g.gamblerPrevStyleDefId);
    let pool = Object.keys(PIECES).filter((id) => id !== 'gambler' && !exclude.has(id));
    if (!pool.length) {
      pool = Object.keys(PIECES).filter((id) => id !== 'gambler' && id !== g.gamblerPrevStyleDefId);
    }
    if (!pool.length) pool = Object.keys(PIECES).filter((id) => id !== 'gambler');
    const pick = pool[Math.floor(rng() * pool.length)]!;
    g.gamblerPrevStyleDefId = g.gamblerStyleDefId;
    g.gamblerStyleDefId = pick;
    taken.add(pick);
    const styleName = PIECES[pick]?.name ?? pick;
    logs.push(`${g.color} Gambler rolled ${styleName} movement`);
  }
  return logs;
}
