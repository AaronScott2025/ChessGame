import type { ClientAction, Color, GameState } from '../types.js';
import { cloneState } from '../utils.js';
import {
  applyMove,
  cancelPrompt,
  chooseFirstPicker,
  draftPick,
  openingKeep,
  openingRedraw,
  playCard,
  refreshCheckState,
  resolvePrompt,
  skipSpell,
  useAbility,
} from './game.js';

/** Apply a client action for a seated color. Used by the server and local hotseat. */
export function applyClientAction(state: GameState, color: Color, action: ClientAction): GameState {
  let next: GameState;
  switch (action.type) {
    case 'set_name': {
      next = cloneState(state);
      next.players[color].name = action.name;
      break;
    }
    case 'choose_first_picker':
      if (color !== 'black') throw new Error('Only Black chooses');
      next = chooseFirstPicker(state, action.whitePicksFirst);
      break;
    case 'draft_pick':
      next = draftPick(state, color, action.defId);
      break;
    case 'opening_keep':
      next = openingKeep(state, color);
      break;
    case 'opening_redraw':
      next = openingRedraw(state, color, action.instanceId);
      break;
    case 'skip_spell':
      next = skipSpell(state, color);
      break;
    case 'play_card':
      next = playCard(state, color, action.instanceId, action.targets ?? []);
      break;
    case 'resolve_prompt':
      next = resolvePrompt(state, color, action.payload);
      break;
    case 'move':
      next = applyMove(state, color, action.pieceId, action.to, action.meta);
      break;
    case 'use_ability':
      next = useAbility(state, color, action.pieceId, action.abilityId, action.targets);
      break;
    case 'cancel_prompt':
      next = cancelPrompt(state, color);
      break;
    case 'resign': {
      next = cloneState(state);
      next.phase = 'ended';
      next.winner = color === 'white' ? 'black' : 'white';
      next.winReason = `${color} resigned`;
      break;
    }
    default:
      throw new Error(`Unknown action: ${(action as { type?: string })?.type ?? 'undefined'}`);
  }
  refreshCheckState(next);
  return next;
}
