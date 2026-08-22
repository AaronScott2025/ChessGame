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
  resolvePrompt,
  skipSpell,
  useAbility,
} from './game.js';

/** Apply a client action for a seated color. Used by the server and local hotseat. */
export function applyClientAction(state: GameState, color: Color, action: ClientAction): GameState {
  switch (action.type) {
    case 'set_name': {
      const next = cloneState(state);
      next.players[color].name = action.name;
      return next;
    }
    case 'choose_first_picker':
      if (color !== 'black') throw new Error('Only Black chooses');
      return chooseFirstPicker(state, action.whitePicksFirst);
    case 'draft_pick':
      return draftPick(state, color, action.defId);
    case 'opening_keep':
      return openingKeep(state, color);
    case 'opening_redraw':
      return openingRedraw(state, color, action.instanceId);
    case 'skip_spell':
      return skipSpell(state, color);
    case 'play_card':
      return playCard(state, color, action.instanceId, action.targets ?? []);
    case 'resolve_prompt':
      return resolvePrompt(state, color, action.payload);
    case 'move':
      return applyMove(state, color, action.pieceId, action.to, action.meta);
    case 'use_ability':
      return useAbility(state, color, action.pieceId, action.abilityId, action.targets);
    case 'cancel_prompt':
      return cancelPrompt(state, color);
    case 'resign': {
      const next = cloneState(state);
      next.phase = 'ended';
      next.winner = color === 'white' ? 'black' : 'white';
      next.winReason = `${color} resigned`;
      return next;
    }
    default:
      throw new Error(`Unknown action: ${(action as { type?: string })?.type ?? 'undefined'}`);
  }
}
