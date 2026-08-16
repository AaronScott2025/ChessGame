import './definitions.js';
export {
  CARD_REGISTRY,
  getCardDef,
  buildDeck,
  drawCard,
  discardCard,
  applyImmediateCard,
  registerCard,
} from './registry.js';
export type { CardDefinition, CardContext, TargetingMode } from './registry.js';
