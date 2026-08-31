export type Color = 'white' | 'black';
export type PieceClass =
  | 'pawn'
  | 'rook'
  | 'knight'
  | 'bishop'
  | 'queen'
  | 'wildcard'
  | 'king';

export type Phase =
  | 'lobby'
  | 'draft'
  | 'opening_draw'
  | 'playing'
  | 'ended';

export type TurnPhase = 'spell' | 'move';
export type DayNight = 'day' | 'night';

export interface Coord {
  row: number;
  col: number;
}

export interface StatusEffect {
  id: string;
  kind: string;
  sourceCardId?: string;
  turnsRemaining?: number;
  data?: Record<string, unknown>;
}

export interface PieceState {
  id: string;
  defId: string;
  class: PieceClass;
  color: Color;
  pos: Coord;
  hasMoved: boolean;
  startPos: Coord;
  effects: StatusEffect[];
  /** Prince/Princess pair link */
  linkedPieceId?: string;
  charges?: number;
  /** Reaper: captures since last rest. */
  reaperKills?: number;
  disabledTurns?: number;
  reviveCount?: number;
  ritualTurns?: number;
  ritualTargetDefId?: string;
  /** Snake: Bloodlust turns remaining (jump + ±1 L-leg variants). */
  bloodlustTurnsRemaining?: number;
  coOccupantId?: string;
  /** Gnome: gadget already deployed */
  gadgetUsed?: boolean;
  /** Yeti: Giga Stomp already used */
  gigaStompUsed?: boolean;
  /** Wizard Enchant cooldown (owner turns remaining) */
  abilityCooldown?: number;
  /** Wizard Magic Be-gone uses spent (max 2). */
  magicBegoneUsed?: number;
  /** Scamman: last captured piece type available to steal (once). */
  identityLootDefId?: string;
  /** Scamman: Identity Theft already used. */
  identityTheftUsed?: boolean;
  /** Scamman: permanently use this piece definition's movement. */
  copiedMoveDefId?: string;
  /** Gambler: movement style rolled for this day. */
  gamblerStyleDefId?: string;
  /** Gambler: yesterday's style (cannot repeat). */
  gamblerPrevStyleDefId?: string;
  /** Last square this piece moved from (for TimeKeeper Rewind). */
  previousPos?: Coord;
  /** TimeKeeper: day/night skip or revert already used. */
  timekeeperCycleUsed?: boolean;
  /** TimeKeeper: Rewind already used. */
  timekeeperRewindUsed?: boolean;
  /** TimeKeeper: Chrono Recall (spawn send) already used. */
  timekeeperRecallUsed?: boolean;
}

export interface TokenState {
  id: string;
  kind: string;
  pos: Coord;
  owner: Color;
  turnsRemaining?: number;
  data?: Record<string, unknown>;
}

export interface CardInstance {
  instanceId: string;
  defId: string;
}

export interface ActiveSpell {
  instanceId: string;
  defId: string;
  owner: Color;
  turnsRemaining?: number;
  data?: Record<string, unknown>;
}

export interface PlayerState {
  color: Color;
  connected: boolean;
  name: string;
  army: Partial<Record<PieceClass, string>>;
  hand: CardInstance[];
  discard: CardInstance[];
  graveyard: Array<{ defId: string; class: PieceClass }>;
  activeSpells: ActiveSpell[];
  spellsThisTurn: number;
  maxSpellsThisTurn: number;
  openingRedrawUsed: boolean;
  skipTurns: number;
  /** Extra turns earned (e.g. capturing a Best Buddy pair). */
  bonusTurns: number;
  lastPlayedCardDefId?: string;
  /** Opponent Magic Be-gone: silenced until this cycleCount (cleared on day/night flip). */
  magicDisabledUntilCycle?: number;
}

export interface DraftState {
  pickingColor: Color;
  blackChoseFirstPicker: boolean | null;
  lastPick?: {
    color: Color;
    defId: string;
    pieceClass: PieceClass;
  };
}

export interface GameState {
  roomCode: string;
  phase: Phase;
  boardSize: 10;
  pieces: PieceState[];
  tokens: TokenState[];
  players: Record<Color, PlayerState>;
  turn: Color;
  turnPhase: TurnPhase;
  dayNight: DayNight;
  /** Day/night phase before the most recent flip (for TimeKeeper revert). */
  previousDayNight?: DayNight;
  /** Full turns by current player; increments when a player finishes their move phase */
  turnCount: number;
  /** Completed mutual turn cycles (white+black) */
  cycleCount: number;
  deck: CardInstance[];
  discardPile: CardInstance[];
  draft: DraftState | null;
  check: Color | null;
  winner: Color | null;
  winReason?: string;
  history: string[];
  snapshots: string[];
  lastMove?: {
    pieceId: string;
    from: Coord;
    to: Coord;
    capturedId?: string;
    defId?: string;
    color?: Color;
  };
  pendingPrompt: PendingPrompt | null;
  rngSeed: number;
}

export type PendingPrompt =
  | {
      type: 'promote';
      color: Color;
      pieceId: string;
      options: string[];
    }
  | {
      type: 'card_target';
      color: Color;
      cardInstanceId: string;
      cardDefId: string;
      step: number;
      message: string;
      selected: unknown[];
    }
  | {
      type: 'discard_to_draw';
      color: Color;
      message: string;
      drawnInstanceId: string;
      remaining: number;
      queuedDraws?: Array<{ color: Color; remaining: number }>;
    }
  | {
      type: 'opening_mulligan';
      color: Color;
    }
  | {
      type: 'gambler_choice';
      color: Color;
      cardDefId: string;
      roll: number;
      message: string;
    }
  | {
      type: 'opponent_choose_piece';
      color: Color; // chooser
      forPlayer: Color;
      filter: string;
      message: string;
    }
  | {
      type: 'ability_target';
      color: Color;
      pieceId: string;
      abilityId: string;
      message: string;
      selected?: unknown[];
      resumeTurnPhase?: TurnPhase;
    }
  | {
      type: 'gadget_choice';
      color: Color;
      pieceId: string;
      message: string;
      resumeTurnPhase?: TurnPhase;
    }
  | {
      type: 'spring_bounce';
      color: Color;
      pieceId: string;
      from: Coord;
      message: string;
    }
  | {
      type: 'gnome_hole_travel';
      color: Color;
      pieceId: string;
      options: Coord[];
      message: string;
    };

export type ClientAction =
  | { type: 'set_name'; name: string }
  | { type: 'choose_first_picker'; whitePicksFirst: boolean }
  | { type: 'draft_pick'; defId: string }
  | { type: 'opening_keep' }
  | { type: 'opening_redraw'; instanceId: string }
  | { type: 'play_card'; instanceId: string; targets?: unknown[] }
  | { type: 'resolve_prompt'; payload: unknown }
  | { type: 'cancel_prompt' }
  | { type: 'select_piece'; pieceId: string }
  | { type: 'move'; pieceId: string; to: Coord; meta?: Record<string, unknown> }
  | { type: 'use_ability'; pieceId: string; abilityId: string; targets?: unknown }
  | { type: 'skip_spell' }
  | { type: 'resign' };

export const BOARD_SIZE = 10;
export const MAX_HAND = 5;
export const ALLIED_ROWS = 5;
