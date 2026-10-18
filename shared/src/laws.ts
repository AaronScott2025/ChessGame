import type { GameState, PieceClass } from './types.js';

/**
 * - restrict: forbids some moves (lifted for a player whose King is in check)
 * - mandate: a whole class moves like its standard variant
 * - magic: silences spells and magical abilities
 * - instant: resolves once when enacted
 * - buff: grants both players an extra option while in force
 */
export type LawKind = 'restrict' | 'mandate' | 'magic' | 'instant' | 'buff';

export interface LawDef {
  id: string;
  name: string;
  text: string;
  kind: LawKind;
  /** Mandates: the class affected and the variant it must move like. */
  mandate?: { class: PieceClass; defId: string };
}

export const LAWS: Record<string, LawDef> = {
  edge_pawns: {
    id: 'edge_pawns',
    name: 'Edge Ordinance',
    text: 'It is illegal to move pawns that are touching the edge of the board.',
    kind: 'restrict',
  },
  knights_horses: {
    id: 'knights_horses',
    name: 'Cavalry Act',
    text: 'All knight variants are mandated to be Horses.',
    kind: 'mandate',
    mandate: { class: 'knight', defId: 'horse' },
  },
  speed_limit: {
    id: 'speed_limit',
    name: 'Speed Limit',
    text: 'No piece may travel more than 3 squares in a single move.',
    kind: 'restrict',
  },
  no_retreat: {
    id: 'no_retreat',
    name: 'No Retreat',
    text: 'Pieces other than Kings may not move backward.',
    kind: 'restrict',
  },
  neutral_zone: {
    id: 'neutral_zone',
    name: 'Neutral Zone',
    text: 'Captures are illegal on the middle ranks (5 and 6).',
    kind: 'restrict',
  },
  magic_ban: {
    id: 'magic_ban',
    name: 'Magic Prohibition',
    text: 'Spell cards and magical abilities are banned.',
    kind: 'magic',
  },
  wildcard_curfew: {
    id: 'wildcard_curfew',
    name: 'Wildcard Curfew',
    text: 'Wildcard pieces may not move.',
    kind: 'restrict',
  },
  queens_grounded: {
    id: 'queens_grounded',
    name: 'Royal Grounding',
    text: 'Queen variants other than the President may not move.',
    kind: 'restrict',
  },
  house_arrest: {
    id: 'house_arrest',
    name: 'House Arrest',
    text: 'Kings may only move to escape check.',
    kind: 'restrict',
  },
  stimulus: {
    id: 'stimulus',
    name: 'Stimulus Package',
    text: 'Both players draw a card.',
    kind: 'instant',
  },
  arcane_subsidy: {
    id: 'arcane_subsidy',
    name: 'Arcane Subsidy',
    text: 'Each player may cast up to 2 spells per turn.',
    kind: 'buff',
  },
  infrastructure_act: {
    id: 'infrastructure_act',
    name: 'Infrastructure Act',
    text: 'Pawns may also step one square sideways onto an empty square.',
    kind: 'buff',
  },
  healthcare_act: {
    id: 'healthcare_act',
    name: 'Healthcare Act',
    text: 'Both players revive their most recently fallen piece onto their home ranks.',
    kind: 'instant',
  },
  general_amnesty: {
    id: 'general_amnesty',
    name: 'General Amnesty',
    text: 'All frozen, stunned, webbed, and disabled pieces recover, and every ability cooldown resets.',
    kind: 'instant',
  },
};

export const LAW_IDS = Object.keys(LAWS);
export const LAW_OFFER_SIZE = 3;

/** Laws that only do something when spell cards are in the game. */
const CARD_LAWS = new Set(['stimulus', 'arcane_subsidy']);

export function lawActive(state: Pick<GameState, 'laws'>, id: string): boolean {
  return Boolean(state.laws?.some((l) => l.id === id));
}

/** Distinct law ids for one President's dawn session. */
export function rollLawOptions(
  rng: () => number,
  count = LAW_OFFER_SIZE,
  opts: { bannedPieces?: string[]; cardsDisabled?: boolean } = {},
): string[] {
  const pool = LAW_IDS.filter((id) => {
    if (opts.cardsDisabled && CARD_LAWS.has(id)) return false;
    const mandate = LAWS[id].mandate;
    return !mandate || !opts.bannedPieces?.includes(mandate.defId);
  });
  const out: string[] = [];
  while (out.length < count && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return out;
}
