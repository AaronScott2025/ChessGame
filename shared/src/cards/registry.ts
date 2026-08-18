import type { CardInstance, Color, Coord, GameState, PieceState } from '../types.js';
import { MAX_HAND } from '../types.js';
import { cloneState, log, mulberry32, opposite, shuffleInPlace } from '../utils.js';

export interface CardContext {
  state: GameState;
  player: Color;
  card: CardInstance;
  rng: () => number;
}

export type TargetingMode =
  | 'none'
  | 'piece'
  | 'allied_piece'
  | 'enemy_piece'
  | 'any_piece_non_king'
  | 'empty_allied'
  | 'empty_any'
  | 'square'
  | 'multi_allied'
  | 'variant_choice'
  | 'graveyard'
  | 'active_spell';

export interface CardDefinition {
  id: string;
  name: string;
  description: string[];
  image: string;
  /** Starting hand cannot include Rally */
  tags?: Array<'rally' | 'instant' | 'persistent'>;
  playOnOpponentTurn?: boolean;
  copiesInDeck?: number;
  targeting: TargetingMode;
  targetCount?: number;
  canPlay?: (ctx: CardContext) => string | null;
  /** Return null if needs more targeting via pending prompt; otherwise apply. */
  play: (ctx: CardContext, targets: unknown[]) => { state: GameState; done: boolean; message?: string };
}

export const CARD_REGISTRY: Record<string, CardDefinition> = {};

export function registerCard(def: CardDefinition): void {
  CARD_REGISTRY[def.id] = def;
}

export function getCardDef(id: string): CardDefinition {
  const def = CARD_REGISTRY[id];
  if (!def) throw new Error(`Unknown card: ${id}`);
  return def;
}

export function buildDeck(seed: number): CardInstance[] {
  const rng = mulberry32(seed);
  const deck: CardInstance[] = [];
  let n = 0;
  for (const def of Object.values(CARD_REGISTRY)) {
    const copies = def.copiesInDeck ?? 2;
    for (let i = 0; i < copies; i++) {
      deck.push({ instanceId: `card_${def.id}_${n++}`, defId: def.id });
    }
  }
  return shuffleInPlace(deck, rng);
}

export function drawCard(state: GameState, color: Color, opts?: { avoidRally?: boolean; avoidDupes?: boolean; ignoreLimit?: boolean }): CardInstance | null {
  const player = state.players[color];
  if (!opts?.ignoreLimit && player.hand.length >= MAX_HAND) return null;

  const tryDraw = (): CardInstance | null => {
    if (!state.deck.length) {
      if (!state.discardPile.length) return null;
      const rng = mulberry32(state.rngSeed + state.turnCount * 17);
      state.deck = shuffleInPlace([...state.discardPile], rng);
      state.discardPile = [];
    }
    return state.deck.pop() ?? null;
  };

  for (let attempt = 0; attempt < 40; attempt++) {
    const card = tryDraw();
    if (!card) return null;
    const def = getCardDef(card.defId);
    if (opts?.avoidRally && def.tags?.includes('rally')) {
      state.deck.unshift(card);
      // move to bottom
      state.deck = [card, ...state.deck.filter((c) => c.instanceId !== card.instanceId)];
      continue;
    }
    if (opts?.avoidDupes && player.hand.some((h) => h.defId === card.defId)) {
      state.deck = [card, ...state.deck.filter((c) => c.instanceId !== card.instanceId)];
      continue;
    }
    player.hand.push(card);
    return card;
  }
  return null;
}

export function discardCard(state: GameState, color: Color, instanceId: string): void {
  const player = state.players[color];
  const idx = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return;
  const [card] = player.hand.splice(idx, 1);
  state.discardPile.push(card);
  player.discard.push(card);
}

/** Helper used by card modules */
export function requirePiece(state: GameState, pieceId: string): PieceState {
  const p = state.pieces.find((x) => x.id === pieceId);
  if (!p) throw new Error('Piece not found');
  return p;
}

export function applyImmediateCard(
  state: GameState,
  color: Color,
  instanceId: string,
  targets: unknown[] = [],
): GameState {
  const next = cloneState(state);
  const player = next.players[color];
  const card = player.hand.find((c) => c.instanceId === instanceId);
  if (!card) throw new Error('Card not in hand');
  const def = getCardDef(card.defId);
  const rng = mulberry32(next.rngSeed + next.turnCount * 31 + player.hand.length);
  const ctx: CardContext = { state: next, player: color, card, rng };
  const blocked = def.canPlay?.(ctx);
  if (blocked) throw new Error(blocked);

  const result = def.play(ctx, targets);
  if (!result.done) {
    result.state.pendingPrompt = {
      type: 'card_target',
      color,
      cardInstanceId: instanceId,
      cardDefId: card.defId,
      step: targets.length,
      message: result.message ?? `Choose targets for ${def.name}`,
      selected: targets,
    };
    return result.state;
  }

  // consume card
  discardCard(result.state, color, instanceId);
  result.state.players[color].lastPlayedCardDefId = card.defId;
  result.state.players[color].spellsThisTurn += 1;
  if (def.tags?.includes('persistent')) {
    result.state.players[color].activeSpells.push({
      instanceId: card.instanceId,
      defId: card.defId,
      owner: color,
      data: { targets },
    });
  }
  log(result.state, `${color} played ${def.name}`);
  result.state.players[opposite(color)].lastPlayedCardDefId = result.state.players[opposite(color)].lastPlayedCardDefId;
  return result.state;
}
