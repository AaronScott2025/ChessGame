import type {
  CardInstance,
  CastFrame,
  CastRecord,
  Color,
  Coord,
  GameState,
  PieceState,
} from '../types.js';
import { nearestEmptyAround, pieceAt, sameCoord } from '../utils.js';

const COLORS: Color[] = ['white', 'black'];

/** Piece fields Rally never rewinds: identity, and things handled separately (position, effects). */
const PIECE_SKIP = new Set(['id', 'color', 'pos', 'effects', 'hasMoved', 'castUndo']);

/** Player fields that are bookkeeping rather than card outcomes. */
const PLAYER_SKIP = new Set([
  'color',
  'connected',
  'name',
  'hand',
  'discard',
  'graveyard',
  'activeSpells',
  'spellsThisTurn',
  'maxSpellsThisTurn',
  'openingRedrawUsed',
  'lastPlayedCardDefId',
]);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export function castFrame(state: GameState): CastFrame {
  return structuredClone({
    pieces: state.pieces,
    tokens: state.tokens,
    players: state.players,
    deck: state.deck,
    discardPile: state.discardPile,
  });
}

function newCastId(state: GameState, color: Color): string {
  return `cast_${color}_${state.turnCount}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Start a record for a cast that finishes later (Gambler prompts). */
export function openCast(
  state: GameState,
  color: Color,
  defId: string,
  instanceId: string,
  before: CastFrame,
): void {
  state.castRecords = {
    ...state.castRecords,
    [color]: { castId: newCastId(state, color), defId, instanceId, before },
  };
}

/** Tag everything the cast created and store the resolved board so Rally can undo it. */
export function closeCast(state: GameState, color: Color): void {
  const rec = state.castRecords?.[color];
  if (!rec || rec.after) return;
  const beforePieces = new Map(rec.before.pieces.map((p) => [p.id, p]));
  for (const p of state.pieces) {
    const prior = new Set(beforePieces.get(p.id)?.effects.map((e) => e.id) ?? []);
    for (const e of p.effects) {
      if (!prior.has(e.id)) e.castId = rec.castId;
    }
  }
  const priorTokens = new Set(rec.before.tokens.map((t) => t.id));
  for (const t of state.tokens) {
    if (!priorTokens.has(t.id)) t.castId = rec.castId;
  }
  for (const z of state.zones ?? []) {
    if (!z.castId) z.castId = rec.castId;
  }
  rec.after = castFrame(state);
}

export function recordCast(
  state: GameState,
  color: Color,
  defId: string,
  instanceId: string,
  before: CastFrame,
): void {
  openCast(state, color, defId, instanceId, before);
  closeCast(state, color);
}

type CardLoc = { key: string; list: (s: CastFrame) => CardInstance[] };

function cardLocations(frame: CastFrame): Map<string, string> {
  const out = new Map<string, string>();
  for (const loc of CARD_LOCS) {
    for (const c of loc.list(frame)) out.set(c.instanceId, loc.key);
  }
  return out;
}

const CARD_LOCS: CardLoc[] = [
  { key: 'hand:white', list: (s) => s.players.white.hand },
  { key: 'hand:black', list: (s) => s.players.black.hand },
  { key: 'deck', list: (s) => s.deck },
  { key: 'discardPile', list: (s) => s.discardPile },
];

function locList(state: GameState, key: string): CardInstance[] {
  return CARD_LOCS.find((l) => l.key === key)!.list(state);
}

function graveDiff(
  from: CastFrame['players'][Color]['graveyard'],
  to: CastFrame['players'][Color]['graveyard'],
): CastFrame['players'][Color]['graveyard'] {
  const rest = [...to];
  const missing: typeof from = [];
  for (const g of from) {
    const i = rest.findIndex((r) => r.defId === g.defId && r.class === g.class);
    if (i >= 0) rest.splice(i, 1);
    else missing.push(g);
  }
  return missing;
}

function dropGrave(state: GameState, color: Color, defId: string): void {
  const gy = state.players[color].graveyard;
  for (let i = gy.length - 1; i >= 0; i--) {
    if (gy[i].defId === defId) {
      gy.splice(i, 1);
      return;
    }
  }
}

function placeNear(state: GameState, piece: PieceState, target: Coord): boolean {
  const dest = pieceAt(state, target) ? nearestEmptyAround(state, target) : target;
  if (!dest) return false;
  piece.pos = { ...dest };
  return true;
}

/**
 * Undo `color`'s last recorded cast: remove what it created (including effects it later turned into),
 * bring back what it destroyed, and put moved pieces and cards back where they were.
 * Returns the canceled card's defId, or null when there is nothing on record.
 */
export function revertCast(state: GameState, color: Color): string | null {
  const rec: CastRecord | undefined = state.castRecords?.[color];
  if (!rec?.after) return null;
  const { before: B, after: A, castId } = rec;
  const bPieces = new Map(B.pieces.map((p) => [p.id, p]));
  const aPieces = new Map(A.pieces.map((p) => [p.id, p]));

  // Pieces the cast created (revives, summons, bonus queens) leave the board; their fallen entry returns.
  const revivedEntries = new Map<Color, CastFrame['players'][Color]['graveyard']>();
  for (const c of COLORS) revivedEntries.set(c, graveDiff(B.players[c].graveyard, A.players[c].graveyard));
  for (const ap of A.pieces) {
    if (bPieces.has(ap.id)) continue;
    const cur = state.pieces.find((p) => p.id === ap.id);
    if (!cur) continue;
    state.pieces = state.pieces.filter((p) => p.id !== ap.id);
    const entries = revivedEntries.get(cur.color)!;
    const i = entries.findIndex((g) => g.class === cur.class);
    if (i >= 0) state.players[cur.color].graveyard.push(entries.splice(i, 1)[0]);
  }

  // Pieces the cast destroyed come back (and leave the graveyard).
  const restored: PieceState[] = [];
  for (const bp of B.pieces) {
    if (aPieces.has(bp.id) || state.pieces.some((p) => p.id === bp.id)) continue;
    const piece = clone(bp);
    piece.effects = piece.effects.filter((e) => e.castId !== castId);
    dropGrave(state, piece.color, piece.defId);
    piece.pos = { row: -99, col: -99 };
    state.pieces.push(piece);
    restored.push(piece);
  }

  // Changed piece fields (Swap variants, charges, links, start squares…) go back if untouched since.
  const movers: Array<{ piece: PieceState; to: Coord }> = restored.map((p) => ({
    piece: p,
    to: bPieces.get(p.id)!.pos,
  }));
  for (const cur of state.pieces) {
    const bp = bPieces.get(cur.id);
    const ap = aPieces.get(cur.id);
    if (!bp || !ap) continue;
    const keys = new Set([...Object.keys(bp), ...Object.keys(ap)]);
    const fields = cur as unknown as Record<string, unknown>;
    for (const k of keys) {
      if (PIECE_SKIP.has(k)) continue;
      const bv = (bp as unknown as Record<string, unknown>)[k];
      const av = (ap as unknown as Record<string, unknown>)[k];
      if (same(bv, av) || !same(fields[k], av)) continue;
      if (bv === undefined) delete fields[k];
      else fields[k] = clone(bv);
    }
    if (!sameCoord(bp.pos, ap.pos) && sameCoord(cur.pos, ap.pos)) movers.push({ piece: cur, to: bp.pos });

    // Effects the cast removed (an older Blink, effects canceled by a Rally) come back.
    const aIds = new Set(ap.effects.map((e) => e.id));
    for (const e of bp.effects) {
      if (!aIds.has(e.id) && !cur.effects.some((x) => x.id === e.id)) cur.effects.push(clone(e));
    }
  }

  // Delayed outcomes that already happened (Enchant finished, Recall fired).
  for (const cur of state.pieces) {
    const undo = cur.castUndo;
    if (!undo || undo.castId !== castId) continue;
    if (undo.defId && undo.class) {
      cur.defId = undo.defId;
      cur.class = undo.class;
      if (undo.charges === undefined) delete cur.charges;
      else cur.charges = undo.charges;
    }
    if (undo.from && undo.at && sameCoord(cur.pos, undo.at)) movers.push({ piece: cur, to: undo.from });
    delete cur.castUndo;
  }

  // Everything the cast created, including pending effects that have since converted.
  for (const p of state.pieces) p.effects = p.effects.filter((e) => e.castId !== castId);

  // Lift every mover first so pieces that traded squares can swap back.
  const homes = movers.map((m) => ({ ...m.piece.pos }));
  for (const m of movers) m.piece.pos = { row: -99, col: -99 };
  movers.forEach((m, i) => {
    if (!placeNear(state, m.piece, m.to) && homes[i].row >= 0) m.piece.pos = homes[i];
  });
  state.pieces = state.pieces.filter((p) => p.pos.row >= 0);

  // Tokens: drop the cast's own (barriers, portals, blink marks), restore ones it replaced.
  state.tokens = state.tokens.filter((t) => t.castId !== castId);
  if (state.zones) {
    for (const z of state.zones) {
      if (z.castId !== castId) continue;
      for (const v of z.victims ?? []) {
        if (state.pieces.some((p) => p.id === v.id)) continue;
        const piece = clone(v);
        piece.pos = { row: -99, col: -99 };
        if (placeNear(state, piece, v.pos)) {
          dropGrave(state, piece.color, piece.defId);
          state.pieces.push(piece);
        }
      }
    }
    state.zones = state.zones.filter((z) => z.castId !== castId);
  }
  const aTokens = new Set(A.tokens.map((t) => t.id));
  for (const t of B.tokens) {
    if (!aTokens.has(t.id) && !state.tokens.some((x) => x.id === t.id)) state.tokens.push(clone(t));
  }

  // Cards moved by the cast (Blind Gambit, Rewind) return, except the cast card itself.
  const bLoc = cardLocations(B);
  const aLoc = cardLocations(A);
  const curLoc = cardLocations(state);
  for (const [id, from] of bLoc) {
    if (id === rec.instanceId) continue;
    const to = aLoc.get(id);
    if (!to || to === from || curLoc.get(id) !== to) continue;
    const list = locList(state, to);
    const idx = list.findIndex((c) => c.instanceId === id);
    if (idx < 0) continue;
    const [card] = list.splice(idx, 1);
    locList(state, from).push(card);
  }

  // Player-level outcomes (skipped turns, army changes…) revert if still in place.
  for (const c of COLORS) {
    const bp = B.players[c] as unknown as Record<string, unknown>;
    const ap = A.players[c] as unknown as Record<string, unknown>;
    const cur = state.players[c] as unknown as Record<string, unknown>;
    for (const k of new Set([...Object.keys(bp), ...Object.keys(ap)])) {
      if (PLAYER_SKIP.has(k)) continue;
      if (same(bp[k], ap[k]) || !same(cur[k], ap[k])) continue;
      if (bp[k] === undefined) delete cur[k];
      else cur[k] = clone(bp[k]);
    }
    const aSpells = new Set(A.players[c].activeSpells.map((s) => s.instanceId));
    const bSpells = new Set(B.players[c].activeSpells.map((s) => s.instanceId));
    state.players[c].activeSpells = state.players[c].activeSpells.filter(
      (s) => bSpells.has(s.instanceId) || !aSpells.has(s.instanceId),
    );
    for (const s of B.players[c].activeSpells) {
      if (!aSpells.has(s.instanceId) && !state.players[c].activeSpells.some((x) => x.instanceId === s.instanceId)) {
        state.players[c].activeSpells.push(clone(s));
      }
    }
  }

  delete state.castRecords![color];
  return rec.defId;
}
