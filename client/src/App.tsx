import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { io, Socket } from 'socket.io-client';
import {
  listMoves as engineListMoves,
  availableAbilities as engineAbilities,
  ultimateSuckTargets,
  ultimateSuckLandings,
  draftBanBlockReason,
  draftBannedIds,
  BANS_PER_COLOR,
} from '@shared/engine/game.ts';
import {
  applyClientAction,
  createLobbyState,
  forceTimeoutMove,
  getDraftOptions,
  publicState,
  seatDisplayName,
  startDraft,
  syncTurnTimer,
  turnTimerExpired,
  CARD_REGISTRY,
  LAWS,
  PIECES,
  TURN_TIMER_OPTIONS,
} from '@shared/index.ts';
import { DRAFT_ORDER, VARIANTS_BY_CLASS } from '@shared/pieces/index.ts';
import { FORME_RADIUS, inTemporalField } from '@shared/pieces/prototype.ts';
import { isPigLShape } from '@shared/pieces/helpers.ts';
import {
  formeAbilityStyle,
  FormeToast,
  formeOf,
  PrototypeBoardBadges,
  PrototypeInspector,
  type FormeToastData,
  type ProtoView,
} from './PrototypeHud';
import { spellsUnlocked, isMagicDisabled, reaperCapturesUntilRest, vampireNightRadius, opposite } from '@shared/utils.ts';
import { LobbyBrowser } from './LobbyBrowser';
import { TurnClock, type TurnTimerView } from './TurnClock';
import {
  CosmicBackdrop,
  FxToggle,
  KnowledgeToggle,
  useAnonymousRule,
  useBanPhaseRule,
  useTurnTimerRule,
  useFxEnabled,
  useKnowledgeEnabled,
} from './CosmicFx';
import {
  AudioToggles,
  playCardCastSfx,
  playCardDiscardSfx,
  playCardDrawSfx,
  playCaptureSfx,
  playCheckSfx,
  playCheckDealtSfx,
  beginCheckedTrack,
  beginCheckingTrack,
  tickCheckedPlayerTurn,
  tickCheckingPlayerTurn,
  stopCheckedTrack,
  stopCheckingTrack,
  playResultTrack,
  stopResultTrack,
  playDayToNightSfx,
  playAbilitySfx,
  playDraftBanSfx,
  playDraftOrderSfx,
  playDraftPickSfx,
  playDraftSelectSfx,
  playErrorBuzzSfx,
  playLobbyCreatedSfx,
  playMatchJoinSfx,
  playMoveSfx,
  playNightToDaySfx,
  playPieceLostSfx,
  playPieceSfx,
  useAudioScene,
  useAudioSettings,
  useUiButtonSfx,
  resetStuckAudio,
} from './AudioControl';
import { PieceIcon } from './PieceIcon';
import { getPieceInfo } from './pieceInfo';
import { getObstacleInfo } from './obstacleInfo';
import { RulesModal } from './RulesModal';
import {
  effectLabel,
  effectTone,
  formatEffectTitle,
  visibleBoardEffects,
} from './statusEffects';
import './App.css';

type Color = 'white' | 'black';
type Coord = { row: number; col: number };

interface Piece {
  id: string;
  defId: string;
  class: string;
  color: Color;
  pos: Coord;
  effects: Array<{ id?: string; kind: string; turnsRemaining?: number; data?: Record<string, unknown> }>;
  charges?: number;
  reaperKills?: number;
  disabledTurns?: number;
  gamblerStyleDefId?: string;
  gadgetUsed?: boolean;
  gigaStompUsed?: boolean;
  abilityCooldown?: number;
  ritualTurns?: number;
  reviveCount?: number;
  bloodlustTurnsRemaining?: number;
  coOccupantId?: string;
  identityLootDefId?: string;
  identityTheftUsed?: boolean;
  copiedMoveDefId?: string;
  magicBegoneUsed?: number;
  timekeeperCycleUsed?: boolean;
  proto?: ProtoView;
}

interface AbilityInfo {
  id: string;
  name: string;
  ready: boolean;
  hint?: string;
  /** Informational only — explains a move-based ability */
  passive?: boolean;
}

interface CardInstance {
  instanceId: string;
  defId: string;
}

interface GameState {
  roomCode: string;
  phase: string;
  pieces: Piece[];
  tokens: Array<{ id: string; kind: string; pos: Coord; owner: Color; turnsRemaining?: number }>;
  players: Record<
    Color,
    {
      name: string;
      hand: CardInstance[];
      graveyard: Array<{ defId: string; class: string }>;
      army: Record<string, string>;
      spellsThisTurn: number;
      maxSpellsThisTurn: number;
      openingRedrawUsed: boolean;
      connected: boolean;
      magicDisabledUntilCycle?: number;
      lastPlayedCardDefId?: string;
      formeSwapCooldown?: number;
    }
  >;
  turn: Color;
  turnPhase: string;
  turnCount?: number;
  dayNight: string;
  previousDayNight?: string;
  cycleCount: number;
  check: Color | null;
  winner: Color | null;
  winReason?: string;
  history: string[];
  lastMove?: {
    pieceId: string;
    from: Coord;
    to: Coord;
    capturedId?: string;
    defId?: string;
    color?: Color;
  };
  abilityFx?: Array<{ seq: number; id: string }>;
  pendingPrompt: null | {
    type: string;
    color?: Color;
    message?: string;
    options?: string[] | Coord[];
    pieceId?: string;
    cardDefId?: string;
    roll?: number;
    selected?: unknown[];
    cardInstanceId?: string;
    drawnInstanceId?: string;
    remaining?: number;
    abilityId?: string;
    from?: Coord;
    targetId?: string;
    skippable?: boolean;
    actorColor?: Color;
  };
  bonusMove?: { color: Color; pieceId: string };
  laws?: Array<{ id: string; by: Color }>;
  rules?: { banPhase: boolean; anonymous?: boolean; turnTimerSeconds?: number };
  turnTimer?: TurnTimerView;
  draft: null | {
    pickingColor: Color;
    blackChoseFirstPicker: boolean | null;
    stage?: 'ban' | 'pick';
    bans?: Record<Color, string[]>;
    lastBan?: { color: Color; defId: string };
    lastPick?: {
      color: Color;
      defId: string;
      pieceClass: string;
    };
  };
}

interface Catalog {
  pieces: Array<{ id: string; name: string; class: string; symbol: string }>;
  cards: Array<{
    id: string;
    name: string;
    description: string[];
    image: string;
    playOnOpponentTurn?: boolean;
    targeting: string;
  }>;
}

interface MoveOption {
  to: Coord;
  capture?: boolean;
  special?: string;
  meta?: Record<string, unknown>;
}

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';

function pieceMeta(catalog: Catalog | null, defId: string) {
  return catalog?.pieces.find((p) => p.id === defId);
}

const DRAFT_CLASS_LABELS: Record<string, string> = {
  pawn: 'Pawn',
  rook: 'Rook',
  knight: 'Knight',
  bishop: 'Bishop',
  wildcard: 'Wildcard',
  queen: 'Queen',
};

const BOARD_SQ_PX = 60;

function moveAnimDuration(deltaCol: number, deltaRow: number): number {
  const dist = Math.max(Math.abs(deltaCol), Math.abs(deltaRow));
  return Math.min(360, Math.max(130, 90 + dist * 48));
}

function phaseLabel(phase: GameState['phase']): string {
  switch (phase) {
    case 'draft':
      return 'Army draft';
    case 'opening_draw':
      return 'Opening hand';
    case 'playing':
      return 'In game';
    case 'ended':
      return 'Game over';
    default:
      return phase;
  }
}

function cyclesUntilDayNightFlip(cycleCount: number): number {
  const mod = cycleCount % 5;
  return mod === 0 ? 5 : 5 - mod;
}

function gameTurnInfo(
  state: GameState,
  you: Color,
  localMode = false,
): { yours: boolean; label: string; detail?: string } | null {
  if (state.phase === 'playing') {
    const seatName = you === 'white' ? 'White' : 'Black';
    const turnName = state.turn === 'white' ? 'White' : 'Black';
    return {
      yours: state.turn === you,
      label: localMode
        ? state.turn === you
          ? `${seatName} to play`
          : `Pass to ${turnName}`
        : state.turn === you
          ? 'Your turn'
          : "Opponent's turn",
      detail: state.turnPhase,
    };
  }
  if (state.phase === 'draft' && state.draft) {
    if (state.draft.blackChoseFirstPicker == null) {
      if (you === 'black') {
        return {
          yours: true,
          label: localMode ? 'Black chooses' : 'Your choice',
          detail: state.rules?.banPhase === false ? 'Who drafts first?' : 'Who bans and drafts first?',
        };
      }
      return { yours: false, label: 'Waiting', detail: 'Black picks draft order' };
    }
    const picking = state.draft.pickingColor;
    const pickName = picking === 'white' ? 'White' : 'Black';
    const banning = state.draft.stage === 'ban';
    return {
      yours: picking === you,
      label: localMode
        ? picking === you
          ? `${pickName} ${banning ? 'bans' : 'picks'}`
          : `Pass to ${pickName}`
        : picking === you
          ? banning
            ? 'Your ban'
            : 'Your pick'
          : `${state.players[picking].name} is ${banning ? 'banning' : 'picking'}`,
      detail: banning ? 'Ban phase' : 'Army draft',
    };
  }
  if (state.phase === 'opening_draw') {
    return {
      yours: true,
      label: localMode ? `${you === 'white' ? 'White' : 'Black'} opening hand` : 'Opening hand',
      detail: 'Keep or mulligan cards',
    };
  }
  return null;
}

function turnStripContent(
  state: GameState,
  you: Color | null,
  localMode = false,
): { mode: 'yours' | 'waiting' | 'ended'; title: string; detail: string } {
  if (state.phase === 'ended') {
    return {
      mode: 'ended',
      title: `${state.winner ?? 'Someone'} wins`,
      detail: state.winReason ?? '',
    };
  }
  const info = you ? gameTurnInfo(state, you, localMode) : null;
  if (info?.yours) {
    if (state.phase === 'playing') {
      return {
        mode: 'yours',
        title: localMode ? `${you === 'white' ? 'White' : 'Black'} to play` : 'Your turn',
        detail: spellsUnlocked(state)
          ? `Cast a spell or move a piece (${state.turnPhase})`
          : 'Move a piece — spell cards unlock at the first night',
      };
    }
    return { mode: 'yours', title: info.label, detail: info.detail ?? '' };
  }
  return {
    mode: 'waiting',
    title: localMode ? 'Pass the device' : 'Waiting for opponent',
    detail:
      state.phase === 'draft'
        ? state.draft?.stage === 'ban'
          ? 'Ban phase'
          : 'Draft'
        : info?.detail
          ? info.detail
          : state.turnPhase ?? '',
  };
}

const FILE_LETTERS = 'abcdefghij';

function cardMeta(catalog: Catalog | null, defId: string) {
  return catalog?.cards.find((c) => c.id === defId);
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const CARD_CAST_FX_MS = 1900;

interface CardCastView {
  key: number;
  defId: string | null;
  name: string;
  tone: 'gold' | 'violet';
  label: string;
}

function CardCastFx({ cast, image }: { cast: CardCastView; image?: string }) {
  return (
    <div className={`card-cast-fx is-${cast.tone}`} role="status" aria-live="polite">
      <div className="card-cast-wash" aria-hidden />
      <div className="card-cast-sigil" aria-hidden />
      <div className="card-cast-ring" aria-hidden />
      <div className="card-cast-ring is-late" aria-hidden />
      <div className="card-cast-sparks" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} style={{ '--spark-a': `${i * 30 + 8}deg` } as React.CSSProperties} />
        ))}
      </div>
      <div className="card-cast-card">
        <img src={image ?? '/cards/Back_Of_Card.png'} alt="" />
      </div>
      <div className="card-cast-caption">
        <span className="card-cast-who">{cast.label}</span>
        <strong className="card-cast-name">{cast.name}</strong>
      </div>
    </div>
  );
}

function isAlliedTerritory(color: Color, pos: Coord): boolean {
  return color === 'white' ? pos.row >= 5 : pos.row < 5;
}

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/** Drop Best Buddy teleports that aren't a real Pig L (2×1). */
function pigMoveBonus(piece: Piece): number {
  let bonus = 0;
  for (const e of piece.effects ?? []) {
    if (e.kind === 'movement_plus') bonus += 1;
    if (e.kind === 'mathematical') bonus += 1;
    if (e.kind === 'wizard_enchant') bonus += 1;
  }
  return bonus;
}

function sanitizeMoves(piece: Piece | undefined, opts: MoveOption[]): MoveOption[] {
  if (!piece || piece.defId !== 'pig') return opts;
  const bonus = pigMoveBonus(piece);
  return opts.filter(
    (m) => m.special !== 'best_buddy' || isPigLShape(piece.pos, m.to, bonus),
  );
}

/** Giga Stomp is opt-in. Until it is armed, those squares must not replace movement. */
function movesForBoard(opts: MoveOption[], focusSpecial: string | null): MoveOption[] {
  if (focusSpecial === 'giga_stomp') return opts.filter((m) => m.special === 'giga_stomp');
  return opts.filter((m) => m.special !== 'giga_stomp');
}

function buildLocalCatalog(): Catalog {
  return {
    pieces: Object.values(PIECES).map((p) => ({
      id: p.id,
      name: p.name,
      class: p.class,
      symbol: p.symbol,
    })),
    cards: Object.values(CARD_REGISTRY).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      image: c.image,
      playOnOpponentTurn: c.playOnOpponentTurn,
      targeting: c.targeting,
    })),
  };
}

/** Which seat should control the UI in pass-and-play. */
function localActiveSeat(state: GameState): Color {
  const promptColor = state.pendingPrompt?.color;
  if (promptColor === 'white' || promptColor === 'black') return promptColor;
  if (state.phase === 'draft' && state.draft) {
    if (state.draft.blackChoseFirstPicker == null) return 'black';
    return state.draft.pickingColor ?? 'white';
  }
  if (state.phase === 'playing' || state.phase === 'ended') return state.turn;
  return 'white';
}

export default function App() {
  const { fxEnabled, setFxEnabled } = useFxEnabled();
  const { knowledgeEnabled, setKnowledgeEnabled } = useKnowledgeEnabled();
  const { musicEnabled, sfxEnabled, musicVolume, setMusicEnabled, setSfxEnabled, setMusicVolume } =
    useAudioSettings();
  useUiButtonSfx();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<null | 'table' | 'info' | 'more'>(null);
  const wideLayout = useMediaQuery('(min-width: 961px)');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [name, setName] = useState('');
  const { banPhaseRule, setBanPhaseRule } = useBanPhaseRule();
  const { anonymousRule, setAnonymousRule } = useAnonymousRule();
  const { turnTimerRule, setTurnTimerRule } = useTurnTimerRule();
  const turnTimerSeconds = (TURN_TIMER_OPTIONS as readonly number[]).includes(turnTimerRule) ? turnTimerRule : 0;
  const lobbyRules = {
    banPhase: banPhaseRule,
    anonymous: anonymousRule,
    ...(turnTimerSeconds ? { turnTimerSeconds } : {}),
  };
  const serverClockOffsetRef = useRef(0);
  const [lobbyBrowserOpen, setLobbyBrowserOpen] = useState(false);
  const [roomAccess, setRoomAccess] = useState<'open' | 'password'>('open');
  const [roomPassword, setRoomPassword] = useState('');
  const [hostedLocked, setHostedLocked] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [localMode, setLocalMode] = useState(false);
  const localModeRef = useRef(false);
  const [you, setYou] = useState<Color | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [moves, setMoves] = useState<MoveOption[]>([]);
  const [abilities, setAbilities] = useState<AbilityInfo[]>([]);
  const movesReqRef = useRef<string | null>(null);
  const [gadgetKind, setGadgetKind] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [readCardId, setReadCardId] = useState<string | null>(null);
  const [lawPickerHidden, setLawPickerHidden] = useState(false);
  const [cardDetailsCollapsed, setCardDetailsCollapsed] = useState(false);
  const [pendingTargets, setPendingTargets] = useState<unknown[]>([]);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [spellConfirm, setSpellConfirm] = useState<{
    summary: string;
    mode: 'card' | 'resolve_prompt' | 'move';
    targets?: unknown[];
    payload?: unknown;
    move?: { pieceId: string; to: Coord; meta?: Record<string, unknown> };
  } | null>(null);
  const [focusSpecial, setFocusSpecial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Connect and create or join a room.');
  const [messagesHidden, setMessagesHidden] = useState(false);
  const [overlayPeek, setOverlayPeek] = useState(false);
  const prevTurnRef = useRef<string | null>(null);
  const skipMoveAnimRef = useRef(true);
  const lastMoveAnimKeyRef = useRef<string | null>(null);
  const lastDraftPickKeyRef = useRef<string | null>(null);
  const skipGameSfxRef = useRef(true);
  const lastDayNightSfxRef = useRef<string | null>(null);
  const lastHistorySfxRef = useRef<string | null>(null);
  const lastCaptureSfxKeyRef = useRef<string | null>(null);
  const lastAbilityFxSeqRef = useRef(0);
  const lastGraveCountsRef = useRef<{ white: number; black: number } | null>(null);
  const lastHandIdsRef = useRef<string[] | null>(null);
  const lastCheckRef = useRef<Color | null | 'unset'>('unset');
  const lastTurnForCheckThemeRef = useRef<Color | null>(null);
  const checkedThemeColorRef = useRef<Color | null>(null);
  const checkingThemeColorRef = useRef<Color | null>(null);
  const resultShownKeyRef = useRef<string | null>(null);
  const [checkAlert, setCheckAlert] = useState<null | 'received' | 'dealt'>(null);
  const [cardCast, setCardCast] = useState<CardCastView | null>(null);
  const cardCastSeqRef = useRef(0);
  const protoFormeSeenRef = useRef<Map<string, string> | null>(null);
  const [formeToasts, setFormeToasts] = useState<FormeToastData[]>([]);
  const [resultShow, setResultShow] = useState<null | {
    kind: 'victory' | 'loss';
    winnerName: string;
    reason: string;
  }>(null);
  const [moveAnim, setMoveAnim] = useState<{
    key: string;
    pieceId: string;
    deltaCol: number;
    deltaRow: number;
    sqPx: number;
    durationMs: number;
    phase: 'from' | 'to';
  } | null>(null);
  const [draftPickFlash, setDraftPickFlash] = useState<{
    color: Color;
    defId: string;
    pieceClass: string;
  } | null>(null);
  const [draftBanFlash, setDraftBanFlash] = useState<{ color: Color; defId: string } | null>(null);
  const lastDraftBanKeyRef = useRef<string | null>(null);
  const [draftShake, setDraftShake] = useState<{ id: string; n: number } | null>(null);
  const [ceremony, setCeremony] = useState<
    | { kind: 'lobby'; code: string }
    | { kind: 'vs'; white: string; black: string }
    | { kind: 'order'; whiteFirst: boolean; bans: boolean }
    | null
  >(null);
  const prevPhaseRef = useRef<string | null>(null);
  const prevFirstPickerRef = useRef<boolean | null | 'unset'>('unset');

  useEffect(() => {
    const s = io(SOCKET_URL || undefined, { transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('state', (payload: {
      state: GameState;
      you: Color;
      draftOptions: string[];
      catalog: Catalog;
      serverNow?: number;
    }) => {
      if (localModeRef.current) return;
      if (typeof payload.serverNow === 'number') serverClockOffsetRef.current = payload.serverNow - Date.now();
      const turnKey = `${payload.state.turn}:${payload.state.phase}:${payload.state.pendingPrompt?.type ?? ''}:${payload.you}`;
      if (prevTurnRef.current && prevTurnRef.current !== turnKey) {
        setConfirmKey(null);
        setSpellConfirm(null);
        setFocusSpecial(null);
        setSelectedPiece(null);
        setMoves([]);
        setAbilities([]);
      }
      prevTurnRef.current = turnKey;
      setState(payload.state);
      setYou(payload.you);
      setDraftOptions(payload.draftOptions ?? []);
      setCatalog(payload.catalog);
      setError(null);
    });
    s.on('error_message', (msg: string) => setError(msg));
    return () => {
      s.disconnect();
    };
  }, []);

  const clearMoveAnim = useCallback(() => setMoveAnim(null), []);

  useLayoutEffect(() => {
    const lm = state?.lastMove;
    if (!lm) return;

    const key = `${lm.pieceId}:${lm.from.row},${lm.from.col}:${lm.to.row},${lm.to.col}`;
    if (skipMoveAnimRef.current) {
      skipMoveAnimRef.current = false;
      lastMoveAnimKeyRef.current = key;
      return;
    }
    if (key === lastMoveAnimKeyRef.current) return;
    lastMoveAnimKeyRef.current = key;

    if (lm.from.row === lm.to.row && lm.from.col === lm.to.col) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const flipBoard = you === 'black';
    const visualFromRow = flipBoard ? 9 - lm.from.row : lm.from.row;
    const visualFromCol = flipBoard ? 9 - lm.from.col : lm.from.col;
    const visualToRow = flipBoard ? 9 - lm.to.row : lm.to.row;
    const visualToCol = flipBoard ? 9 - lm.to.col : lm.to.col;

    const boardEl = document.querySelector('.board') as HTMLElement | null;
    const sqRaw = boardEl ? getComputedStyle(boardEl).getPropertyValue('--sq') : '';
    const sqPx = Number.parseFloat(sqRaw) || BOARD_SQ_PX;
    const deltaCol = visualToCol - visualFromCol;
    const deltaRow = visualToRow - visualFromRow;

    setMoveAnim({
      key,
      pieceId: lm.pieceId,
      deltaCol,
      deltaRow,
      sqPx,
      durationMs: moveAnimDuration(deltaCol, deltaRow),
      phase: 'from',
    });
    playMoveSfx(deltaCol, deltaRow);
  }, [state?.lastMove, you]);

  useLayoutEffect(() => {
    if (moveAnim?.phase !== 'from') return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setMoveAnim((m) => (m?.phase === 'from' ? { ...m, phase: 'to' } : m));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [moveAnim?.key, moveAnim?.phase]);

  useEffect(() => {
    if (!moveAnim) return;
    const fallback = window.setTimeout(clearMoveAnim, moveAnim.durationMs + 120);
    return () => window.clearTimeout(fallback);
  }, [moveAnim, clearMoveAnim]);

  useEffect(() => {
    if (state?.phase !== 'draft') return;
    setInspectedId((id) => (id?.startsWith('draft:') ? null : id));
  }, [state?.draft?.lastPick, state?.draft?.pickingColor]);

  useEffect(() => {
    if (!inspectedId?.startsWith('token:')) return;
    const id = inspectedId.slice(6);
    if (!state?.tokens.some((t) => t.id === id)) setInspectedId(null);
  }, [state?.tokens, inspectedId]);

  useEffect(() => {
    const lp = state?.draft?.lastPick;
    if (!lp) return;
    const key = `${lp.color}:${lp.pieceClass}:${lp.defId}`;
    if (key === lastDraftPickKeyRef.current) return;
    lastDraftPickKeyRef.current = key;
    setDraftPickFlash(lp);
    playDraftPickSfx();
    const timer = window.setTimeout(() => setDraftPickFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [state?.draft?.lastPick]);

  useEffect(() => {
    const lb = state?.draft?.lastBan;
    if (!lb) return;
    const key = `${lb.color}:${lb.defId}`;
    if (key === lastDraftBanKeyRef.current) return;
    lastDraftBanKeyRef.current = key;
    setDraftBanFlash(lb);
    playDraftBanSfx();
    const timer = window.setTimeout(() => setDraftBanFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [state?.draft?.lastBan]);

  useEffect(() => {
    if (!draftShake) return;
    const timer = window.setTimeout(() => setDraftShake(null), 450);
    return () => window.clearTimeout(timer);
  }, [draftShake]);

  const draftRollTimersRef = useRef<number[]>([]);
  const [draftRolling, setDraftRolling] = useState(false);
  const stopDraftRoll = useCallback(() => {
    draftRollTimersRef.current.forEach((t) => window.clearTimeout(t));
    draftRollTimersRef.current = [];
    setDraftRolling(false);
  }, []);
  const draftTurnKey = state?.draft
    ? `${state.draft.stage ?? 'pick'}:${state.draft.pickingColor}:${state.draft.lastPick?.defId ?? ''}:${state.draft.lastBan?.defId ?? ''}`
    : null;
  useEffect(() => stopDraftRoll, [draftTurnKey, stopDraftRoll]);

  /** Roulette across the given choices, then hand the winner to `onLand`. */
  const rollDraftSelection = (choices: string[], onLand: (id: string) => void) => {
    if (!choices.length) return;
    stopDraftRoll();
    setDraftRolling(true);
    const finalId = choices[Math.floor(Math.random() * choices.length)];
    const delays = [55, 60, 65, 75, 85, 100, 120, 145, 175, 215, 260];
    let elapsed = 0;
    let prev: string | null = null;
    delays.forEach((delay, i) => {
      elapsed += delay;
      const last = i === delays.length - 1;
      let id = finalId;
      if (!last && choices.length > 1) {
        do id = choices[Math.floor(Math.random() * choices.length)];
        while (id === prev);
      }
      prev = id;
      const timer = window.setTimeout(() => {
        setInspectedId(`draft:${id}`);
        playDraftSelectSfx();
        document
          .querySelector(`[data-draft-id="${id}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: last ? 'smooth' : 'auto' });
        if (last) {
          draftRollTimersRef.current = [];
          setDraftRolling(false);
          onLand(id);
        }
      }, elapsed);
      draftRollTimersRef.current.push(timer);
    });
  };

  useEffect(() => {
    if (!state) return;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;

    if (state.phase === 'lobby' && prev !== 'lobby') {
      setCeremony({ kind: 'lobby', code: state.roomCode });
      playLobbyCreatedSfx();
    }

    if (state.phase === 'draft' && prev !== 'draft') {
      const alreadyPicking = prev === null && state.draft?.blackChoseFirstPicker != null;
      if (!alreadyPicking) {
        setCeremony({
          kind: 'vs',
          white: state.players.white.name || 'White',
          black: state.players.black.name || 'Black',
        });
        playMatchJoinSfx();
      }
    }

    const chose = state.draft?.blackChoseFirstPicker ?? null;
    if (prevFirstPickerRef.current === 'unset') {
      prevFirstPickerRef.current = chose;
    } else if (state.phase === 'draft' && prevFirstPickerRef.current == null && chose != null) {
      prevFirstPickerRef.current = chose;
      setCeremony({ kind: 'order', whiteFirst: chose, bans: state.draft?.stage === 'ban' });
      playDraftOrderSfx(chose);
    } else {
      prevFirstPickerRef.current = chose;
    }
  }, [state]);

  useEffect(() => {
    if (!state || !you) return;
    const head = state.history[0] ?? '';
    const graves = {
      white: state.players.white.graveyard.length,
      black: state.players.black.graveyard.length,
    };
    const lm = state.lastMove;
    const captureKey = lm?.capturedId
      ? `${lm.pieceId}:${lm.capturedId}:${lm.from.row},${lm.from.col}:${lm.to.row},${lm.to.col}`
      : null;

    const handIds = state.players[you].hand.map((c) => c.instanceId);
    const abilityEvents = state.abilityFx ?? [];
    const latestAbilitySeq = abilityEvents[abilityEvents.length - 1]?.seq ?? 0;

    if (skipGameSfxRef.current) {
      skipGameSfxRef.current = false;
      lastAbilityFxSeqRef.current = latestAbilitySeq;
      lastDayNightSfxRef.current = state.dayNight;
      lastHistorySfxRef.current = head;
      lastCaptureSfxKeyRef.current = captureKey;
      lastGraveCountsRef.current = graves;
      lastHandIdsRef.current = handIds;
      lastCheckRef.current = state.check;
      lastTurnForCheckThemeRef.current = state.turn;
      checkedThemeColorRef.current = null;
      checkingThemeColorRef.current = null;
      return;
    }

    if (state.dayNight !== lastDayNightSfxRef.current) {
      if (state.dayNight === 'night') playDayToNightSfx();
      else playNightToDaySfx();
      lastDayNightSfxRef.current = state.dayNight;
    }

    const prevCheck = lastCheckRef.current;
    const opponent: Color | null = you === 'white' ? 'black' : you === 'black' ? 'white' : null;
    if (prevCheck !== 'unset' && state.check === you && prevCheck !== you) {
      playCheckSfx();
      beginCheckedTrack();
      checkedThemeColorRef.current = you;
      checkingThemeColorRef.current = null;
      setCheckAlert('received');
      setStatus('Check! Your king is under attack.');
    } else if (prevCheck !== 'unset' && opponent && state.check === opponent && prevCheck !== opponent) {
      playCheckDealtSfx();
      beginCheckingTrack();
      checkingThemeColorRef.current = you;
      checkedThemeColorRef.current = null;
      setCheckAlert('dealt');
      setStatus('Check! Their king is under attack.');
    }
    lastCheckRef.current = state.check;

    const prevTurn = lastTurnForCheckThemeRef.current;
    const themeColor = checkedThemeColorRef.current;
    if (themeColor && prevTurn === themeColor && state.turn !== themeColor) {
      if (tickCheckedPlayerTurn() <= 0) checkedThemeColorRef.current = null;
    }
    const dealtBy = checkingThemeColorRef.current;
    if (dealtBy && prevTurn === dealtBy && state.turn !== dealtBy) {
      if (tickCheckingPlayerTurn() <= 0) checkingThemeColorRef.current = null;
    }
    lastTurnForCheckThemeRef.current = state.turn;

    if (state.phase !== 'playing') {
      stopCheckedTrack();
      stopCheckingTrack();
      checkedThemeColorRef.current = null;
      checkingThemeColorRef.current = null;
    }

    if (head && head !== lastHistorySfxRef.current) {
      const prevHead = lastHistorySfxRef.current;
      lastHistorySfxRef.current = head;
      const fresh: string[] = [];
      for (const line of state.history.slice(0, 40)) {
        if (line === prevHead) break;
        fresh.push(line.replace(/^\[[^\]]+\]\s*/, ''));
      }
      const castMatch = fresh
        .map((text) => /^(white|black) played (.+)$/.exec(text))
        .find((m): m is RegExpExecArray => Boolean(m));
      if (castMatch) {
        const color = castMatch[1] as Color;
        const name = castMatch[2];
        const isLocal = localModeRef.current;
        const mine = color === you;
        const defId =
          state.players[color].lastPlayedCardDefId ?? catalog?.cards.find((c) => c.name === name)?.id ?? null;
        const casterName = state.players[color].name || (color === 'white' ? 'White' : 'Black');
        playCardCastSfx(isLocal || mine, defId);
        cardCastSeqRef.current += 1;
        setCardCast({
          key: cardCastSeqRef.current,
          defId,
          name,
          tone: isLocal ? (color === 'white' ? 'gold' : 'violet') : mine ? 'gold' : 'violet',
          label: isLocal ? `${color === 'white' ? 'White' : 'Black'} cast` : mine ? 'You cast' : `${casterName} cast`,
        });
      } else if (
        fresh.some(
          (text) =>
            text.includes('discarded to make room') ||
            text.includes('redrew one opening') ||
            text.includes('stolen card discarded'),
        )
      ) {
        playCardDiscardSfx();
      }
    } else {
      lastHistorySfxRef.current = head;
    }

    const prevHand = lastHandIdsRef.current;
    if (prevHand) {
      const added = handIds.filter((id) => !prevHand.includes(id)).length;
      if (added > 0) playCardDrawSfx(added);
    }
    lastHandIdsRef.current = handIds;

    if (captureKey && captureKey !== lastCaptureSfxKeyRef.current) {
      lastCaptureSfxKeyRef.current = captureKey;
      if (lm?.color === you) playCaptureSfx();
      else playPieceLostSfx();
    } else {
      const prev = lastGraveCountsRef.current;
      if (prev) {
        const opp: Color = you === 'white' ? 'black' : 'white';
        if (graves[you] > prev[you]) playPieceLostSfx();
        if (graves[opp] > prev[opp]) playCaptureSfx();
      }
    }
    lastGraveCountsRef.current = graves;

    if (latestAbilitySeq < lastAbilityFxSeqRef.current) {
      lastAbilityFxSeqRef.current = latestAbilitySeq;
    } else if (latestAbilitySeq > lastAbilityFxSeqRef.current) {
      const fresh = [
        ...new Set(abilityEvents.filter((e) => e.seq > lastAbilityFxSeqRef.current).map((e) => e.id)),
      ].slice(0, 3);
      lastAbilityFxSeqRef.current = latestAbilitySeq;
      fresh.forEach((id, i) => {
        if (i === 0) playAbilitySfx(id);
        else window.setTimeout(() => playAbilitySfx(id), i * 240);
      });
    }
  }, [state, you]);

  useEffect(() => {
    if (!state || !you) {
      protoFormeSeenRef.current = null;
      return;
    }
    const prev = protoFormeSeenRef.current;
    const seen = new Map<string, string>();
    const fresh: FormeToastData[] = [];
    for (const p of state.pieces) {
      if (p.defId !== 'prototype') continue;
      const forme = formeOf(p.proto);
      seen.set(p.id, forme);
      const before = prev?.get(p.id);
      if (before && before !== forme) {
        fresh.push({ key: `${p.id}:${forme}:${Date.now()}`, forme, mine: p.color === you });
      }
    }
    protoFormeSeenRef.current = seen;
    if (!fresh.length) return;
    setFormeToasts((cur) => [...cur, ...fresh].slice(-3));
    for (const t of fresh) {
      window.setTimeout(() => setFormeToasts((cur) => cur.filter((x) => x.key !== t.key)), 4000);
    }
  }, [state, you]);

  useEffect(() => {
    if (!state?.winner || state.phase !== 'ended' || !you) {
      if (resultShownKeyRef.current) {
        resultShownKeyRef.current = null;
        stopResultTrack();
        setResultShow(null);
      }
      return;
    }
    const key = `${state.winner}:${state.winReason ?? ''}`;
    if (resultShownKeyRef.current === key) return;
    resultShownKeyRef.current = key;
    const kind = state.winner === you ? 'victory' : 'loss';
    const winnerName = state.players[state.winner]?.name || (state.winner === 'white' ? 'White' : 'Black');
    setResultShow({ kind, winnerName, reason: state.winReason ?? '' });
    playResultTrack(kind);
  }, [state?.phase, state?.winner, state?.winReason, state, you]);

  useEffect(() => {
    if (!checkAlert) return;
    const t = window.setTimeout(() => setCheckAlert(null), 2400);
    return () => window.clearTimeout(t);
  }, [checkAlert]);

  useEffect(() => {
    if (!cardCast) return;
    const t = window.setTimeout(() => setCardCast(null), CARD_CAST_FX_MS);
    return () => window.clearTimeout(t);
  }, [cardCast]);

  useEffect(() => {
    setMessagesHidden(false);
  }, [state?.pendingPrompt?.type, state?.pendingPrompt?.message, spellConfirm?.summary]);

  useEffect(() => {
    setLawPickerHidden(false);
  }, [state?.pendingPrompt?.type, state?.pendingPrompt?.color]);

  useEffect(() => {
    if (error) setMessagesHidden(false);
  }, [error]);

  useEffect(() => {
    setOverlayPeek(false);
  }, [state?.pendingPrompt?.type, state?.pendingPrompt?.drawnInstanceId]);

  useEffect(() => {
    if (!state) return;
    const promptMsg = state.pendingPrompt?.message;
    if (promptMsg) {
      setStatus(promptMsg);
      return;
    }
    if (state.phase === 'lobby') {
      setStatus('Share the room code. Game starts when a second player joins.');
      return;
    }
    setStatus((current) =>
      current === 'Connect and create or join a room.' ||
      current === 'Share the room code. Game starts when a second player joins.'
        ? ''
        : current,
    );
  }, [state?.phase, state?.pendingPrompt?.message]);

  // Pass-the-device toasts are informational only — auto-dismiss so they don't cover the board.
  useEffect(() => {
    if (!status.startsWith('Pass the device')) return;
    if (error || state?.pendingPrompt || spellConfirm || confirmKey) return;
    const t = window.setTimeout(() => {
      setStatus((current) => (current.startsWith('Pass the device') ? '' : current));
    }, 2200);
    return () => window.clearTimeout(t);
  }, [status, error, state?.pendingPrompt, spellConfirm, confirmKey]);

  const clearTransientUi = () => {
    setConfirmKey(null);
    setSpellConfirm(null);
    setFocusSpecial(null);
    setSelectedPiece(null);
    setSelectedCard(null);
    setPendingTargets([]);
    setMoves([]);
    setAbilities([]);
    setGadgetKind(null);
  };

  const pushGameState = (
    next: GameState,
    options: { actingAs?: Color; localPassDevice?: boolean; viewer?: Color | null } = {},
  ) => {
    const viewer = options.viewer ?? you;
    const seat = options.localPassDevice ? localActiveSeat(next) : viewer;
    const turnKey = `${next.turn}:${next.phase}:${next.pendingPrompt?.type ?? ''}:${seat ?? ''}`;
    if (prevTurnRef.current && prevTurnRef.current !== turnKey) {
      clearTransientUi();
    }
    prevTurnRef.current = turnKey;
    const view =
      viewer && !options.localPassDevice ? (publicState(next as never, viewer) as GameState) : next;
    setState(view);
    if (options.localPassDevice) setYou(seat);
    setDraftOptions(getDraftOptions(next as never));
    setError(null);
    if (options.localPassDevice && options.actingAs) {
      if (seat !== options.actingAs) {
        const label = seat === 'white' ? 'White' : 'Black';
        setStatus(`Pass the device — ${label}'s turn`);
      } else {
        setStatus((current) => (current.startsWith('Pass the device') ? '' : current));
      }
    }
  };

  const applyLocalState = (next: GameState, actingAs: Color) => {
    pushGameState(next, { actingAs, localPassDevice: true });
  };

  const commitLocalState = (next: GameState, actingAs: Color) => {
    syncTurnTimer(next as never, Date.now());
    if (next.phase === 'ended' && next.winner) {
      const seat = localActiveSeat(next);
      const kind = next.winner === seat ? 'victory' : 'loss';
      const winnerName =
        next.players[next.winner]?.name || (next.winner === 'white' ? 'White' : 'Black');
      resultShownKeyRef.current = `${next.winner}:${next.winReason ?? ''}`;
      setResultShow({ kind, winnerName, reason: next.winReason ?? '' });
      playResultTrack(kind);
    }
    applyLocalState(next, actingAs);
  };

  useEffect(() => {
    if (!localMode || !state || state.phase !== 'playing') return;
    const deadline = state.turnTimer?.deadline;
    if (deadline == null) return;
    const id = window.setTimeout(() => {
      if (!turnTimerExpired(state as never, Date.now())) return;
      try {
        const next = forceTimeoutMove(state as never) as GameState;
        if (next.turnTimer && turnTimerExpired(next as never, Date.now())) {
          next.turnTimer.deadline = Date.now() + next.turnTimer.durationMs;
        }
        commitLocalState(next, state.turn);
      } catch (e) {
        setError((e as Error).message);
      }
    }, Math.max(0, deadline - Date.now()) + 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMode, state]);

  const lastTimeoutLineRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const latest = state?.history?.slice(0, 12).find((line) => line.includes('ran out of time')) ?? null;
    const previous = lastTimeoutLineRef.current;
    lastTimeoutLineRef.current = latest;
    if (previous === undefined || !latest || latest === previous) return;
    const who = latest.includes('white ran out') ? 'White' : 'Black';
    setStatus(`⏱ ${who} ran out of time — a random move was played.`);
  }, [state?.history]);

  const send = (action: object) => {
    if (!state || !you) return;
    if (localMode) {
      try {
        const next = applyClientAction(state as never, you, action as never) as GameState;
        commitLocalState(next, you);
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    const snapshot = state;
    try {
      const next = applyClientAction(snapshot as never, you, action as never) as GameState;
      if (next.phase === 'ended' && next.winner) {
        const kind = next.winner === you ? 'victory' : 'loss';
        const winnerName =
          next.players[next.winner]?.name || (next.winner === 'white' ? 'White' : 'Black');
        resultShownKeyRef.current = `${next.winner}:${next.winReason ?? ''}`;
        setResultShow({ kind, winnerName, reason: next.winReason ?? '' });
        playResultTrack(kind);
      }
      pushGameState(next, { actingAs: you, viewer: you });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!socket || !roomCode) return;
    socket.emit('action', { code: roomCode, action }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) {
        resultShownKeyRef.current = null;
        setResultShow(null);
        stopResultTrack();
        setError(res?.error ?? 'Action failed');
        pushGameState(snapshot, { actingAs: you, viewer: you });
      }
    });
  };

  const refreshMoves = (pieceId: string, game: GameState = state!) => {
    if (!game) return;
    try {
      const piece = game.pieces.find((p) => p.id === pieceId);
      const nextMoves = sanitizeMoves(
        piece,
        engineListMoves(game as never, pieceId) as MoveOption[],
      );
      const nextAbilities = engineAbilities(game as never, pieceId) as AbilityInfo[];
      setMoves(nextMoves);
      setAbilities(nextAbilities);
      movesReqRef.current = pieceId;
      const specials = new Set(nextMoves.map((m) => m.special).filter(Boolean));
      if (specials.has('swap_of_fates')) {
        setStatus('Swap of Fates ready — click an allied piece, then Confirm');
      } else if (specials.has('ancient_shuffle')) {
        setStatus('Ancient Shuffle ready — click an allied piece in range, then Confirm');
      } else if (specials.has('best_buddy')) {
        setStatus('Best Buddy ready — click an allied non-king on an L square, then Confirm');
      } else if (specials.has('death_stare')) {
        setStatus('Death Stare ready — click an enemy in range, then Confirm');
      } else if (specials.has('archer_shot')) {
        setStatus('Archer volley ready — click an enemy on an L, then Confirm');
      }
    } catch (e) {
      setError((e as Error).message);
      setMoves([]);
      setAbilities([]);
    }
  };

  // Free actions (e.g. Forme Swap) keep the turn, so the selected piece's options must be re-derived.
  useEffect(() => {
    if (!state || !selectedPiece || state.phase !== 'playing') return;
    const piece = state.pieces.find((p) => p.id === selectedPiece);
    if (!piece) return;
    try {
      setMoves(sanitizeMoves(piece, engineListMoves(state as never, selectedPiece) as MoveOption[]));
      setAbilities(engineAbilities(state as never, selectedPiece) as AbilityInfo[]);
    } catch {
      // keep the previous options
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestMoves = (pieceId: string) => {
    if (!state) return;
    setFocusSpecial(null);
    refreshMoves(pieceId, state);
    if (localMode || !socket || !roomCode) return;
    socket.emit(
      'get_moves',
      { code: roomCode, pieceId },
      (res: { ok: boolean; moves?: MoveOption[]; abilities?: AbilityInfo[]; error?: string }) => {
        if (movesReqRef.current !== pieceId) return;
        if (!res?.ok) return;
        const piece = state.pieces.find((p) => p.id === pieceId);
        const serverMoves = sanitizeMoves(piece, res.moves ?? []);
        // Prefer locally computed moves/abilities so the bar doesn't flash away
        // if the socket reply is empty or stale.
        setMoves((local) => (local.length ? local : serverMoves));
        setAbilities((local) => (local.length ? local : (res.abilities ?? [])));
      },
    );
  };

  const startLocalGame = () => {
    localModeRef.current = true;
    setLocalMode(true);
    skipGameSfxRef.current = true;
    skipMoveAnimRef.current = true;
    clearTransientUi();
    setError(null);

    let next = createLobbyState('LOCAL', Date.now(), lobbyRules);
    serverClockOffsetRef.current = 0;
    next.players.white.connected = true;
    next.players.black.connected = true;
    next.players.white.name = seatDisplayName(next as never, 'white', name);
    next.players.black.name = 'Black';
    next = startDraft(next);

    setCatalog(buildLocalCatalog());
    setDraftOptions(getDraftOptions(next));
    setRoomCode('LOCAL');
    setState(next as GameState);
    setYou('black');
    prevTurnRef.current = `${next.turn}:${next.phase}: :black`;
    setStatus(
      `Local play — Black chooses who ${banPhaseRule ? 'bans and drafts' : 'drafts'} first. Pass the device as seats change.`,
    );
    setCeremony({
      kind: 'vs',
      white: next.players.white.name,
      black: next.players.black.name,
    });
  };

  const exitToHome = () => {
    if (!localModeRef.current && roomCode) socket?.emit('leave_room', { code: roomCode });
    setHostedLocked(false);
    localModeRef.current = false;
    setLocalMode(false);
    setRoomCode(null);
    setState(null);
    setYou(null);
    setResultShow(null);
    resultShownKeyRef.current = null;
    setCatalog(null);
    setDraftOptions([]);
    clearTransientUi();
    setError(null);
    setStatus('Connect and create or join a room.');
    setCeremony(null);
    skipGameSfxRef.current = true;
    skipMoveAnimRef.current = true;
    prevTurnRef.current = null;
  };

  const createRoom = () => {
    const password = roomAccess === 'password' ? roomPassword.trim() : '';
    if (roomAccess === 'password' && !password) {
      setError('Enter a password, or set the room to Open.');
      return;
    }
    localModeRef.current = false;
    setLocalMode(false);
    socket?.emit(
      'create_room',
      { name, rules: lobbyRules, password },
      (res: { ok: boolean; code?: string; color?: Color; error?: string }) => {
        if (!res.ok) return setError(res.error ?? 'Create failed');
        setError(null);
        setHostedLocked(Boolean(password));
        setRoomCode(res.code!);
        setYou(res.color!);
        setStatus('Share the room code. Game starts when a second player joins.');
      },
    );
  };

  const onLobbyJoined = useCallback((code: string, color: Color) => {
    localModeRef.current = false;
    setLocalMode(false);
    setLobbyBrowserOpen(false);
    setError(null);
    setRoomCode(code);
    setYou(color);
    setStatus('');
  }, []);

  const closeLobbyBrowser = useCallback(() => setLobbyBrowserOpen(false), []);

  const board = useMemo(() => {
    const grid: Array<Array<Piece | null>> = Array.from({ length: 10 }, () => Array(10).fill(null));
    if (!state) return grid;
    for (const p of state.pieces) {
      const existing = grid[p.pos.row][p.pos.col];
      if (!existing) {
        grid[p.pos.row][p.pos.col] = p;
      } else if (existing.defId === 'pig' && p.defId !== 'pig') {
        // Prefer showing the host piece when a Pig is Best-Buddy sharing the tile
        grid[p.pos.row][p.pos.col] = p;
      }
    }
    return grid;
  }, [state]);

  const pigHostIds = useMemo(() => {
    const ids = new Set<string>();
    if (!state) return ids;
    for (const p of state.pieces) {
      if (p.defId === 'pig' && p.coOccupantId) ids.add(p.coOccupantId);
    }
    return ids;
  }, [state]);

  /** Prototypes whose Defense / Temporal Forme projects a field over nearby squares. */
  const protoFields = useMemo(() => {
    const fields: Array<{ id: string; forme: 'defense' | 'temporal'; row: number; col: number }> = [];
    if (!state) return fields;
    for (const p of state.pieces) {
      if (p.defId !== 'prototype' || p.proto?.rebooting) continue;
      const forme = formeOf(p.proto);
      if (forme === 'defense' || forme === 'temporal') fields.push({ id: p.id, forme, row: p.pos.row, col: p.pos.col });
    }
    return fields;
  }, [state]);

  const activeCardDef = useMemo(() => {
    if (!state || !you || !selectedCard) return null;
    const card = state.players[you].hand.find((c) => c.instanceId === selectedCard);
    return card ? cardMeta(catalog, card.defId) ?? null : null;
  }, [state, you, selectedCard, catalog]);

  const readCardDef = useMemo(() => {
    if (!state || !you || !readCardId) return null;
    const card = state.players[you].hand.find((c) => c.instanceId === readCardId);
    return card ? cardMeta(catalog, card.defId) ?? null : null;
  }, [state, you, readCardId, catalog]);
  const shownCardDef = readCardDef ?? activeCardDef;

  useEffect(() => {
    setReadCardId(null);
  }, [state?.turn, state?.turnPhase, you]);

  useEffect(() => {
    setCardDetailsCollapsed(false);
  }, [selectedCard]);

  useEffect(() => {
    if (pendingTargets.length > 0 || spellConfirm) setCardDetailsCollapsed(true);
  }, [pendingTargets.length, spellConfirm]);

  const barrierShiftHighlights = useMemo(() => {
    const barriers = new Set<string>();
    const destinations = new Set<string>();
    let fromKey: string | null = null;
    if (!state || !you) return { barriers, destinations, fromKey };
    const prompt = state.pendingPrompt;
    if (prompt?.type !== 'ability_target' || prompt.abilityId !== 'barrier_shift' || prompt.color !== you) {
      return { barriers, destinations, fromKey };
    }
    const selected = prompt.selected ?? [];
    if (selected.length === 0) {
      for (const t of state.tokens) {
        if (t.kind === 'barrier' && t.owner === you) barriers.add(`${t.pos.row},${t.pos.col}`);
      }
      return { barriers, destinations, fromKey };
    }
    const from = selected[0] as Coord;
    fromKey = `${from.row},${from.col}`;
    const otherBarriers = state.tokens.filter(
      (t) => t.kind === 'barrier' && t.owner === you && !(t.pos.row === from.row && t.pos.col === from.col),
    );
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const pos = { row: r, col: c };
        if (r === from.row && c === from.col) continue;
        if (!isAlliedTerritory(you, pos)) continue;
        if (state.pieces.some((p) => p.pos.row === r && p.pos.col === c)) continue;
        if (state.tokens.some((t) => t.pos.row === r && t.pos.col === c)) continue;
        if (otherBarriers.some((t) => chebyshev(t.pos, pos) === 1)) continue;
        destinations.add(`${r},${c}`);
      }
    }
    return { barriers, destinations, fromKey };
  }, [state, you]);

  const ultimateSuckHighlights = useMemo(() => {
    const targets = new Set<string>();
    const landings = new Set<string>();
    let fromKey: string | null = null;
    let crocKey: string | null = null;
    if (!state || !you) return { targets, landings, fromKey, crocKey };
    const prompt = state.pendingPrompt;
    if (
      prompt?.type !== 'ability_target' ||
      prompt.abilityId !== 'ultimate_suck' ||
      prompt.color !== you ||
      !prompt.pieceId
    ) {
      return { targets, landings, fromKey, crocKey };
    }
    const croc = state.pieces.find((p) => p.id === prompt.pieceId);
    if (croc) crocKey = `${croc.pos.row},${croc.pos.col}`;
    for (const p of ultimateSuckTargets(state as never, prompt.pieceId)) {
      targets.add(`${p.pos.row},${p.pos.col}`);
    }
    const target = prompt.targetId ? state.pieces.find((p) => p.id === prompt.targetId) : undefined;
    if (target) {
      fromKey = `${target.pos.row},${target.pos.col}`;
      for (const c of ultimateSuckLandings(state as never, prompt.pieceId, target.id)) {
        landings.add(`${c.row},${c.col}`);
      }
    }
    return { targets, landings, fromKey, crocKey };
  }, [state, you]);

  const promptSquareOptions = useMemo(() => {
    const keys = new Set<string>();
    const prompt = state?.pendingPrompt;
    if (!prompt || prompt.type !== 'ability_target' || prompt.color !== you) return keys;
    for (const o of (prompt.options ?? []) as unknown[]) {
      if (o && typeof o === 'object' && 'row' in o) keys.add(`${(o as Coord).row},${(o as Coord).col}`);
    }
    return keys;
  }, [state, you]);

  const gamblerChoiceHighlights = useMemo(() => {
    const targets = new Set<string>();
    if (!state || !you) return targets;
    const prompt = state.pendingPrompt;
    if (prompt?.type !== 'gambler_choice') return targets;
    const roll = prompt.roll ?? 0;
    if (roll > 4 || you === prompt.color) return targets;
    for (const p of state.pieces) {
      if (p.color !== prompt.color) continue;
      if (prompt.cardDefId === 'gamblers_gambit') {
        if (p.class === 'king' || p.class === 'queen') continue;
      } else if (prompt.cardDefId === 'gamblers_delight') {
        if (p.class !== 'pawn') continue;
      } else {
        continue;
      }
      targets.add(`${p.pos.row},${p.pos.col}`);
    }
    return targets;
  }, [state, you]);

  const targetNeeded = activeCardDef?.targeting && activeCardDef.targeting !== 'none';
  const magicSilenced = Boolean(state && you && isMagicDisabled(state, you));
  const canCastSpells = Boolean(state && spellsUnlocked(state) && !magicSilenced);

  const clearBoardConfirm = () => {
    setConfirmKey(null);
  };

  const cancelAbility = () => {
    const promptType = state?.pendingPrompt?.type;
    if (promptType === 'gadget_choice' || promptType === 'ability_target') {
      send({ type: 'cancel_prompt' });
    }
    setGadgetKind(null);
    setSpellConfirm(null);
    setFocusSpecial(null);
    clearBoardConfirm();
    setStatus(state?.pendingPrompt?.skippable ? 'Skipped.' : 'Ability canceled.');
  };

  /** First click aims; second click on the same target confirms (double-click). */
  const armOrConfirm = (key: string, hint: string, execute: () => void) => {
    if (confirmKey === key) {
      clearBoardConfirm();
      execute();
      return;
    }
    setConfirmKey(key);
    setStatus(`${hint} — click again to confirm`);
  };

  const finishCard = (targets: unknown[]) => {
    if (!selectedCard) return;
    send({ type: 'play_card', instanceId: selectedCard, targets });
    setSelectedCard(null);
    setPendingTargets([]);
    setSpellConfirm(null);
    clearBoardConfirm();
    setStatus('Card played.');
  };

  const describeSpellTargets = (cardName: string, targets: unknown[]): string => {
    if (!targets.length) return `Cast ${cardName}?`;
    const parts: string[] = [];
    for (const t of targets) {
      if (t && typeof t === 'object' && 'row' in (t as object) && 'col' in (t as object)) {
        const c = t as Coord;
        parts.push(`${FILE_LETTERS[c.col]}${10 - c.row}`);
      } else if (typeof t === 'string' && state) {
        const piece = state.pieces.find((p) => p.id === t);
        if (piece) parts.push(pieceMeta(catalog, piece.defId)?.name ?? piece.defId);
        else parts.push(pieceMeta(catalog, t)?.name ?? t);
      } else if (typeof t === 'number') {
        parts.push(`graveyard #${t + 1}`);
      }
    }
    if (!parts.length) return `Cast ${cardName}?`;
    if (parts.length === 1) return `Cast ${cardName} on ${parts[0]}?`;
    return `Cast ${cardName} on ${parts.join(' & ')}?`;
  };

  const offerSpellConfirm = (targets: unknown[]) => {
    if (!activeCardDef) return;
    setPendingTargets(targets);
    clearBoardConfirm();
    const summary = describeSpellTargets(activeCardDef.name, targets);
    setSpellConfirm({ summary, mode: 'card', targets });
    setStatus(summary);
  };

  const confirmSpell = () => {
    if (!spellConfirm) return;
    if (spellConfirm.mode === 'card') {
      finishCard(spellConfirm.targets ?? []);
      return;
    }
    if (spellConfirm.mode === 'move' && spellConfirm.move) {
      playPieceSfx();
      // Barrier Shift: first step is ability target select, not a board move
      if (spellConfirm.move.meta?.special === 'barrier_shift_select') {
        const from = (spellConfirm.move.meta.from as Coord | undefined) ?? spellConfirm.move.to;
        send({
          type: 'use_ability',
          pieceId: spellConfirm.move.pieceId,
          abilityId: 'barrier_shift',
          targets: { from },
        });
        setSpellConfirm(null);
        clearBoardConfirm();
        setStatus('Barrier Shift: click an empty square in allied territory, then Confirm');
        return;
      }
      send({
        type: 'move',
        pieceId: spellConfirm.move.pieceId,
        to: spellConfirm.move.to,
        meta: spellConfirm.move.meta,
      });
      setSelectedPiece(null);
      setMoves([]);
      setAbilities([]);
      setFocusSpecial(null);
      setSpellConfirm(null);
      clearBoardConfirm();
      movesReqRef.current = null;
      return;
    }
    send({ type: 'resolve_prompt', payload: spellConfirm.payload });
    setSpellConfirm(null);
    clearBoardConfirm();
  };

  const selectableMoves = movesForBoard(moves, focusSpecial);

  const onSquareClick = (row: number, col: number) => {
    if (!state || !you) return;
    if (state.pendingPrompt?.type === 'discard_to_draw') return;
    if (state.pendingPrompt?.type === 'opening_mulligan') return;
    playPieceSfx();
    const squareKey = `${row},${col}`;

    const prompt = state.pendingPrompt;
    if (prompt?.type === 'gambler_choice') {
      const roll = prompt.roll ?? 0;
      const cardPlayer = prompt.color;
      if (roll <= 4 && you !== cardPlayer) {
        const piece = board[row][col];
        if (!piece || piece.color !== cardPlayer || !gamblerChoiceHighlights.has(squareKey)) {
          setStatus('Click one of the highlighted enemy pieces');
          return;
        }
        const name = pieceMeta(catalog, piece.defId)?.name ?? piece.defId;
        const summary = `Remove ${name}?`;
        setSpellConfirm({ summary, mode: 'resolve_prompt', payload: piece.id });
        setStatus(summary);
        clearBoardConfirm();
        return;
      }
    }
    if (prompt && prompt.color === you) {
      if (prompt.type === 'gadget_choice' && gadgetKind) {
        armOrConfirm(squareKey, 'Place gadget here', () => {
          send({
            type: 'resolve_prompt',
            payload: { kind: gadgetKind, pos: { row, col } },
          });
          setGadgetKind(null);
        });
        return;
      }
      if (prompt.type === 'spring_bounce') {
        armOrConfirm(squareKey, 'Bounce here', () => {
          send({ type: 'resolve_prompt', payload: { row, col } });
        });
        return;
      }
      if (prompt.type === 'gnome_hole_travel') {
        armOrConfirm(squareKey, 'Travel here', () => {
          send({ type: 'resolve_prompt', payload: { row, col } });
        });
        return;
      }
      if (prompt.type === 'ability_target') {
        if (promptSquareOptions.size) {
          if (!promptSquareOptions.has(squareKey)) {
            setStatus(prompt.message ?? 'Click a highlighted square');
            return;
          }
          const summary = `Choose: ${FILE_LETTERS[col]}${10 - row}?`;
          setSpellConfirm({ summary, mode: 'resolve_prompt', payload: { row, col } });
          setStatus(summary);
          clearBoardConfirm();
          return;
        }
        if (prompt.abilityId === 'enchant') {
          const piece = board[row][col];
          if (piece) {
            const name = pieceMeta(catalog, piece.defId)?.name ?? piece.defId;
            const summary = `Cast Enchant on ${name}?`;
            setSpellConfirm({ summary, mode: 'resolve_prompt', payload: piece.id });
            setStatus(summary);
            clearBoardConfirm();
          }
          return;
        }
        if (prompt.abilityId === 'ultimate_suck') {
          const piece = board[row][col];
          if (ultimateSuckHighlights.landings.has(squareKey)) {
            const target = state.pieces.find((p) => p.id === prompt.targetId);
            const name = target ? pieceMeta(catalog, target.defId)?.name ?? target.defId : 'piece';
            const victim = piece ? pieceMeta(catalog, piece.defId)?.name ?? piece.defId : null;
            const summary = victim
              ? `Launch ${name} into ${victim} (capture)?`
              : `Launch ${name} to ${FILE_LETTERS[col]}${10 - row}?`;
            setSpellConfirm({ summary, mode: 'resolve_prompt', payload: { row, col } });
            setStatus(summary);
            clearBoardConfirm();
            return;
          }
          if (piece && ultimateSuckHighlights.targets.has(squareKey)) {
            send({ type: 'resolve_prompt', payload: piece.id });
            return;
          }
          setStatus(
            prompt.targetId
              ? 'Ultimate Suck: click a highlighted landing square, or pick another piece'
              : 'Ultimate Suck: click a highlighted piece within 2 tiles',
          );
          return;
        }
        if (prompt.abilityId === 'barrier_shift') {
          const selected = prompt.selected ?? [];
          const from = selected[0] as Coord | undefined;
          if (!from) {
            const isBarrier = state.tokens.some(
              (t) => t.kind === 'barrier' && t.owner === you && t.pos.row === row && t.pos.col === col,
            );
            if (!isBarrier) {
              setStatus('Barrier Shift: click one of your barriers');
              return;
            }
          } else if (!barrierShiftHighlights.destinations.has(squareKey)) {
            setStatus('Barrier Shift: pick a highlighted empty allied square');
            return;
          }
          const summary = from
            ? `Move barrier to ${FILE_LETTERS[col]}${10 - row}?`
            : `Select barrier at ${FILE_LETTERS[col]}${10 - row}?`;
          setSpellConfirm({
            summary,
            mode: 'resolve_prompt',
            payload: { row, col },
          });
          setStatus(summary);
          clearBoardConfirm();
          return;
        }
      }
    }

    if (selectedCard && targetNeeded && canCastSpells) {
      const mode = activeCardDef!.targeting;

      // Teleport: piece already chosen — next click is an empty destination 2 steps away
      if (
        activeCardDef!.id === 'teleport' &&
        pendingTargets.length === 1 &&
        typeof pendingTargets[0] === 'string'
      ) {
        if (board[row][col]) {
          setStatus('Teleport: destination must be empty (no captures)');
          return;
        }
        const piece = state.pieces.find((p) => p.id === pendingTargets[0]);
        if (!piece) {
          setPendingTargets([]);
          setStatus('Teleport: pick an allied piece in allied territory');
          return;
        }
        const dr = row - piece.pos.row;
        const dc = col - piece.pos.col;
        const legal =
          (Math.abs(dr) === 2 && dc === 0) ||
          (Math.abs(dc) === 2 && dr === 0) ||
          (Math.abs(dr) === 2 && Math.abs(dc) === 2);
        if (!legal) {
          setStatus('Teleport: pick a square exactly 2 spaces away (orthogonal or diagonal)');
          return;
        }
        offerSpellConfirm([...pendingTargets, { row, col }]);
        return;
      }

      // Revive: after choosing a graveyard index, pick spawn square
      if (mode === 'graveyard' && pendingTargets.length === 1 && typeof pendingTargets[0] === 'number') {
        offerSpellConfirm([...pendingTargets, { row, col }]);
        return;
      }

      if (mode === 'empty_allied' || mode === 'empty_any' || mode === 'square') {
        // Pawn Summon: [defId, pos, defId, pos, ...] — square only after a variant is chosen
        if (activeCardDef!.id === 'pawn_summon') {
          const gyPawns = you
            ? state.players[you].graveyard.filter((g) => g.class === 'pawn').length
            : 0;
          const need = Math.min(2, gyPawns);
          if (need < 1 || pendingTargets.length % 2 !== 1) {
            setStatus(
              need < 1
                ? 'Need fallen pawns'
                : `Choose pawn variant ${Math.floor(pendingTargets.length / 2) + 1} of ${need} first`,
            );
            return;
          }
          const next = [...pendingTargets, { row, col }];
          if (next.length >= need * 2) {
            offerSpellConfirm(next);
          } else {
            setPendingTargets(next);
            clearBoardConfirm();
            setSpellConfirm(null);
            setStatus(`Choose pawn variant ${Math.floor(next.length / 2) + 1} of ${need}`);
          }
          return;
        }
        const next = [...pendingTargets, { row, col }];
        const need = activeCardDef!.id === 'portal' ? 2 : 1;
        if (next.length >= need) {
          offerSpellConfirm(next);
        } else {
          setPendingTargets(next);
          clearBoardConfirm();
          setSpellConfirm(null);
          setStatus(`Pick ${need - next.length} more square(s)`);
        }
        return;
      }
    }

    if (selectedPiece && selectableMoves.some((m) => m.to.row === row && m.to.col === col)) {
      const candidates = selectableMoves.filter((m) => m.to.row === row && m.to.col === col);
      if (candidates.length) {
        const move =
          focusSpecial != null
            ? candidates.find((m) => m.special === focusSpecial) ??
              candidates.find((m) => !m.special) ??
              candidates[0]!
            : candidates.find((m) => !m.special) ?? candidates.find((m) => m.special) ?? candidates[0]!;
        if (move.special === 'best_buddy') {
          const pig = state.pieces.find((p) => p.id === selectedPiece);
          if (!pig || !isPigLShape(pig.pos, { row, col }, pigMoveBonus(pig))) {
            setStatus('Best Buddy only shares a tile in the Pig’s L-move range (2×1).');
            return;
          }
        }
        const hint =
          move.special === 'swap_of_fates'
            ? 'Swap of Fates'
            : move.special === 'ancient_shuffle'
              ? 'Ancient Shuffle'
              : move.special === 'best_buddy'
                ? 'Best Buddy'
                : move.special === 'death_stare'
                  ? 'Death Stare'
                  : move.special === 'archer_shot'
                    ? 'Archer volley'
                    : move.special === 'giga_stomp'
                      ? 'Giga Stomp'
                    : move.special === 'castle_swap'
                    ? 'Castle'
                    : move.special === 'portal_travel'
                      ? 'Portal'
                      : move.capture
                      ? 'Capture'
                      : 'Move';
        const meta = move.special
          ? { special: move.special, ...(move.meta ?? {}) }
          : undefined;
        // Special abilities use the Confirm panel (more reliable than double-click on occupied tiles)
        if (move.special) {
          setPendingTargets([]);
          clearBoardConfirm();
          setSpellConfirm({
            summary: `${hint} here?`,
            mode: 'move',
            move: { pieceId: selectedPiece, to: { row, col }, meta },
          });
          setStatus(`${hint} — press Confirm`);
          return;
        }
        armOrConfirm(squareKey, `${hint} here`, () => {
          send({
            type: 'move',
            pieceId: selectedPiece,
            to: { row, col },
            meta,
          });
          setSelectedPiece(null);
          setMoves([]);
          setAbilities([]);
          setFocusSpecial(null);
          movesReqRef.current = null;
        });
        return;
      }
    }

    const piece = board[row][col];
    if (piece && selectedCard && targetNeeded && canCastSpells) {
      const mode = activeCardDef!.targeting;
      if (['piece', 'allied_piece', 'any_piece_non_king', 'enemy_piece', 'multi_allied'].includes(mode)) {
        if (mode === 'allied_piece' && piece.color !== you) return;
        if (mode === 'enemy_piece' && piece.color === you) return;
        if (mode === 'any_piece_non_king' && piece.class === 'king') return;
        if (mode === 'multi_allied') {
          if (piece.color !== you) return;
          const next = [...pendingTargets, piece.id];
          if (next.length >= 4) {
            const selectedPieces = next.map((id) => state.pieces.find((p) => p.id === id)!);
            const assignment: Record<string, Coord> = {};
            for (let i = 0; i < 4; i++) {
              assignment[selectedPieces[i].id] = selectedPieces[(i + 1) % 4].pos;
            }
            offerSpellConfirm([...next, assignment]);
          } else {
            setPendingTargets(next);
            clearBoardConfirm();
            setSpellConfirm(null);
            setStatus(`Rearrange: pick ${4 - next.length} more allied piece(s)`);
          }
          return;
        }
        if (activeCardDef!.id === 'teleport') {
          if (!isAlliedTerritory(you!, piece.pos)) {
            setStatus('Teleport: piece must be in allied territory');
            return;
          }
          setPendingTargets([piece.id]);
          clearBoardConfirm();
          setSpellConfirm(null);
          setStatus('Teleport: now pick an empty destination exactly 2 spaces away');
          return;
        }
        if (activeCardDef!.id === 'swap') {
          setPendingTargets([piece.id]);
          clearBoardConfirm();
          setSpellConfirm(null);
          setStatus('Swap: pick a different variant from the buttons below');
          return;
        }
        offerSpellConfirm([piece.id]);
        return;
      }
    }

    // Selection clicks — not confirms
    clearBoardConfirm();
    if (piece && piece.color === you) {
      const selected = selectedPiece ? state.pieces.find((p) => p.id === selectedPiece) : null;
      if (
        selected?.defId === 'pig' &&
        piece.id !== selectedPiece &&
        piece.class !== 'king' &&
        (focusSpecial === 'best_buddy' ||
          moves.some((m) => m.special === 'best_buddy' && m.to.row === row && m.to.col === col))
      ) {
        if (!isPigLShape(selected.pos, piece.pos, pigMoveBonus(selected))) {
          setStatus('Best Buddy only shares a tile in the Pig’s L-move range (2×1).');
          return;
        }
      }
      setInspectedId(piece.id);
      setSelectedPiece(piece.id);
      requestMoves(piece.id);
    } else if (piece) {
      setInspectedId(piece.id);
      setSelectedPiece(null);
      setMoves([]);
      setAbilities([]);
    } else {
      const token = state.tokens.find((t) => t.pos.row === row && t.pos.col === col);
      setSelectedPiece(null);
      setMoves([]);
      setAbilities([]);
      if (token) {
        setInspectedId(`token:${token.id}`);
      } else {
        setInspectedId(null);
        setHoveredId(null);
      }
    }
  };

  const castCard = () => {
    if (!selectedCard || !activeCardDef) return;
    if (!state || !spellsUnlocked(state)) {
      setError('Spell cards cannot be used until the first night');
      return;
    }
    if (activeCardDef.targeting === 'none') {
      offerSpellConfirm([]);
      return;
    }
    if (activeCardDef.targeting === 'graveyard') {
      const gy = you ? state?.players[you].graveyard ?? [] : [];
      if (!gy.length) {
        setError('No fallen pieces');
        return;
      }
      setPendingTargets([]);
      setSpellConfirm(null);
      setStatus('Revive: pick a fallen piece, then an empty spawn square');
      return;
    }
    if (activeCardDef.id === 'pawn_summon') {
      const gyPawns = you ? state?.players[you].graveyard.filter((g) => g.class === 'pawn').length ?? 0 : 0;
      if (gyPawns < 1) {
        setError('Need fallen pawns');
        return;
      }
      setPendingTargets([]);
      setSpellConfirm(null);
      setStatus(`Pawn Summon: choose variant 1 of ${Math.min(2, gyPawns)}`);
      return;
    }
    setPendingTargets([]);
    setSpellConfirm(null);
    setStatus(`Select target for ${activeCardDef.name} (${activeCardDef.targeting})`);
  };

  const { inspectedPiece, inspectedToken } = useMemo(() => {
    if (!state) return { inspectedPiece: null, inspectedToken: null };
    const lock = inspectedId && !inspectedId.startsWith('draft:') ? inspectedId : null;
    const hover = hoveredId && !hoveredId.startsWith('draft:') ? hoveredId : null;
    const active = lock ?? hover;
    if (!active) return { inspectedPiece: null, inspectedToken: null };
    if (active.startsWith('token:')) {
      return {
        inspectedPiece: null,
        inspectedToken: state.tokens.find((t) => t.id === active.slice(6)) ?? null,
      };
    }
    return {
      inspectedPiece: state.pieces.find((p) => p.id === active) ?? null,
      inspectedToken: null,
    };
  }, [state, inspectedId, hoveredId]);

  const infoLocked = Boolean(inspectedId && !inspectedId.startsWith('draft:'));

  const draftInspectDefId = inspectedId?.startsWith('draft:')
    ? inspectedId.slice(6)
    : hoveredId?.startsWith('draft:')
      ? hoveredId.slice(6)
      : null;

  const musicScene =
    !roomCode || !state
      ? 'menu'
      : state.phase === 'playing' || state.phase === 'opening_draw' || state.phase === 'ended'
        ? 'game'
        : 'menu';
  useAudioScene(musicScene);

  const [fxEpoch, setFxEpoch] = useState(0);

  const resetFxSfx = () => {
    setFxEnabled(true);
    setSfxEnabled(true);
    setFxEpoch((n) => n + 1);
    document.documentElement.classList.remove('fx-off');
    setResultShow(null);
    resetStuckAudio(musicScene);
  };

  const audioFxStack = (
    <div className="corner-toggles-right">
      <AudioToggles
        musicEnabled={musicEnabled}
        sfxEnabled={sfxEnabled}
        musicVolume={musicVolume}
        onToggleMusic={() => setMusicEnabled((v: boolean) => !v)}
        onToggleSfx={() => setSfxEnabled((v: boolean) => !v)}
        onMusicVolume={(v) => setMusicVolume(v)}
      />
      <FxToggle enabled={fxEnabled} onToggle={() => setFxEnabled((v) => !v)} />
      {createPortal(
        <button
          type="button"
          className="audio-toggle reset-fx-sfx is-portaled"
          data-audio="off"
          title="Stop stuck tracks and restore FX and SFX"
          onClick={resetFxSfx}
        >
          <span className="fx-toggle-glyph" aria-hidden>
            ↺
          </span>
          <span className="fx-toggle-label">Reset FX & SFX</span>
        </button>,
        document.body,
      )}
    </div>
  );

  if (!roomCode || !state) {
    return (
      <div className="shell lobby-shell home">
        <CosmicBackdrop key={fxEpoch} enabled={fxEnabled} dayNight="day" />
        <main className="home-hero">
          <p className="brand home-brand">
            Chesspansion <span className="beta-tag" aria-label="Beta">Beta</span>
          </p>
          <p className="home-tagline">
            Draft strange armies, weave spell cards, and fight across a 10×10 realm of day and night.
          </p>
          <div className="home-panel">
            <label className="home-label">
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" />
            </label>
            <fieldset className="home-rules-options">
              <legend>Lobby rules</legend>
              <label className="home-rule-toggle">
                <input
                  type="checkbox"
                  checked={banPhaseRule}
                  onChange={(e) => setBanPhaseRule(e.target.checked)}
                />
                <span className="home-rule-switch" aria-hidden />
                <span className="home-rule-text">
                  <strong>Ban phase</strong>
                  <em>Each player bans 2 pieces (max 1 per class) before drafting.</em>
                </span>
              </label>
              <label className="home-rule-toggle">
                <input
                  type="checkbox"
                  checked={anonymousRule}
                  onChange={(e) => setAnonymousRule(e.target.checked)}
                />
                <span className="home-rule-switch" aria-hidden />
                <span className="home-rule-text">
                  <strong>Anonymous</strong>
                  <em>Display names are hidden — players show as “White” and “Black”.</em>
                </span>
              </label>
              <div className="home-rule-group">
                <label className="home-rule-toggle">
                  <input
                    type="checkbox"
                    checked={turnTimerSeconds > 0}
                    onChange={(e) => setTurnTimerRule(e.target.checked ? 30 : 0)}
                  />
                  <span className="home-rule-switch" aria-hidden />
                  <span className="home-rule-text">
                    <strong>Chess but Fast ⏱</strong>
                    <em>Each turn is timed. Run out and a random piece moves for you. No limit while in check.</em>
                  </span>
                </label>
                {turnTimerSeconds > 0 && (
                  <div className="home-access-seg home-timer-seg" role="radiogroup" aria-label="Seconds per turn">
                    {TURN_TIMER_OPTIONS.map((secs) => (
                      <button
                        key={secs}
                        type="button"
                        role="radio"
                        aria-checked={turnTimerSeconds === secs}
                        className={turnTimerSeconds === secs ? 'is-active' : ''}
                        onClick={() => setTurnTimerRule(secs)}
                      >
                        {secs === 60 ? '1 min' : `${secs}s`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="home-access">
                <span className="home-access-label">
                  <strong>Online room access</strong>
                  <em>
                    {roomAccess === 'open'
                      ? 'Anyone in the lobby list can join.'
                      : 'Players need the password to join.'}
                  </em>
                </span>
                <div className="home-access-seg" role="radiogroup" aria-label="Online room access">
                  {(['open', 'password'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={roomAccess === mode}
                      className={roomAccess === mode ? 'is-active' : ''}
                      onClick={() => {
                        setRoomAccess(mode);
                        setError(null);
                      }}
                    >
                      {mode === 'open' ? '🔓 Open' : '🔒 Password'}
                    </button>
                  ))}
                </div>
                {roomAccess === 'password' && (
                  <input
                    className="home-access-password"
                    type="password"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                    placeholder="Room password"
                    aria-label="Room password"
                    maxLength={32}
                    autoComplete="new-password"
                  />
                )}
              </div>
            </fieldset>
            <div className="home-actions">
              <button type="button" className="primary home-cta" onClick={startLocalGame}>
                Local play
              </button>
              <button type="button" className="home-cta home-cta-secondary" onClick={createRoom}>
                Create online room{roomAccess === 'password' ? ' 🔒' : ''}
              </button>
              <button
                type="button"
                className="home-cta home-cta-secondary"
                onClick={() => {
                  setError(null);
                  setLobbyBrowserOpen(true);
                }}
              >
                Join lobby
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
          <button type="button" className="home-rules" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
        </main>
        <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
        <LobbyBrowser
          open={lobbyBrowserOpen}
          onClose={closeLobbyBrowser}
          socket={socket}
          name={name}
          onJoined={onLobbyJoined}
        />
        {audioFxStack}
      </div>
    );
  }

  const flip = you === 'black';
  const showBoardKnowledge =
    state.phase === 'playing' || state.phase === 'opening_draw' || state.phase === 'ended';
  const draftPreviewDefId =
    state.phase === 'draft' && draftOptions.length > 0
      ? draftInspectDefId ?? draftOptions[0]
      : null;
  const draftBanning = state.phase === 'draft' && state.draft?.stage === 'ban';
  const draftBanned = state.phase === 'draft' ? draftBannedIds(state as never) : [];
  const draftMyTurn =
    state.phase === 'draft' &&
    state.draft?.blackChoseFirstPicker != null &&
    state.draft.pickingColor === you;
  const draftRandomChoices = draftMyTurn
    ? draftOptions.filter(
        (id) =>
          !draftBanned.includes(id) && (!draftBanning || !draftBanBlockReason(state as never, you!, id)),
      )
    : [];

  const activeLaws = (state.laws ?? []).flatMap((l) => {
    const law = LAWS[l.id];
    return law ? [{ law, by: l.by }] : [];
  });

  const promptDocked = wideLayout && showBoardKnowledge;
  const promptFloat =
    !messagesHidden &&
    state.pendingPrompt?.type !== 'discard_to_draw' &&
    state.pendingPrompt?.type !== 'opening_mulligan' &&
    (status || error || state.pendingPrompt || spellConfirm) ? (
      <div
        key={[
          status,
          error ?? '',
          state.pendingPrompt?.type ?? '',
          state.pendingPrompt?.message ?? '',
          spellConfirm?.summary ?? '',
          confirmKey ?? '',
        ].join('|')}
        className={[
          'board-prompt-float',
          promptDocked ? 'is-docked' : '',
          error ? 'is-error' : '',
          spellConfirm || state.pendingPrompt || confirmKey ? 'is-action' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="status"
        aria-live="assertive"
      >
        <div className="board-prompt-float-head">
          <p className="board-prompt-float-label">
            {error ? 'Error' : spellConfirm || confirmKey ? 'Confirm' : state.pendingPrompt ? 'Action needed' : 'Message'}
          </p>
          <button
            type="button"
            className="msg-dismiss"
            aria-label="Close message"
            onClick={() => {
              setMessagesHidden(true);
              setError(null);
              setStatus('');
            }}
          >
            ×
          </button>
        </div>
        <PlayPromptBanners
          status={status}
          error={error}
          state={state}
          you={you}
          catalog={catalog}
          gadgetKind={gadgetKind}
          setGadgetKind={setGadgetKind}
          setStatus={setStatus}
          send={send}
          cancelAbility={cancelAbility}
          onOpenLawPicker={() => setLawPickerHidden(false)}
        />
        {spellConfirm && (
          <div className="spell-confirm" role="dialog" aria-label="Confirm spell">
            <p className="spell-confirm-summary">{spellConfirm.summary}</p>
            <div className="spell-confirm-actions">
              <button type="button" className="primary" onClick={confirmSpell}>
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  const promptType = state.pendingPrompt?.type;
                  if (
                    (promptType === 'gadget_choice' || promptType === 'ability_target') &&
                    !state.pendingPrompt?.skippable
                  ) {
                    cancelAbility();
                    return;
                  }
                  setSpellConfirm(null);
                  setFocusSpecial(null);
                  clearBoardConfirm();
                  setStatus('Canceled.');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    ) : null;
  const sideColors: Color[] = flip ? ['white', 'black'] : ['black', 'white'];

  return (
    <div
      className={[
        'shell',
        showBoardKnowledge ? 'is-play' : '',
        mobileSheet ? `sheet-${mobileSheet}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <CosmicBackdrop key={fxEpoch} enabled={fxEnabled} dayNight={state.dayNight} />
      {ceremony && (
        <MatchCeremony
          key={
            ceremony.kind === 'lobby'
              ? `lobby:${ceremony.code}`
              : ceremony.kind === 'vs'
                ? `vs:${ceremony.white}:${ceremony.black}`
                : `order:${ceremony.whiteFirst}`
          }
          ceremony={ceremony}
          onDone={() => setCeremony(null)}
        />
      )}
      {state.pendingPrompt?.type === 'discard_to_draw' && !overlayPeek && (
        <DiscardToDrawOverlay
          key={state.pendingPrompt.drawnInstanceId}
          prompt={state.pendingPrompt}
          you={you!}
          state={state}
          catalog={catalog}
          onDiscard={(instanceId) => send({ type: 'resolve_prompt', payload: instanceId })}
          onClose={() => setOverlayPeek(true)}
        />
      )}
      {state.pendingPrompt?.type === 'opening_mulligan' && !overlayPeek && (
        <OpeningMulliganOverlay
          key={state.players[state.pendingPrompt.color!].hand.map((c) => c.instanceId).join(',')}
          prompt={state.pendingPrompt}
          you={you!}
          state={state}
          catalog={catalog}
          onKeep={() => send({ type: 'opening_keep' })}
          onRedraw={(instanceId) => send({ type: 'opening_redraw', instanceId })}
          onClose={() => setOverlayPeek(true)}
        />
      )}
      <TurnStrip
        state={state}
        you={you}
        localMode={localMode}
        clockOffsetMs={localMode ? 0 : serverClockOffsetRef.current}
      />
      {resultShow && (
        <ResultCeremony
          kind={resultShow.kind}
          winnerName={resultShow.winnerName}
          reason={resultShow.reason}
          onContinue={() => {
            stopResultTrack();
            setResultShow(null);
          }}
        />
      )}
      {cardCast && (
        <CardCastFx
          key={cardCast.key}
          cast={cardCast}
          image={cardCast.defId ? cardMeta(catalog, cardCast.defId)?.image : undefined}
        />
      )}
      {checkAlert && (
        <div
          className={`check-alert${checkAlert === 'dealt' ? ' is-dealt' : ''}`}
          role="alert"
          aria-live="assertive"
        >
          <button
            type="button"
            className="msg-dismiss"
            aria-label="Dismiss check alert"
            onClick={() => setCheckAlert(null)}
          >
            ×
          </button>
          <span className="check-alert-mark" aria-hidden />
          <span className="check-alert-title">Check!</span>
          <span className="check-alert-sub">
            {checkAlert === 'dealt' ? 'Their king is under attack' : 'Your king is under attack'}
          </span>
        </div>
      )}
      {state.pendingPrompt?.type === 'law_choice' && state.pendingPrompt.color === you && !lawPickerHidden && (
        <LawPicker
          key={`${state.pendingPrompt.color}:${(state.pendingPrompt.options as string[]).join(',')}`}
          options={state.pendingPrompt.options as string[]}
          color={you}
          onEnact={(lawId) => send({ type: 'resolve_prompt', payload: lawId })}
          onSkip={() => send({ type: 'resolve_prompt', payload: 'skip' })}
          onHide={() => setLawPickerHidden(true)}
        />
      )}
      {formeToasts.length > 0 && (
        <div className="forme-toasts" role="status" aria-live="polite">
          {formeToasts.map((t) => (
            <FormeToast
              key={t.key}
              toast={t}
              onClose={() => setFormeToasts((cur) => cur.filter((x) => x.key !== t.key))}
            />
          ))}
        </div>
      )}
      {(overlayPeek || messagesHidden) &&
        (state.pendingPrompt || spellConfirm) && (
          <button
            type="button"
            className="prompt-restore"
            onClick={() => {
              setMessagesHidden(false);
              setOverlayPeek(false);
            }}
          >
            Show message
          </button>
        )}
      {!promptDocked && promptFloat}
      <div className="shell-content">
      <header className="top">
        <div className="top-left">
          <p className="brand">
            Chesspansion <span className="beta-tag" aria-label="Beta">Beta</span>
          </p>
          <div className="game-status-bar" role="status" aria-live="polite">
            <span className="status-chip chip-room">
              {localMode ? (
                <>
                  Mode <strong>Local</strong>
                </>
              ) : (
                <>
                  Room <strong>{roomCode}</strong>
                </>
              )}
            </span>
            <span className={`status-chip chip-you chip-you-${you}`}>
              {localMode ? 'Controlling' : 'You'} · <strong>{you}</strong>
            </span>
            <span className={`status-chip chip-cycle chip-${state.dayNight}`}>
              <span className="chip-cycle-mark" aria-hidden />
              <span className="chip-cycle-phase">{state.dayNight === 'day' ? 'Day' : 'Night'}</span>
              <span className="chip-cycle-meta">
                Cycle {state.cycleCount}
                {state.phase === 'playing' || state.phase === 'opening_draw' ? (
                  <> · flip in {cyclesUntilDayNightFlip(state.cycleCount)}</>
                ) : null}
              </span>
            </span>
            <span className="status-chip chip-phase">{phaseLabel(state.phase)}</span>
          </div>
        </div>
        <div className="top-right">
          {promptDocked && (
            <div className="top-controls">
              <KnowledgeToggle
                enabled={knowledgeEnabled}
                onToggle={() => setKnowledgeEnabled((v) => !v)}
              />
              {audioFxStack}
            </div>
          )}
          {state.phase === 'ended' && (
            <span className="winner">
              {state.winner} wins ({state.winReason})
            </span>
          )}
          <button type="button" className="exit-game-btn" onClick={exitToHome}>
            {localMode ? 'Exit local' : 'Leave'}
          </button>
        </div>
      </header>

      {!showBoardKnowledge && (
        <PlayPromptBanners
          status={status}
          error={error}
          state={state}
          you={you}
          catalog={catalog}
          gadgetKind={gadgetKind}
          setGadgetKind={setGadgetKind}
          setStatus={setStatus}
          send={send}
          cancelAbility={cancelAbility}
          onDismissStatus={() => setStatus('')}
          onDismissError={() => setError(null)}
          onOpenLawPicker={() => setLawPickerHidden(false)}
        />
      )}

      {state.phase === 'lobby' && (
        <div className="waiting-room">
          <p className="waiting-room-kicker">Lobby ready</p>
          <p className="waiting-room-code">{roomCode}</p>
          <p className="waiting-room-copy">Share this code. Waiting for an opponent to join…</p>
          <p className="waiting-room-rules">
            Ban phase: <strong>{state.rules?.banPhase === false ? 'Off' : 'On'}</strong>
            {' · '}
            Access: <strong>{hostedLocked ? '🔒 Password' : '🔓 Open'}</strong>
            {state.rules?.anonymous && (
              <>
                {' · '}
                <strong>Anonymous</strong>
              </>
            )}
            {state.rules?.turnTimerSeconds ? (
              <>
                {' · '}
                Chess but Fast: <strong>⏱ {state.rules.turnTimerSeconds}s/turn</strong>
              </>
            ) : null}
          </p>
        </div>
      )}

      {state.phase === 'draft' && state.draft && (
        <div className="draft-screen">
          <aside className="draft-info-fixed" aria-live="polite">
            <div className="draft-info-panel">
              {draftPreviewDefId ? (
                <DraftPieceInfoPanel defId={draftPreviewDefId} color={you ?? 'white'} />
              ) : (
                <div className="draft-info-empty">
                  <p className="draft-info-label">Piece details</p>
                  <h3>Select a variant</h3>
                  <p>Hover or click any piece to read its movement and abilities here.</p>
                </div>
              )}
            </div>
            {draftInspectDefId &&
              state.draft.pickingColor === you &&
              !draftBanned.includes(draftInspectDefId) &&
              (() => {
                const name = pieceMeta(catalog, draftInspectDefId)?.name ?? draftInspectDefId;
                if (!draftBanning) {
                  return (
                    <button
                      type="button"
                      className="primary draft-confirm"
                      disabled={draftRolling}
                      onClick={() => {
                        send({ type: 'draft_pick', defId: draftInspectDefId });
                        setInspectedId(null);
                      }}
                    >
                      Confirm {name}
                    </button>
                  );
                }
                const blocked = draftBanBlockReason(state as never, you!, draftInspectDefId);
                return blocked ? (
                  <p className="draft-info-wait muted">{blocked}.</p>
                ) : (
                  <button
                    type="button"
                    className="primary draft-confirm draft-ban-confirm"
                    disabled={draftRolling}
                    onClick={() => {
                      send({ type: 'draft_ban', defId: draftInspectDefId });
                      setInspectedId(null);
                    }}
                  >
                    Ban {name}
                  </button>
                );
              })()}
            {draftInspectDefId && state.draft.pickingColor !== you && (
              <p className="draft-info-wait muted">
                Waiting for opponent to {draftBanning ? 'ban' : 'pick'}.
              </p>
            )}
          </aside>

          <section className="panel draft draft-stage">
            <h2>{draftBanning ? 'Ban phase' : 'Army draft'}</h2>
            <DraftArmyRoster
              state={state}
              catalog={catalog}
              pickFlash={draftPickFlash}
              banFlash={draftBanFlash}
            />
            {state.draft.blackChoseFirstPicker != null && (
              <p className="draft-status draft-status-global">
                {state.draft.pickingColor === you ? (
                  draftBanning ? (
                    <>
                      <strong>Your ban</strong> — {BANS_PER_COLOR - (state.draft.bans?.[you!]?.length ?? 0)} left, at
                      most one per class. Banned pieces are off-limits for both players.
                    </>
                  ) : (
                    <>
                      <strong>Your pick</strong> — choose any class you have not drafted yet
                    </>
                  )
                ) : (
                  <>
                    <strong>{state.players[state.draft.pickingColor].name}</strong> is{' '}
                    {draftBanning ? 'banning' : 'picking'}…
                  </>
                )}
              </p>
            )}
            {draftMyTurn && draftRandomChoices.length > 0 && (
              <div className="draft-random-row">
                <button
                  type="button"
                  className={`draft-random-btn${draftBanning ? ' is-ban' : ''}${draftRolling ? ' is-rolling' : ''}`}
                  disabled={draftRolling}
                  onClick={() =>
                    rollDraftSelection(draftRandomChoices, (id) => {
                      send({ type: draftBanning ? 'draft_ban' : 'draft_pick', defId: id });
                      setInspectedId(null);
                    })
                  }
                  title={`${draftBanning ? 'Ban' : 'Draft'} a random piece`}
                >
                  <span className="draft-random-die" aria-hidden>
                    🎲
                  </span>
                  {draftRolling ? 'Rolling…' : 'Random Selection'}
                </button>
              </div>
            )}

            {state.draft.blackChoseFirstPicker == null ? (
              you === 'black' ? (
                <div className="row draft-center-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => send({ type: 'choose_first_picker', whitePicksFirst: true })}
                  >
                    White goes first
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => send({ type: 'choose_first_picker', whitePicksFirst: false })}
                  >
                    Black goes first
                  </button>
                </div>
              ) : (
                <p className="draft-status">
                  Waiting for Black to choose who {state.rules?.banPhase === false ? 'drafts' : 'bans and drafts'}{' '}
                  first…
                </p>
              )
            ) : (
              <div className="draft-class-groups">
                {DRAFT_ORDER.filter(
                  (cls) => draftBanning || !state.players[state.draft!.pickingColor].army[cls],
                ).map(
                  (cls) => (
                    <div key={cls} className="draft-class-group">
                      <h3 className="draft-class-heading">{DRAFT_CLASS_LABELS[cls] ?? cls}</h3>
                      <div className="variant-grid draft-grid draft-class-options">
                        {(VARIANTS_BY_CLASS[cls] ?? []).map((id) => {
                          const p = pieceMeta(catalog, id);
                          const displayName = PIECES[id]?.name ?? p?.name ?? id;
                          const selected = draftInspectDefId === id;
                          const canPick = state.draft?.pickingColor === you;
                          const banned = draftBanned.includes(id);
                          const shaking = draftShake?.id === id;
                          return (
                            <button
                              key={shaking ? `${id}-${draftShake!.n}` : id}
                              type="button"
                              data-draft-id={id}
                              aria-disabled={banned || undefined}
                              title={banned ? `${displayName} is banned` : undefined}
                              className={[
                                'draft-tile',
                                selected && !banned ? 'selected' : '',
                                selected && draftRolling ? 'is-rolling' : '',
                                !canPick ? 'muted-pick' : '',
                                banned ? 'is-banned' : '',
                                shaking ? 'is-shaking' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => {
                                if (banned) {
                                  playErrorBuzzSfx();
                                  setDraftShake({ id, n: Date.now() });
                                  return;
                                }
                                playDraftSelectSfx();
                                setInspectedId(`draft:${id}`);
                              }}
                              onMouseEnter={() => setHoveredId(`draft:${id}`)}
                              onMouseLeave={() =>
                                setHoveredId((h) => (h === `draft:${id}` ? null : h))
                              }
                            >
                              <span className="sym">
                                <PieceIcon
                                  defId={id}
                                  color={state.draft!.pickingColor}
                                  title={displayName}
                                />
                              </span>
                              <span className="draft-tile-name">{displayName}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {(state.phase === 'playing' || state.phase === 'opening_draw' || state.phase === 'ended') && (
        <div className="play-layout">
          <aside className="side">
            {promptDocked && promptFloat}
            {sideColors.map((color) => {
              const player = state.players[color];
              const active = state.phase === 'playing' && state.turn === color;
              const inCheck = state.phase === 'playing' && state.check === color;
              const fallback = color === 'white' ? 'White' : 'Black';
              return (
                <section
                  key={color}
                  className={['player-card', `is-${color}`, active ? 'is-active' : '', inCheck ? 'is-check' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <header className="player-card-head">
                    <span className="player-card-dot" aria-hidden />
                    <span className="player-card-name">{player.name || fallback}</span>
                    {!localMode && color === you && <span className="player-card-tag">You</span>}
                    {!localMode && !player.connected && <span className="player-card-tag is-offline">Offline</span>}
                    {active && (
                      <span className={`player-card-turn${inCheck ? ' is-check' : ''}`}>
                        {inCheck ? 'In check' : 'To play'}
                      </span>
                    )}
                  </header>
                  <p className="player-card-meta">
                    <span>
                      <strong>{player.hand.length}</strong> in hand
                    </span>
                    <span>
                      <strong>{player.graveyard.length}</strong> fallen
                    </span>
                  </p>
                  {player.graveyard.length > 0 && (
                    <Graveyard items={player.graveyard} catalog={catalog} color={color} />
                  )}
                </section>
              );
            })}
            {wideLayout && activeLaws.length > 0 && (
              <section className="law-board" aria-label="Laws in force">
                <h2 className="law-board-title">Laws in force · until dawn</h2>
                {activeLaws.map(({ law, by }) => (
                  <div key={law.id} className={`law-board-item is-${by}`}>
                    <strong>{law.name}</strong>
                    <span>{law.text}</span>
                  </div>
                ))}
              </section>
            )}
            <h2 className="side-log-title">Battle log</h2>
            <ul className="log">
              {state.history.slice(0, 40).map((h, i) => {
                const match = h.match(/^\[([^\]]+)\]\s*(.*)$/);
                const time = match?.[1];
                const text = match?.[2] ?? h;
                return (
                  <li key={`${h}-${i}`}>
                    {time ? <span className="log-time">{time}</span> : null}
                    <span className="log-text">{text}</span>
                  </li>
                );
              })}
            </ul>
          </aside>

          <main className="board-wrap">
            {!wideLayout && activeLaws.length > 0 && (
              <div className="law-strip" aria-label="Laws in force until dawn">
                <span className="law-strip-label">Laws</span>
                {activeLaws.map(({ law, by }) => (
                  <button
                    key={law.id}
                    type="button"
                    className={`law-chip is-${by}`}
                    title={law.text}
                    onClick={() => setStatus(`${law.name} (until dawn): ${law.text}`)}
                  >
                    {law.name}
                  </button>
                ))}
              </div>
            )}
            <div className="board-stage">
            <div
              className={[
                'board',
                flip ? 'flipped' : '',
                state.phase === 'playing' ? (state.turn === you ? 'board-your-turn' : 'board-their-turn') : '',
                state.phase === 'playing' && state.check === you ? 'board-in-check' : '',
                checkAlert === 'received' ? 'board-check-flash' : '',
                checkAlert === 'dealt' ? 'board-check-dealt-flash' : '',
                cardCast ? `board-cast-flash board-cast-${cardCast.tone}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >              {Array.from({ length: 10 }, (_, visualRow) =>
                Array.from({ length: 10 }, (_, visualCol) => {
                  const row = flip ? 9 - visualRow : visualRow;
                  const col = flip ? 9 - visualCol : visualCol;
                  const piece = board[row][col];
                  const dark = (row + col) % 2 === 1;
                  const viewer = you ?? 'white';
                  const alliedHere = isAlliedTerritory(viewer, { row, col });
                  const territoryFront = viewer === 'white' ? row === 5 : row === 4;
                  const selected = piece && piece.id === selectedPiece;
                  const moveOpts = selectableMoves.filter((m) => m.to.row === row && m.to.col === col);
                  const moveHere = moveOpts.length > 0;
                  const specialHere = moveOpts.some((m) => Boolean(m.special));
                  const captureHere = moveOpts.some((m) => m.capture || Boolean(m.special));
                  const key = `${row},${col}`;
                  const barrierPick = barrierShiftHighlights.barriers.has(key);
                  const barrierFrom = barrierShiftHighlights.fromKey === key;
                  const barrierDest = barrierShiftHighlights.destinations.has(key);
                  const suckTarget = ultimateSuckHighlights.targets.has(key);
                  const suckFrom = ultimateSuckHighlights.fromKey === key;
                  const suckLanding = ultimateSuckHighlights.landings.has(key);
                  const suckCroc = ultimateSuckHighlights.crocKey === key;
                  const gamblerTarget = gamblerChoiceHighlights.has(key);
                  const toks = state.tokens.filter((t) => t.pos.row === row && t.pos.col === col);
                  const meta = piece ? pieceMeta(catalog, piece.defId) : null;
                  const pigOnSquare = state.pieces.find(
                    (p) =>
                      p.defId === 'pig' &&
                      p.coOccupantId &&
                      p.pos.row === row &&
                      p.pos.col === col,
                  );
                  const hasPigBuddy = Boolean(pigOnSquare) || Boolean(piece && pigHostIds.has(piece.id));
                  const kingInCheck =
                    Boolean(piece && piece.class === 'king' && state.check === piece.color);
                  const lastFrom =
                    !!state.lastMove &&
                    state.lastMove.from.row === row &&
                    state.lastMove.from.col === col;
                  const lastTo =
                    !!state.lastMove &&
                    state.lastMove.to.row === row &&
                    state.lastMove.to.col === col;
                  const lastPiece = !!(piece && state.lastMove?.pieceId === piece.id);
                  const sliding =
                    piece && moveAnim?.pieceId === piece.id
                      ? {
                          dx: -moveAnim.deltaCol * moveAnim.sqPx,
                          dy: -moveAnim.deltaRow * moveAnim.sqPx,
                          durationMs: moveAnim.durationMs,
                          phase: moveAnim.phase,
                        }
                      : null;
                  const vampRadius =
                    piece?.defId === 'vampire' ? vampireNightRadius(piece.charges ?? 0) : 0;
                  const inField = (f: { forme: string; row: number; col: number }, r: number, c: number) =>
                    f.forme === 'temporal'
                      ? inTemporalField(f, { row: r, col: c })
                      : Math.abs(f.row - r) <= FORME_RADIUS && Math.abs(f.col - c) <= FORME_RADIUS;
                  const fieldsHere = protoFields.filter((f) => inField(f, row, col));
                  // Neighbours in screen space: the board is rotated 180° for Black.
                  const step = flip ? 1 : -1;
                  const timeFrozen =
                    Boolean(piece && piece.class !== 'king') &&
                    fieldsHere.some((f) => f.forme === 'temporal' && f.id !== piece?.id);
                  const showingInfo =
                    (piece && piece.id === inspectedId) ||
                    (piece && !infoLocked && piece.id === hoveredId) ||
                    toks.some((t) => inspectedId === `token:${t.id}` || (!infoLocked && hoveredId === `token:${t.id}`));
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      className={[
                        'sq',
                        dark ? 'dark' : 'light',
                        alliedHere ? 'territory-allied' : 'territory-enemy',
                        territoryFront ? 'territory-front' : '',
                        selected ? 'selected' : '',
                        piece && piece.id === inspectedId ? 'inspected' : '',
                        piece && !infoLocked && piece.id === hoveredId ? 'info-hover' : '',
                        toks.some((t) => inspectedId === `token:${t.id}`) ? 'inspected' : '',
                        toks.some((t) => !infoLocked && hoveredId === `token:${t.id}`) ? 'info-hover' : '',
                        lastFrom ? 'last-from' : '',
                        lastTo || lastPiece ? 'last-to' : '',
                        hasPigBuddy ? 'pig-buddy-sq' : '',
                        kingInCheck ? 'king-in-check' : '',
                        moveHere ? 'move' : '',
                        moveHere && captureHere ? 'move-capture' : '',
                        moveHere && specialHere ? 'move-special' : '',
                        confirmKey === key || confirmKey === (piece ? `piece:${piece.id}` : '')
                          ? 'confirm-pending'
                          : '',
                        barrierPick || barrierFrom ? 'barrier-source' : '',
                        barrierDest ? 'barrier-target' : '',
                        suckCroc ? 'suck-croc' : '',
                        suckFrom ? 'suck-from' : suckTarget ? 'suck-target' : '',
                        suckLanding ? (piece ? 'suck-landing suck-capture' : 'suck-landing') : '',
                        gamblerTarget ? 'gambler-target' : '',
                        promptSquareOptions.has(key) ? (piece ? 'proto-option proto-option-capture' : 'proto-option') : '',
                        sliding ? 'sq-sliding' : '',
                        piece?.defId === 'reaper' &&
                          ((piece.charges ?? 0) > 0 || (piece.disabledTurns ?? 0) > 0)
                          ? 'sq-reaper-fx'
                          : '',
                        vampRadius > 0 ? 'sq-vampire-fx' : '',
                        timeFrozen ? 'sq-time-frozen' : '',
                        piece?.defId === 'gambler' ? `sq-gambler sq-gambler-${state.dayNight}` : '',
                      ].join(' ')}
                      onClick={() => onSquareClick(row, col)}
                      onMouseEnter={() => {
                        if (piece) setHoveredId(piece.id);
                        else if (toks[0]) setHoveredId(`token:${toks[0].id}`);
                      }}
                      onMouseLeave={() => {
                        setHoveredId((h) => {
                          if (piece && h === piece.id) return null;
                          if (toks[0] && h === `token:${toks[0].id}`) return null;
                          return h;
                        });
                      }}
                      title={
                        confirmKey === key || confirmKey === (piece ? `piece:${piece.id}` : '')
                          ? 'Click again to confirm'
                          : showingInfo && infoLocked
                            ? 'Info locked — click empty square or × to unlock'
                            : lastPiece
                              ? 'Last move'
                              : piece
                                ? 'Hover for info · click to lock'
                                : toks.length
                                  ? 'Hover for obstacle info · click to lock'
                                  : undefined
                      }
                    >
                      {visualCol === 0 && (
                        <span className="sq-coord sq-coord-rank" aria-hidden>
                          {10 - row}
                        </span>
                      )}
                      {visualRow === 9 && (
                        <span className="sq-coord sq-coord-file" aria-hidden>
                          {FILE_LETTERS[col]}
                        </span>
                      )}
                      {fieldsHere.map((f) => (
                        <span
                          key={`field-${f.id}`}
                          aria-hidden
                          className={[
                            'proto-field',
                            `is-${f.forme}`,
                            inField(f, row + step, col) ? '' : 'edge-t',
                            inField(f, row - step, col) ? '' : 'edge-b',
                            inField(f, row, col + step) ? '' : 'edge-l',
                            inField(f, row, col - step) ? '' : 'edge-r',
                          ].join(' ')}
                        />
                      ))}
                      {toks.map((t) => (
                        <span key={t.id} className={`token ${t.kind}`} title={getObstacleInfo(t.kind).name} />
                      ))}
                      {piece && (
                        <span
                          className={`piece ${lastPiece ? 'last-moved' : ''}${
                            sliding ? ` piece-move-slide${sliding.phase === 'to' ? ' is-sliding' : ' is-pre-slide'}` : ''
                          }${
                            piece.defId === 'reaper' && (piece.charges ?? 0) > 0
                              ? ` reaper-charged reaper-charged-${Math.min(piece.charges ?? 0, 5)}`
                              : ''
                          }${
                            piece.defId === 'reaper' && (piece.disabledTurns ?? 0) > 0 ? ' reaper-disabled' : ''
                          }${
                            vampRadius > 0 ? ` vampire-blood vampire-blood-${vampRadius}` : ''
                          }${
                            (piece.effects ?? []).some((e) => effectTone(e.kind) === 'debuff')
                              ? ' has-debuff'
                              : (piece.effects ?? []).length
                                ? ' has-buff'
                                : ''
                          }`}
                          style={
                            sliding ||
                            (piece.defId === 'reaper' && (piece.charges ?? 0) > 0) ||
                            (piece.defId === 'reaper' && (piece.disabledTurns ?? 0) > 0) ||
                            vampRadius > 0
                              ? ({
                                  ...(sliding
                                    ? {
                                        '--move-dx': `${sliding.dx}px`,
                                        '--move-dy': `${sliding.dy}px`,
                                        '--move-duration': `${sliding.durationMs}ms`,
                                      }
                                    : {}),
                                  ...(piece.defId === 'reaper' && (piece.charges ?? 0) > 0
                                    ? { '--reaper-c': Math.min(piece.charges ?? 0, 5) }
                                    : {}),
                                  ...(piece.defId === 'reaper' && (piece.disabledTurns ?? 0) > 0
                                    ? { '--reaper-disable-t': Math.min(piece.disabledTurns ?? 0, 12) }
                                    : {}),
                                  ...(vampRadius > 0 ? { '--vamp-r': vampRadius } : {}),
                                } as React.CSSProperties)
                              : undefined
                          }
                          onTransitionEnd={(e) => {
                            if (
                              sliding?.phase === 'to' &&
                              e.propertyName === 'transform' &&
                              moveAnim?.pieceId === piece.id
                            ) {
                              clearMoveAnim();
                            }
                          }}
                          title={[
                            meta?.name ?? piece.defId,
                            piece.defId === 'gambler'
                              ? state.dayNight === 'night'
                                ? 'Night: 1 diagonal'
                                : piece.gamblerStyleDefId
                                  ? `Moves as ${PIECES[piece.gamblerStyleDefId]?.name ?? piece.gamblerStyleDefId}`
                                  : 'Waiting on a roll'
                              : null,
                            piece.defId === 'reaper' && (piece.disabledTurns ?? 0) > 0
                              ? `Resting — ${piece.disabledTurns} turn${piece.disabledTurns === 1 ? '' : 's'} left`
                              : piece.defId === 'reaper' && (piece.charges ?? 0) > 0
                              ? `${piece.charges} charge${piece.charges === 1 ? '' : 's'}`
                              : null,
                            piece.defId === 'vampire' && vampRadius > 0
                              ? `Blood aura ${vampRadius}×${vampRadius}`
                              : null,
                            hasPigBuddy ? 'Pig Best Buddy sharing this tile' : null,
                            ...visibleBoardEffects(piece.effects ?? []).map(formatEffectTitle),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <PieceIcon
                            defId={piece.defId}
                            color={piece.color}
                            title={meta?.name ?? piece.defId}
                            forme={piece.proto?.form}
                          />
                          {piece.defId === 'prototype' && <PrototypeBoardBadges proto={piece.proto} />}
                          {piece.defId === 'gambler' && (
                            <span
                              className={`gambler-style ${state.dayNight === 'night' ? 'is-night' : 'is-day'}`}
                              title={
                                state.dayNight === 'night'
                                  ? 'Night movement: 1 square diagonally'
                                  : piece.gamblerStyleDefId
                                    ? `Day movement: ${PIECES[piece.gamblerStyleDefId]?.name ?? piece.gamblerStyleDefId}`
                                    : 'No style rolled yet'
                              }
                            >
                              {state.dayNight === 'night' ? (
                                <i className="gambler-night-mark" aria-hidden>
                                  ◆
                                </i>
                              ) : piece.gamblerStyleDefId ? (
                                <PieceIcon
                                  defId={piece.gamblerStyleDefId}
                                  color={piece.color}
                                  className="sm"
                                  title={PIECES[piece.gamblerStyleDefId]?.name}
                                />
                              ) : (
                                <i className="gambler-night-mark" aria-hidden>
                                  ?
                                </i>
                              )}
                            </span>
                          )}
                          {(piece.effects ?? []).some((e) => e.kind === 'webbed') && (
                            <img className="web-overlay" src="/overlays/web.svg" alt="" draggable={false} />
                          )}
                          {hasPigBuddy && (
                            <i className="pig-buddy" title="Pig is Best Buddy on this piece">
                              <PieceIcon defId="pig" color={piece.color} className="sm" title="Pig buddy" />
                            </i>
                          )}
                          {vampRadius > 0 && <VampireBloodAura radius={vampRadius} />}
                          {piece.defId === 'vampire' ? (
                            <VampireBloodChargeFx tokens={piece.charges ?? 0} />
                          ) : piece.defId === 'reaper' && (piece.disabledTurns ?? 0) > 0 ? (
                            <ReaperDisabledFx turns={piece.disabledTurns ?? 0} />
                          ) : piece.defId === 'reaper' && (piece.charges ?? 0) > 0 ? (
                            <ReaperChargeFx charges={piece.charges ?? 0} />
                          ) : piece.charges != null && piece.charges > 0 ? (
                            <i className="charge">{piece.charges}</i>
                          ) : null}
                          {piece.ritualTurns != null && piece.ritualTurns > 0 && (
                            <i className="ritual" title="Revive ritual">{piece.ritualTurns}</i>
                          )}
                          {(() => {
                            const statuses = visibleBoardEffects(piece.effects ?? []);
                            if ((piece.bloodlustTurnsRemaining ?? 0) > 0) {
                              statuses.unshift({
                                id: 'bloodlust',
                                kind: 'bloodlust',
                                turnsRemaining: piece.bloodlustTurnsRemaining,
                              });
                            }
                            if (!statuses.length) return null;
                            const shown = statuses.slice(0, 3);
                            const extra = statuses.length - shown.length;
                            return (
                              <span className="piece-status" aria-hidden>
                                {shown.map((e) => (
                                  <i
                                    key={e.id}
                                    className={`piece-status-badge tone-${effectTone(e.kind)}`}
                                    title={formatEffectTitle(e)}
                                  >
                                    {effectLabel(e.kind)}
                                    {e.turnsRemaining != null ? (
                                      <em className="piece-status-turns">{e.turnsRemaining}</em>
                                    ) : null}
                                  </i>
                                ))}
                                {extra > 0 ? (
                                  <i
                                    className="piece-status-badge tone-neutral"
                                    title={statuses.slice(3).map(formatEffectTitle).join(', ')}
                                  >
                                    +{extra}
                                  </i>
                                ) : null}
                              </span>
                            );
                          })()}
                        </span>
                      )}
                    </button>
                  );
                }),
              )}
            </div>

            </div>

            <div className="ability-bar" aria-live="polite">
              {selectedPiece && abilities.length > 0 && state.turn === you
                ? abilities.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`${a.passive ? '' : 'primary'} ${focusSpecial === a.id ? 'active' : ''} ${a.id.startsWith('forme_') ? 'forme-btn' : ''}`}
                      style={formeAbilityStyle(a.id, state.pieces.find((p) => p.id === selectedPiece)?.proto)}
                      disabled={!a.ready && !a.passive}
                      title={a.hint}
                      onClick={() => {
                        if (a.passive) {
                          if (a.id === 'bloodlust' || a.id === 'identity_theft' || a.id === 'forme_status') {
                            setFocusSpecial(null);
                            setStatus(a.hint ?? a.name);
                            return;
                          }
                          setFocusSpecial(a.id);
                          setSpellConfirm(null);
                          clearBoardConfirm();
                          setStatus(a.hint ?? `Select a target for ${a.name}, then Confirm`);
                          return;
                        }
                        send({ type: 'use_ability', pieceId: selectedPiece, abilityId: a.id });
                        setStatus(a.hint ?? a.name);
                        setFocusSpecial(null);
                      }}
                    >
                      <strong>{a.name}</strong>
                      {a.passive ? (focusSpecial === a.id ? ' · targeting' : '') : a.ready ? '' : ' (unavailable)'}
                    </button>
                  ))
                : null}
              {selectedPiece && focusSpecial && state.turn === you ? (
                <button type="button" onClick={cancelAbility}>
                  Cancel
                </button>
              ) : null}
            </div>

            <section className="hand-tray" aria-label="Your hand">
              <div className="hand-fan-row">
                <span className="hand-you-label">
                  {localMode ? (you === 'white' ? 'White' : 'Black') : 'You'}
                </span>
                <div
                  className={`hand hand-fan ${
                    state.phase === 'playing' && (!spellsUnlocked(state) || magicSilenced) ? 'hand-spell-locked' : ''
                  }`}
                >
                  {you &&
                    state.players[you].hand.map((c, i, arr) => {
                      const meta = cardMeta(catalog, c.defId);
                      const cardDef = CARD_REGISTRY[c.defId];
                      const nightLocked = state.phase === 'playing' && !spellsUnlocked(state);
                      const silenced = state.phase === 'playing' && magicSilenced;
                      const interruptCard = Boolean(cardDef?.playOnOpponentTurn);
                      const spellLocked =
                        nightLocked ||
                        silenced ||
                        (state.phase === 'playing' &&
                          !interruptCard &&
                          ((state.turn === you && state.turnPhase === 'move') ||
                            state.turn !== you));
                      const mid = (arr.length - 1) / 2;
                      return (
                        <button
                          key={c.instanceId}
                          type="button"
                          className={`card ${selectedCard === c.instanceId ? 'active' : ''} ${spellLocked ? 'card-dimmed' : ''} ${
                            spellLocked && readCardId === c.instanceId ? 'card-reading' : ''
                          }`}
                          aria-disabled={spellLocked}
                          aria-pressed={spellLocked ? readCardId === c.instanceId : undefined}
                          style={
                            {
                              '--fan-i': i,
                              '--fan-mid': mid,
                              '--fan-arc': Math.abs(i - mid),
                            } as React.CSSProperties
                          }
                          title={
                            nightLocked
                              ? 'Spell cards unlock at the first night · click to read'
                              : silenced
                                ? state.laws?.some((l) => l.id === 'magic_ban')
                                  ? 'Magic is banned by law until dawn · click to read'
                                  : 'Magic is silenced (Magic Be-gone) · click to read'
                                : spellLocked
                                ? state.turn !== you
                                  ? 'Cannot cast this on the opponent’s turn · click to read'
                                  : 'Spell phase skipped — cards available next turn · click to read'
                                : meta?.name ?? c.defId
                          }
                          onClick={() => {
                            if (spellLocked) {
                              setReadCardId((id) => (id === c.instanceId ? null : c.instanceId));
                              return;
                            }
                            setReadCardId(null);
                            if (selectedCard === c.instanceId) {
                              setCardDetailsCollapsed((v) => !v);
                              return;
                            }
                            setSelectedCard(c.instanceId);
                            setPendingTargets([]);
                            setSpellConfirm(null);
                            clearBoardConfirm();
                          }}
                        >
                          <img src={meta?.image ?? '/cards/Back_Of_Card.png'} alt={meta?.name ?? c.defId} />
                          <span>{meta?.name ?? c.defId}</span>
                        </button>
                      );
                    })}
                </div>
              </div>

              {state.phase === 'playing' && (
                <div className="row hand-actions">
                  {spellsUnlocked(state) &&
                    ((state.turn === you &&
                      state.turnPhase === 'spell' &&
                      state.players[you].spellsThisTurn < state.players[you].maxSpellsThisTurn) ||
                      (selectedCard && activeCardDef?.playOnOpponentTurn)) && (
                    <button
                      type="button"
                      className="primary"
                      onClick={castCard}
                      disabled={!selectedCard || !!spellConfirm}
                    >
                      Cast selected
                    </button>
                  )}
                  {spellsUnlocked(state) && state.turn === you && state.turnPhase === 'spell' && (
                    <button
                      type="button"
                      onClick={() => {
                        send({ type: 'skip_spell' });
                        setSelectedCard(null);
                        setPendingTargets([]);
                        setSpellConfirm(null);
                        clearBoardConfirm();
                        setStatus('Spell phase skipped — move a piece.');
                      }}
                    >
                      Skip spell
                    </button>
                  )}
                </div>
              )}

              {magicSilenced && (
                <p className="hint">
                  {state.laws?.some((l) => l.id === 'magic_ban')
                    ? 'Magic Prohibition: spells and magical abilities are banned for both players until dawn.'
                    : 'Magic Be-gone: your spells and magical abilities are silenced until the day/night cycle changes.'}
                </p>
              )}

              {activeCardDef?.id === 'swap' && pendingTargets.length === 1 && canCastSpells && (
                <div className="variant-grid">
                  {catalog?.pieces
                    .filter((p) => {
                      const target = state.pieces.find((x) => x.id === pendingTargets[0]);
                      return target && p.class === target.class && p.id !== target.defId && p.class !== 'king' && p.class !== 'queen';
                    })
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => offerSpellConfirm([pendingTargets[0], p.id])}
                      >
                        <PieceIcon defId={p.id} color={you ?? 'white'} className="sm" />
                        {p.name}
                      </button>
                    ))}
                </div>
              )}

              {activeCardDef?.id === 'pawn_summon' &&
                selectedCard &&
                canCastSpells &&
                !spellConfirm &&
                pendingTargets.length % 2 === 0 && (
                  <div className="variant-grid">
                    <p className="hint">
                      Choose pawn variant{' '}
                      {Math.floor(pendingTargets.length / 2) + 1} of{' '}
                      {Math.min(
                        2,
                        you ? state.players[you].graveyard.filter((g) => g.class === 'pawn').length : 0,
                      )}
                    </p>
                    {catalog?.pieces
                      .filter((p) => p.class === 'pawn')
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setPendingTargets([...pendingTargets, p.id]);
                            clearBoardConfirm();
                            setSpellConfirm(null);
                            setStatus(`Pick an empty allied square for ${p.name}`);
                          }}
                        >
                          <PieceIcon defId={p.id} color={you ?? 'white'} className="sm" />
                          {p.name}
                        </button>
                      ))}
                  </div>
                )}

              {activeCardDef?.targeting === 'graveyard' &&
                selectedCard &&
                canCastSpells &&
                !spellConfirm &&
                pendingTargets.length === 0 &&
                you && (
                  <div className="variant-grid">
                    <p className="hint">Pick a fallen piece to revive</p>
                    {state.players[you].graveyard.map((g, i) => (
                      <button
                        key={`${g.defId}-${i}`}
                        type="button"
                        onClick={() => {
                          setPendingTargets([i]);
                          clearBoardConfirm();
                          setSpellConfirm(null);
                          setStatus(
                            `Revive ${pieceMeta(catalog, g.defId)?.name ?? g.defId}: pick an empty spawn square`,
                          );
                        }}
                      >
                        <PieceIcon defId={g.defId} color={you} className="sm" />
                        {pieceMeta(catalog, g.defId)?.name ?? g.defId}
                      </button>
                    ))}
                  </div>
                )}

              {shownCardDef && !wideLayout && (readCardDef || !cardDetailsCollapsed) && (
                <div className={`card-details is-sheet${readCardDef ? ' is-reading' : ''}`}>
                  <button
                    type="button"
                    className="card-details-close"
                    aria-label="Close card"
                    onClick={() => (readCardDef ? setReadCardId(null) : setCardDetailsCollapsed(true))}
                  >
                    ×
                  </button>
                  <p className="dock-card-kicker">
                    {readCardDef ? 'Reading · can’t cast right now' : 'Selected card · tap the card again to hide'}
                  </p>
                  <h3>{shownCardDef.name}</h3>
                  <ul>
                    {shownCardDef.description.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="hint hand-flow-hint">
                Flow: spell (optional) → move one piece. Putting the opponent in check ends your turn immediately.
              </p>
            </section>
          </main>

          <aside className="play-dock" aria-live="polite">
            <div className="play-dock-box">
              <p className="play-dock-label">Info</p>
              {shownCardDef && wideLayout && (
                <div className={`card-details dock-card-details${readCardDef ? ' is-reading' : ''}`}>
                  {readCardDef && (
                    <button
                      type="button"
                      className="card-details-close"
                      aria-label="Close card"
                      onClick={() => setReadCardId(null)}
                    >
                      ×
                    </button>
                  )}
                  <img
                    src={cardMeta(catalog, shownCardDef.id)?.image ?? '/cards/Back_Of_Card.png'}
                    alt=""
                  />
                  <div>
                    <p className="dock-card-kicker">{readCardDef ? 'Reading · can’t cast right now' : 'Selected card'}</p>
                    <h3>{shownCardDef.name}</h3>
                    <ul>
                      {shownCardDef.description.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {you &&
                state.turn === you &&
                state.phase === 'playing' &&
                state.players[you].army.pawn === 'enchanted_pawn' &&
                state.tokens.some((t) => t.kind === 'barrier' && t.owner === you) &&
                !state.pendingPrompt && (
                  <p className="hint barrier-hint">
                    To relocate a barrier, select a Crystalite and press <strong>Barrier Shift</strong>. Clicking a
                    barrier while the pawn is selected will walk onto it (Barrier Phase).
                  </p>
                )}
              {!inspectedPiece && !inspectedToken && (
                <p className="play-dock-idle">
                  {knowledgeEnabled
                    ? 'Tap a piece or obstacle for details. Game prompts appear over the board.'
                    : 'Game prompts and confirmations appear under the board.'}
                </p>
              )}
              {knowledgeEnabled && inspectedPiece ? (
                <PieceInfoTile
                  defId={inspectedPiece.defId}
                  color={inspectedPiece.color}
                  locked={infoLocked}
                  docked
                  live={{
                    charges: inspectedPiece.charges,
                    reaperKills: inspectedPiece.reaperKills,
                    disabledTurns: inspectedPiece.disabledTurns,
                    gamblerStyleDefId: inspectedPiece.gamblerStyleDefId,
                    ritualTurns: inspectedPiece.ritualTurns,
                    gadgetUsed: inspectedPiece.gadgetUsed,
                    gigaStompUsed: inspectedPiece.gigaStompUsed,
                    abilityCooldown: inspectedPiece.abilityCooldown,
                    magicBegoneUsed: inspectedPiece.magicBegoneUsed,
                    timekeeperCycleUsed: inspectedPiece.timekeeperCycleUsed,
                    bloodlustTurnsRemaining: inspectedPiece.bloodlustTurnsRemaining,
                    identityLootDefId: inspectedPiece.identityLootDefId,
                    copiedMoveDefId: inspectedPiece.copiedMoveDefId,
                    coOccupantId: inspectedPiece.coOccupantId,
                    hasPigBuddy: pigHostIds.has(inspectedPiece.id),
                    proto: inspectedPiece.proto,
                    formeSwapCooldown: state.players[inspectedPiece.color].formeSwapCooldown,
                    effects: inspectedPiece.effects,
                  }}
                  onClose={() => {
                    setInspectedId(null);
                    setHoveredId(null);
                  }}
                />
              ) : knowledgeEnabled && inspectedToken ? (
                <ObstacleInfoTile
                  kind={inspectedToken.kind}
                  owner={inspectedToken.owner}
                  turnsRemaining={inspectedToken.turnsRemaining}
                  locked={infoLocked}
                  onClose={() => {
                    setInspectedId(null);
                    setHoveredId(null);
                  }}
                />
              ) : null}
            </div>
          </aside>
        </div>
      )}

      </div>
      {showBoardKnowledge && !promptDocked && (
        <KnowledgeToggle
          enabled={knowledgeEnabled}
          onToggle={() => setKnowledgeEnabled((v) => !v)}
        />
      )}
      {!promptDocked && audioFxStack}
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
      {showBoardKnowledge && (
        <>
          {mobileSheet && (
            <button
              type="button"
              className="mobile-sheet-backdrop"
              aria-label="Close panel"
              onClick={() => setMobileSheet(null)}
            />
          )}
          {mobileSheet === 'more' && (
            <section className="mobile-sheet mobile-more" aria-label="Game menu">
              <div className="mobile-sheet-head">
                <p>Menu</p>
                <button type="button" onClick={() => setMobileSheet(null)} aria-label="Close menu">
                  ×
                </button>
              </div>
              <p className="mobile-more-meta">
                {localMode ? 'Local play' : `Room ${roomCode}`}
                {you ? ` · You are ${you}` : ''}
                {` · ${state.dayNight === 'day' ? 'Day' : 'Night'} · cycle ${state.cycleCount}`}
              </p>
              <div className="mobile-more-controls">
                <AudioToggles
                  musicEnabled={musicEnabled}
                  sfxEnabled={sfxEnabled}
                  musicVolume={musicVolume}
                  onToggleMusic={() => setMusicEnabled((v: boolean) => !v)}
                  onToggleSfx={() => setSfxEnabled((v: boolean) => !v)}
                  onMusicVolume={(v) => setMusicVolume(v)}
                />
                <FxToggle enabled={fxEnabled} onToggle={() => setFxEnabled((v) => !v)} />
                <button
                  type="button"
                  className="audio-toggle reset-fx-sfx"
                  data-audio="off"
                  title="Stop stuck tracks and restore FX and SFX"
                  onClick={resetFxSfx}
                >
                  <span className="fx-toggle-glyph" aria-hidden>
                    ↺
                  </span>
                  <span className="fx-toggle-label">Reset FX & SFX</span>
                </button>
                <KnowledgeToggle
                  enabled={knowledgeEnabled}
                  onToggle={() => setKnowledgeEnabled((v) => !v)}
                />
              </div>
              <div className="mobile-more-actions">
                <button
                  type="button"
                  onClick={() => {
                    setMobileSheet(null);
                    setRulesOpen(true);
                  }}
                >
                  Rules
                </button>
                <button type="button" className="danger" onClick={exitToHome}>
                  {localMode ? 'Exit local' : 'Leave game'}
                </button>
              </div>
            </section>
          )}
          <nav className="mobile-nav" aria-label="Game panels">
            <button
              type="button"
              className={mobileSheet === 'table' ? 'active' : ''}
              onClick={() => setMobileSheet((cur) => (cur === 'table' ? null : 'table'))}
            >
              Fallen
            </button>
            <button
              type="button"
              className={mobileSheet === 'info' ? 'active' : ''}
              onClick={() => setMobileSheet((cur) => (cur === 'info' ? null : 'info'))}
            >
              Info{inspectedId ? ' ●' : ''}
            </button>
            <button
              type="button"
              className={mobileSheet === 'more' ? 'active' : ''}
              onClick={() => setMobileSheet((cur) => (cur === 'more' ? null : 'more'))}
            >
              Menu
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

function formatNamedLine(line: string) {
  const chargeNamed = line.match(/^(\d\+:\s*.+?)\s+[—–-]\s+(.+)$/);
  if (chargeNamed) {
    return (
      <>
        <strong>{chargeNamed[1]}</strong> — {chargeNamed[2]}
      </>
    );
  }
  const colon = line.indexOf(': ');
  if (colon > 0) {
    return (
      <>
        <strong>{line.slice(0, colon)}</strong>
        {line.slice(colon)}
      </>
    );
  }
  return line;
}

function ResultCeremony({
  kind,
  winnerName,
  reason,
  onContinue,
}: {
  kind: 'victory' | 'loss';
  winnerName: string;
  reason: string;
  onContinue: () => void;
}) {
  const victory = kind === 'victory';
  const screen = (
    <div
      className={`result-ceremony is-${kind}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-title"
    >
      <div className="result-rays" aria-hidden />
      <div className="result-particles" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <div className="result-card">
        <p className="result-kicker">{victory ? 'The board is yours' : 'The king has fallen'}</p>
        <h2 id="result-title" className="result-title">
          {victory ? 'Victory' : 'Defeat'}
        </h2>
        <p className="result-sub">
          {winnerName} wins{reason ? ` · ${reason}` : ''}
        </p>
        <button type="button" className="result-continue" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
  return createPortal(screen, document.body);
}

function MatchCeremony({
  ceremony,
  onDone,
}: {
  ceremony:
    | { kind: 'lobby'; code: string }
    | { kind: 'vs'; white: string; black: string }
    | { kind: 'order'; whiteFirst: boolean; bans: boolean };
  onDone: () => void;
}) {
  useEffect(() => {
    const ms = ceremony.kind === 'vs' ? 2500 : ceremony.kind === 'order' ? 2300 : 2100;
    const timer = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(timer);
  }, [ceremony.kind]);

  return (
    <div className={`match-ceremony is-${ceremony.kind}`} role="status" aria-live="polite">
      <div className="match-ceremony-card">
        {ceremony.kind === 'lobby' && (
          <>
            <p className="match-ceremony-kicker">Lobby created</p>
            <p className="match-ceremony-code">{ceremony.code}</p>
            <p className="match-ceremony-sub">Waiting for an opponent</p>
          </>
        )}
        {ceremony.kind === 'vs' && (
          <div className="match-vs">
            <span className="match-vs-name white">{ceremony.white}</span>
            <span className="match-vs-mark">VS</span>
            <span className="match-vs-name black">{ceremony.black}</span>
          </div>
        )}
        {ceremony.kind === 'order' && (
          <>
            <p className="match-ceremony-kicker">Draft order</p>
            <p className={`match-order-title ${ceremony.whiteFirst ? 'white' : 'black'}`}>
              {ceremony.whiteFirst ? 'White' : 'Black'} {ceremony.bans ? 'bans & picks' : 'picks'} first
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function TurnStrip({
  state,
  you,
  localMode = false,
  clockOffsetMs = 0,
}: {
  state: GameState;
  you: Color | null;
  localMode?: boolean;
  clockOffsetMs?: number;
}) {
  const showClock = Boolean(state.turnTimer && state.phase === 'playing');
  const { mode, title, detail } = turnStripContent(state, you, localMode);
  const youInCheck = Boolean(you && state.phase === 'playing' && state.check === you);
  const check =
    state.phase === 'playing' && state.check
      ? state.check === you
        ? 'You are in check!'
        : `${state.check} in check`
      : '';
  const yoursDetail = [detail, check].filter(Boolean).join(' · ');

  return (
    <div
      className={`turn-strip is-${mode}${youInCheck ? ' is-check' : ''}${showClock ? ' has-clock' : ''}`}
      role="status"
      aria-live="polite"
    >
      {showClock && state.turnTimer && (
        <TurnClock
          timer={state.turnTimer}
          turn={state.turn}
          turnCount={state.turnCount ?? 0}
          you={you}
          localMode={localMode}
          offsetMs={clockOffsetMs}
        />
      )}
      <div
        className={`turn-strip-layer ${mode === 'yours' ? 'is-on' : ''}`}
        aria-hidden={mode !== 'yours'}
      >
        <span className="turn-strip-title">{mode === 'yours' ? title : 'Your turn'}</span>
        <span className="turn-strip-detail">{mode === 'yours' ? yoursDetail || '\u00a0' : '\u00a0'}</span>
        <span className={`turn-strip-cycle chip-${state.dayNight}`}>
          {state.dayNight === 'day' ? 'Day' : 'Night'}
        </span>
      </div>
      <div
        className={`turn-strip-layer ${mode === 'waiting' ? 'is-on' : ''}`}
        aria-hidden={mode !== 'waiting'}
      >
        <span className="turn-strip-title">
          <span className="waiting-opponent-dot" aria-hidden />
          Waiting for opponent
        </span>
        <span className="turn-strip-detail">{mode === 'waiting' ? detail || '\u00a0' : '\u00a0'}</span>
      </div>
      <div
        className={`turn-strip-layer ${mode === 'ended' ? 'is-on' : ''}`}
        aria-hidden={mode !== 'ended'}
      >
        <span className="turn-strip-title">{mode === 'ended' ? title : 'Game over'}</span>
        <span className="turn-strip-detail">{mode === 'ended' ? detail || '\u00a0' : '\u00a0'}</span>
      </div>
    </div>
  );
}

function VampireBloodAura({ radius }: { radius: number }) {
  const shown = Math.max(0, Math.min(5, radius));
  if (shown <= 0) return null;
  return (
    <span className="vampire-blood-fx" aria-hidden>
      <i className="vampire-aura" />
      <i className="vampire-aura-ring" />
    </span>
  );
}

function VampireBloodChargeFx({ tokens }: { tokens: number }) {
  const n = Math.max(0, tokens);
  const fillId = `${useId().replace(/:/g, '')}vampDrop`;
  return (
    <span
      className={`vampire-charge-fx${n <= 0 ? ' is-empty' : ''}${n >= 10 ? ' is-wide' : ''}`}
      title={`${n} Blood Token${n === 1 ? '' : 's'}`}
    >
      <svg className="vampire-drop" viewBox="0 0 16 18" aria-hidden>
        <defs>
          <linearGradient id={fillId} x1="8" y1="1" x2="8" y2="17" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ff4d5a" />
            <stop offset="55%" stopColor="#c01022" />
            <stop offset="100%" stopColor="#6a0410" />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${fillId})`}
          stroke="#4a0008"
          strokeWidth="0.7"
          d="M8 1.1C8 1.1 2.2 8.2 2.2 12.1c0 3.1 2.5 5.2 5.8 5.2s5.8-2.1 5.8-5.2C13.8 8.2 8 1.1 8 1.1z"
        />
        <path
          fill="#ffb3b8"
          opacity="0.45"
          d="M5.4 9.2c.4-1.4 1.3-2.8 2.2-4.2-.2 1.6-.2 3.2.3 4.6.4 1.1 0 2.2-.9 2.4-.9.2-1.7-.8-1.6-2.8z"
        />
      </svg>
      <b className="vampire-charge-n">{n}</b>
    </span>
  );
}

function ReaperDisabledFx({ turns }: { turns: number }) {
  const shown = Math.max(1, Math.min(12, turns));
  return (
    <span
      className="reaper-disabled-fx"
      aria-label={`Disabled for ${shown} turn${shown === 1 ? '' : 's'}`}
      title={`Resting — ${shown} turn${shown === 1 ? '' : 's'} remaining`}
    >
      <i className="reaper-disabled-aura" />
      <svg className="reaper-disabled-hourglass" viewBox="0 0 20 22" aria-hidden>
        <path
          fill="currentColor"
          d="M4.2 1.5h11.6c.4 0 .7.3.7.7v1.4c0 .5-.2 1-.6 1.3L11 7.2v1.1l4.9 3.7c.4.3.6.8.6 1.3v1.4c0 .4-.3.7-.7.7H4.2c-.4 0-.7-.3-.7-.7v-1.4c0-.5.2-1 .6-1.3L9 8.3V7.2L4.1 3.5c-.4-.3-.6-.8-.6-1.3V2.2c0-.4.3-.7.7-.7z"
        />
        <path fill="rgba(12,8,20,0.55)" d="M8.2 5.8h3.6L10 7.8 8.2 5.8zm0 10.4h3.6L10 14.2l-1.8 2z" />
      </svg>
      <b className="reaper-disabled-n">{shown}</b>
    </span>
  );
}

function ReaperChargeFx({ charges }: { charges: number }) {
  const shown = Math.max(0, Math.min(5, charges));
  if (shown <= 0) return null;
  return (
    <span className="reaper-charge-fx" aria-hidden title={`${charges} charge${charges === 1 ? '' : 's'}`}>
      <i className="reaper-aura" />
      {Array.from({ length: shown }, (_, i) => (
        <svg
          key={i}
          className="reaper-skull"
          viewBox="0 0 16 18"
          style={{ '--skull-i': i, '--skull-n': shown } as React.CSSProperties}
        >
          <path
            fill="currentColor"
            d="M8 1.1c-3.7 0-6.6 2.8-6.6 6.2 0 2.1 1.1 3.9 2.8 5v2.2c0 .6.5 1.1 1.1 1.1h.7v1.3c0 .5.4.9.9.9h2.2c.5 0 .9-.4.9-.9v-1.3h.7c.6 0 1.1-.5 1.1-1.1V12.3c1.7-1.1 2.8-2.9 2.8-5C14.6 3.9 11.7 1.1 8 1.1z"
          />
          <ellipse cx="5.35" cy="7.1" rx="1.55" ry="1.9" fill="#1a0818" />
          <ellipse cx="10.65" cy="7.1" rx="1.55" ry="1.9" fill="#1a0818" />
          <path fill="#1a0818" d="M8 8.6 6.7 11.4 8 10.6l1.3.8z" />
          <rect x="5.15" y="13.35" width="1.15" height="2.15" rx="0.35" fill="#1a0818" />
          <rect x="7.42" y="13.35" width="1.15" height="2.15" rx="0.35" fill="#1a0818" />
          <rect x="9.7" y="13.35" width="1.15" height="2.15" rx="0.35" fill="#1a0818" />
        </svg>
      ))}
    </span>
  );
}

function DraftArmyRoster({
  state,
  catalog,
  pickFlash,
  banFlash,
}: {
  state: GameState;
  catalog: Catalog | null;
  pickFlash: { color: Color; defId: string; pieceClass: string } | null;
  banFlash: { color: Color; defId: string } | null;
}) {
  return (
    <div className="draft-armies">
      {(['white', 'black'] as Color[]).map((color) => (
        <div key={color} className={`draft-army-col ${color}`}>
          <h3 className="draft-army-title">
            {state.players[color].name}{' '}
            <span className="draft-army-color">({color})</span>
          </h3>
          <div className="draft-army-slots">
            {DRAFT_ORDER.map((cls) => {
              const defId = state.players[color].army[cls];
              const meta = defId ? pieceMeta(catalog, defId) : null;
              const flashing =
                pickFlash?.color === color && pickFlash.pieceClass === cls;
              return (
                <div
                  key={cls}
                  className={[
                    'draft-army-slot',
                    defId ? 'filled' : 'empty',
                    flashing ? 'draft-pick-flash' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={meta?.name ?? DRAFT_CLASS_LABELS[cls]}
                >
                  <span className="draft-slot-label">{DRAFT_CLASS_LABELS[cls] ?? cls}</span>
                  {defId ? (
                    <PieceIcon defId={defId} color={color} className="draft-slot-piece" title={meta?.name} />
                  ) : (
                    <span className="draft-slot-empty" aria-hidden>
                      ◇
                    </span>
                  )}
                  {defId && meta && <span className="draft-slot-name">{meta.name}</span>}
                </div>
              );
            })}
          </div>
          {state.rules?.banPhase !== false && (
          <div className="draft-bans" aria-label={`${state.players[color].name} bans`}>
            <span className="draft-bans-label">Bans</span>
            {Array.from({ length: BANS_PER_COLOR }, (_, i) => {
              const banId = state.draft?.bans?.[color]?.[i];
              const meta = banId ? pieceMeta(catalog, banId) : null;
              const flashing = banId && banFlash?.color === color && banFlash.defId === banId;
              return (
                <span
                  key={i}
                  className={['draft-ban-slot', banId ? 'filled' : 'empty', flashing ? 'draft-ban-flash' : '']
                    .filter(Boolean)
                    .join(' ')}
                  title={meta ? `${meta.name} (banned)` : 'Ban not used yet'}
                >
                  {banId ? (
                    <span className="banned-icon">
                      <PieceIcon defId={banId} color={color} title={meta?.name} />
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
              );
            })}
          </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DraftPieceInfoPanel({ defId, color }: { defId: string; color: Color }) {
  return <PieceInfoBody defId={defId} color={color} />;
}

function PieceInfoBody({
  defId,
  color,
  live,
}: {
  defId: string;
  color: Color;
  live?: {
    charges?: number;
    reaperKills?: number;
    disabledTurns?: number;
    gamblerStyleDefId?: string;
    ritualTurns?: number;
    gadgetUsed?: boolean;
    gigaStompUsed?: boolean;
    abilityCooldown?: number;
    magicBegoneUsed?: number;
    timekeeperCycleUsed?: boolean;
    bloodlustTurnsRemaining?: number;
    identityLootDefId?: string;
    copiedMoveDefId?: string;
    coOccupantId?: string;
    hasPigBuddy?: boolean;
    proto?: Piece['proto'];
    formeSwapCooldown?: number;
    effects?: Array<{ id?: string; kind: string; turnsRemaining?: number; data?: Record<string, unknown> }>;
  };
}) {
  const info = getPieceInfo(defId);
  const [previewColor, setPreviewColor] = useState<Color>(color);

  useEffect(() => {
    setPreviewColor(color);
  }, [color, defId]);

  return (
    <>
      <div className="piece-info-head">
        <div className="piece-info-icon-wrap">
          <PieceIcon
            defId={defId}
            color={previewColor}
            title={info.name}
            forme={live?.proto?.form}
          />
        </div>
        <div>
          <p className="piece-info-class">{info.classLabel}</p>
          <h2>{info.name}</h2>
          <div className="piece-info-color-toggle" role="group" aria-label="Preview piece color">
            <button
              type="button"
              className={previewColor === 'white' ? 'active' : ''}
              onClick={() => setPreviewColor('white')}
            >
              White
            </button>
            <button
              type="button"
              className={previewColor === 'black' ? 'active' : ''}
              onClick={() => setPreviewColor('black')}
            >
              Black
            </button>
          </div>
        </div>
      </div>

      <section>
        <h3>Movement</h3>
        <ul>
          {info.movement.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Abilities</h3>
        {info.abilities.length > 0 ? (
          <ul>
            {info.abilities.map((line) => (
              <li key={line}>{formatNamedLine(line)}</li>
            ))}
          </ul>
        ) : (
          <p>None.</p>
        )}
      </section>

      <section>
        <h3>Notes</h3>
        {info.notes && info.notes.length > 0 ? (
          <ul>
            {info.notes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p>None.</p>
        )}
      </section>

      {live && (
        <div className="piece-info-live">
          {live.charges != null && defId !== 'vampire' && <span>Charges: {live.charges}</span>}
          {defId === 'vampire' && (
            <span>
              Blood Tokens: {live.charges ?? 0}
              {` · Night ${vampireNightRadius(live.charges ?? 0)}×${vampireNightRadius(live.charges ?? 0)}`}
            </span>
          )}
          {defId === 'gambler' && (
            <span>
              Day style:{' '}
              {live.gamblerStyleDefId
                ? PIECES[live.gamblerStyleDefId]?.name ?? live.gamblerStyleDefId
                : 'unrolled'}
            </span>
          )}
          {defId === 'reaper' && live.disabledTurns != null && live.disabledTurns > 0 && (
            <span className="live-effect tone-debuff reaper-rest-timer">
              Resting: {live.disabledTurns} turn{live.disabledTurns === 1 ? '' : 's'} remaining
            </span>
          )}
          {defId === 'reaper' && live.charges != null && live.charges > 0 && (live.disabledTurns ?? 0) <= 0 && (
            <span>
              Harvest: {live.reaperKills ?? 0}/{reaperCapturesUntilRest(live.charges)} captures until rest
            </span>
          )}
          {live.ritualTurns != null && live.ritualTurns > 0 && <span>Ritual: {live.ritualTurns}</span>}
          {live.gadgetUsed && <span>Gadget used</span>}
          {live.gigaStompUsed && <span>Giga Stomp used</span>}
          {live.magicBegoneUsed != null && live.magicBegoneUsed > 0 && (
            <span>Magic Be-gone: {live.magicBegoneUsed}/2 used</span>
          )}
          {live.abilityCooldown != null && live.abilityCooldown > 0 && (
            <span>Cooldown: {live.abilityCooldown}</span>
          )}
          {live.bloodlustTurnsRemaining != null && live.bloodlustTurnsRemaining > 0 && (
            <span>Bloodlust ({live.bloodlustTurnsRemaining})</span>
          )}
          {live.timekeeperCycleUsed && <span>Temporal Shift used</span>}
          {live.copiedMoveDefId && <span>Moves as {live.copiedMoveDefId}</span>}
          {!live.copiedMoveDefId && live.identityLootDefId && (
            <span>Stored identity: {live.identityLootDefId}</span>
          )}
          {live.coOccupantId && <span className="live-effect tone-buff">Pig Best Buddy</span>}
          {live.hasPigBuddy && <span className="live-effect tone-buff">Pig riding</span>}
          {live.effects?.map((e) => (
            <span key={e.id} className={`live-effect tone-${effectTone(e.kind)}`}>
              {formatEffectTitle(e)}
            </span>
          ))}
        </div>
      )}
      {live && defId === 'prototype' && <PrototypeInspector proto={live.proto} swapCooldown={live.formeSwapCooldown} />}
    </>
  );
}

function PieceInfoTile({
  defId,
  color,
  live,
  locked = false,
  docked = false,
  onClose,
}: {
  defId: string;
  color: Color;
  live?: {
    charges?: number;
    reaperKills?: number;
    disabledTurns?: number;
    gamblerStyleDefId?: string;
    ritualTurns?: number;
    gadgetUsed?: boolean;
    gigaStompUsed?: boolean;
    abilityCooldown?: number;
    magicBegoneUsed?: number;
    timekeeperCycleUsed?: boolean;
    bloodlustTurnsRemaining?: number;
    identityLootDefId?: string;
    copiedMoveDefId?: string;
    coOccupantId?: string;
    hasPigBuddy?: boolean;
    proto?: Piece['proto'];
    formeSwapCooldown?: number;
    effects?: Array<{ id?: string; kind: string; turnsRemaining?: number; data?: Record<string, unknown> }>;
  };
  locked?: boolean;
  docked?: boolean;
  onClose: () => void;
}) {
  return (
    <aside
      className={`piece-info-tile ${color} ${locked ? 'is-locked' : 'is-hover'}${docked ? ' is-docked' : ''}`}
      aria-live="polite"
    >
      <button type="button" className="piece-info-close" onClick={onClose} aria-label="Close piece info">
        ×
      </button>
      {locked ? (
        <p className="piece-info-lock-badge">Locked</p>
      ) : (
        <p className="piece-info-lock-badge hover">Hover · click piece to lock</p>
      )}
      <PieceInfoBody defId={defId} color={color} live={live} />
    </aside>
  );
}

function ObstacleInfoTile({
  kind,
  owner,
  turnsRemaining,
  locked = false,
  onClose,
}: {
  kind: string;
  owner: Color;
  turnsRemaining?: number;
  locked?: boolean;
  onClose: () => void;
}) {
  const info = getObstacleInfo(kind);
  return (
    <aside
      className={`piece-info-tile ${owner} ${locked ? 'is-locked' : 'is-hover'} is-docked`}
      aria-live="polite"
    >
      <button type="button" className="piece-info-close" onClick={onClose} aria-label="Close obstacle info">
        ×
      </button>
      {locked ? (
        <p className="piece-info-lock-badge">Locked</p>
      ) : (
        <p className="piece-info-lock-badge hover">Hover · click obstacle to lock</p>
      )}
      <div className="piece-info-head">
        <div className="piece-info-icon-wrap">
          <span className={`token-swatch token ${kind}`} aria-hidden />
        </div>
        <div>
          <p className="piece-info-class">{info.category}</p>
          <h2>{info.name}</h2>
          <p className="obstacle-owner">{owner === 'white' ? 'White' : 'Black'} token</p>
        </div>
      </div>
      <section>
        <h3>How it works</h3>
        <ul>
          {info.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      {info.notes && info.notes.length > 0 && (
        <section>
          <h3>Notes</h3>
          <ul>
            {info.notes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {turnsRemaining != null && turnsRemaining > 0 && (
        <div className="piece-info-live">
          <span>{turnsRemaining} turns left</span>
        </div>
      )}
    </aside>
  );
}

function OverlayClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="msg-dismiss overlay-dismiss" aria-label="Look at the board" onClick={onClose}>
      ×
    </button>
  );
}

function OpeningMulliganOverlay({
  prompt,
  you,
  state,
  catalog,
  onKeep,
  onRedraw,
  onClose,
}: {
  prompt: NonNullable<GameState['pendingPrompt']>;
  you: Color;
  state: GameState;
  catalog: Catalog | null;
  onKeep: () => void;
  onRedraw: (instanceId: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const chooser = prompt.color;
  const canRedraw = chooser === you && !state.players[you].openingRedrawUsed;

  if (you !== chooser) {
    return (
      <div className="hand-limit-overlay opening-mulligan-overlay" role="dialog" aria-modal="true" aria-labelledby="opening-mulligan-title">
        <div className="hand-limit-panel opening-mulligan-panel">
          <OverlayClose onClose={onClose} />
          <p className="hand-limit-eyebrow">Opening hand</p>
          <h2 id="opening-mulligan-title">Waiting for opponent</h2>
          <p className="opening-mulligan-lead">
            They are reviewing their opening spell cards. The game will continue once they keep their hand.
          </p>
        </div>
      </div>
    );
  }

  const pickedMeta = picked ? cardMeta(catalog, state.players[you].hand.find((c) => c.instanceId === picked)!.defId) : null;

  return (
    <div className="hand-limit-overlay opening-mulligan-overlay" role="dialog" aria-modal="true" aria-labelledby="opening-mulligan-title">
      <div className="hand-limit-panel opening-mulligan-panel">
        <OverlayClose onClose={onClose} />
        <header className="opening-mulligan-header">
          <p className="hand-limit-eyebrow">Opening hand</p>
          <h2 id="opening-mulligan-title">Review your cards</h2>
          <p className="opening-mulligan-lead">
            Keep your hand, or select one card to redraw once.
          </p>
        </header>

        <div className="opening-mulligan-cards">
          {state.players[you].hand.map((c) => {
            const meta = cardMeta(catalog, c.defId);
            const selected = picked === c.instanceId;
            return (
              <button
                key={c.instanceId}
                type="button"
                className={`opening-mulligan-card ${selected ? 'selected' : ''}`}
                onClick={() => setPicked(selected ? null : c.instanceId)}
                aria-pressed={selected}
              >
                <img src={meta?.image ?? '/cards/Back_Of_Card.png'} alt={meta?.name ?? c.defId} />
                <span className="opening-card-name">{meta?.name ?? c.defId}</span>
              </button>
            );
          })}
        </div>

        {picked && pickedMeta ? (
          <div className="opening-mulligan-detail">
            <h3>{pickedMeta.name}</h3>
            <ul>
              {pickedMeta.description.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="opening-mulligan-hint">Tap a card to preview it, or keep your hand as-is.</p>
        )}

        <div className="hand-limit-actions opening-mulligan-actions">
          <button type="button" className="primary" onClick={onKeep}>
            Keep hand
          </button>
          {canRedraw && (
            <button type="button" disabled={!picked} onClick={() => picked && onRedraw(picked)}>
              Redraw selected
            </button>
          )}
        </div>

        <p className="opening-mulligan-footnote">
          Opening hands cannot include duplicate spells.
        </p>
      </div>
    </div>
  );
}

function DiscardToDrawOverlay({
  prompt,
  you,
  state,
  catalog,
  onDiscard,
  onClose,
}: {
  prompt: NonNullable<GameState['pendingPrompt']>;
  you: Color;
  state: GameState;
  catalog: Catalog | null;
  onDiscard: (instanceId: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const chooser = prompt.color;
  if (you !== chooser) {
    return (
      <div className="hand-limit-overlay" role="dialog" aria-modal="true" aria-labelledby="hand-limit-title">
        <div className="hand-limit-panel">
          <OverlayClose onClose={onClose} />
          <p className="hand-limit-eyebrow">Hand full</p>
          <h2 id="hand-limit-title">Waiting for opponent</h2>
          <p className="hand-limit-copy">
            They drew a card with a full hand and must discard before the game continues.
          </p>
        </div>
      </div>
    );
  }

  const drawnId = prompt.drawnInstanceId;
  const drawn = state.players[you].hand.find((c) => c.instanceId === drawnId);
  const drawnMeta = drawn ? cardMeta(catalog, drawn.defId) : null;
  const remaining = prompt.remaining ?? 0;

  return (
    <div className="hand-limit-overlay" role="dialog" aria-modal="true" aria-labelledby="hand-limit-title">
      <div className="hand-limit-panel">
        <OverlayClose onClose={onClose} />
        <p className="hand-limit-eyebrow">Hand full</p>
        <h2 id="hand-limit-title">You drew a card</h2>
        <p className="hand-limit-copy">
          Your hand is over the limit of 5. Discard one card to continue
          {remaining > 0 ? ` — then you will draw ${remaining} more` : ''}. No other actions until you do.
        </p>

        {drawn && (
          <div className="hand-limit-drawn">
            <p className="hand-limit-drawn-label">Drawn card</p>
            <div className="card hand-limit-drawn-card">
              <img src={drawnMeta?.image ?? '/cards/Back_Of_Card.png'} alt={drawnMeta?.name ?? drawn.defId} />
              <span>{drawnMeta?.name ?? drawn.defId}</span>
              {drawnMeta?.description?.[0] && (
                <small className="card-blurb">{drawnMeta.description[0]}</small>
              )}
            </div>
          </div>
        )}

        <p className="hand-limit-pick-label">Choose a card to discard</p>
        <div className="hand-limit-grid">
          {state.players[you].hand.map((c) => {
            const meta = cardMeta(catalog, c.defId);
            const isDrawn = c.instanceId === drawnId;
            return (
              <button
                key={c.instanceId}
                type="button"
                className={`card ${picked === c.instanceId ? 'active' : ''} ${isDrawn ? 'hand-limit-new' : ''}`}
                onClick={() => setPicked(c.instanceId)}
              >
                {isDrawn ? <em className="hand-limit-new-tag">New</em> : null}
                <img src={meta?.image ?? '/cards/Back_Of_Card.png'} alt={meta?.name ?? c.defId} />
                <span>{meta?.name ?? c.defId}</span>
                {meta?.description?.[0] && <small className="card-blurb">{meta.description[0]}</small>}
              </button>
            );
          })}
        </div>

        <div className="hand-limit-actions">
          <button
            type="button"
            className="primary"
            disabled={!picked}
            onClick={() => picked && onDiscard(picked)}
          >
            Discard selected
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayPromptBanners({
  status,
  error,
  state,
  you,
  catalog,
  gadgetKind,
  setGadgetKind,
  setStatus,
  send,
  cancelAbility,
  onDismissStatus,
  onDismissError,
  onOpenLawPicker,
}: {
  status: string;
  error: string | null;
  state: GameState;
  you: Color | null;
  catalog: Catalog | null;
  gadgetKind: string | null;
  setGadgetKind: (kind: string | null) => void;
  setStatus: (msg: string) => void;
  send: (action: object) => void;
  cancelAbility: () => void;
  onDismissStatus?: () => void;
  onDismissError?: () => void;
  onOpenLawPicker?: () => void;
}) {
  return (
    <>
      {status ? (
        <div className="banner banner-dismissable">
          <span>{status}</span>
          {onDismissStatus ? (
            <button type="button" className="msg-dismiss" aria-label="Close message" onClick={onDismissStatus}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      {error && (
        <div className="banner error banner-dismissable">
          <span>{error}</span>
          {onDismissError ? (
            <button type="button" className="msg-dismiss" aria-label="Close error" onClick={onDismissError}>
              ×
            </button>
          ) : null}
        </div>
      )}

      {state.pendingPrompt?.type === 'promote' && state.pendingPrompt.color === you && (
        <div className="banner">
          Promote to:
          <span className="prompt-actions">
            {(state.pendingPrompt.options as string[] | undefined)?.map((opt) => (
              <button key={opt} type="button" onClick={() => send({ type: 'resolve_prompt', payload: opt })}>
                <PieceIcon defId={opt} color={you ?? 'white'} className="sm" />{' '}
                {pieceMeta(catalog, opt)?.name ?? opt}
              </button>
            ))}
          </span>
        </div>
      )}

      {state.pendingPrompt?.type === 'gadget_choice' && state.pendingPrompt.color === you && (
        <div className="banner">
          Deploy a gadget on an adjacent empty square:
          <span className="prompt-actions">
            {(['ice_floor', 'spring_board', 'gnome_hole'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={gadgetKind === kind ? 'primary' : ''}
                onClick={() => {
                  setGadgetKind(kind);
                  setStatus(`Selected ${getObstacleInfo(kind).name} — click an adjacent empty square`);
                }}
              >
                {getObstacleInfo(kind).name}
              </button>
            ))}
            <button type="button" onClick={cancelAbility}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {state.pendingPrompt?.type === 'ability_target' &&
        state.pendingPrompt.color === you &&
        state.pendingPrompt.abilityId === 'temporal_shift' && (
          <div className="banner">
            Temporal Shift:
            <span className="prompt-actions">
              <button type="button" onClick={() => send({ type: 'resolve_prompt', payload: 'skip' })}>
                Skip phase ({state.dayNight === 'day' ? 'Day → Night' : 'Night → Day'})
              </button>
              <button
                type="button"
                disabled={!state.previousDayNight}
                onClick={() => send({ type: 'resolve_prompt', payload: 'revert' })}
              >
                Revert last change
              </button>
              <button type="button" onClick={cancelAbility}>
                Cancel
              </button>
            </span>
          </div>
        )}

      {state.pendingPrompt?.type === 'ability_target' &&
        state.pendingPrompt.color === you &&
        state.pendingPrompt.abilityId === 'revive' && (
          <div className="banner">
            Revive from graveyard:
            <span className="prompt-actions">
              {state.players[you].graveyard
                .filter((g) => g.defId !== 'angel')
                .map((g, i) => (
                  <button
                    key={`${g.defId}-${i}`}
                    type="button"
                    onClick={() => send({ type: 'resolve_prompt', payload: g.defId })}
                  >
                    <PieceIcon defId={g.defId} color={you} className="sm" /> {pieceMeta(catalog, g.defId)?.name}
                  </button>
                ))}
              <button type="button" onClick={cancelAbility}>
                Cancel
              </button>
            </span>
          </div>
        )}

      {state.pendingPrompt?.type === 'ability_target' &&
        state.pendingPrompt.color === you &&
        state.pendingPrompt.abilityId !== 'revive' &&
        state.pendingPrompt.abilityId !== 'temporal_shift' && (
          <div className="banner">
            {state.pendingPrompt.message}
            <span className="prompt-actions">
              <button type="button" onClick={cancelAbility}>
                {state.pendingPrompt.skippable ? 'Skip' : 'Cancel'}
              </button>
            </span>
          </div>
        )}

      {(state.pendingPrompt?.type === 'spring_bounce' || state.pendingPrompt?.type === 'gnome_hole_travel') &&
        state.pendingPrompt.color === you && (
          <div className="banner">
            {state.pendingPrompt.message}
            {state.pendingPrompt.type === 'gnome_hole_travel' && (
              <span className="prompt-actions">
                <button type="button" onClick={() => send({ type: 'resolve_prompt', payload: 'skip' })}>
                  Stay here
                </button>
              </span>
            )}
          </div>
        )}

      {state.pendingPrompt?.type === 'law_choice' && state.pendingPrompt.color === you && (
        <div className="banner">
          Your President is convening: enact a law or skip this cycle before play continues.
          {onOpenLawPicker ? (
            <span className="prompt-actions">
              <button type="button" className="primary" onClick={onOpenLawPicker}>
                Choose a law
              </button>
            </span>
          ) : null}
        </div>
      )}

      {state.pendingPrompt?.type === 'law_choice' && you && state.pendingPrompt.color !== you && (
        <div className="banner">The opposing President is choosing a law…</div>
      )}

      {state.pendingPrompt?.type === 'gambler_choice' && you && (
        <GamblerPrompt
          prompt={state.pendingPrompt}
          you={you}
          state={state}
          catalog={catalog}
          onResolve={(payload) => send({ type: 'resolve_prompt', payload })}
        />
      )}
    </>
  );
}

const LAW_KIND_LABEL: Record<string, string> = {
  restrict: 'Restriction',
  mandate: 'Mandate',
  magic: 'Prohibition',
  instant: 'Instant',
  buff: 'Benefit',
};

function LawPicker({
  options,
  color,
  onEnact,
  onSkip,
  onHide,
}: {
  options: string[];
  color: Color;
  onEnact: (lawId: string) => void;
  onSkip: () => void;
  onHide: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const picked = pick ? LAWS[pick] : null;
  return (
    <div className="evolve-picker-backdrop law-picker-backdrop">
      <div className="evolve-picker law-picker" role="dialog" aria-modal="true" aria-label="Executive Order">
        <div className="law-picker-head">
          <PieceIcon defId="president" color={color} className="law-picker-icon" />
          <div>
            <h3>Executive Order</h3>
            <p className="evolve-picker-sub">
              A new day dawns. Enact one law — it binds both players until the next dawn — or skip until the next
              dawn.
            </p>
          </div>
        </div>
        <div className="law-picker-options">
          {options.map((id) => {
            const law = LAWS[id];
            return (
              <button
                key={id}
                type="button"
                className={`law-card${pick === id ? ' is-picked' : ''}`}
                aria-pressed={pick === id}
                onClick={() => setPick(id)}
              >
                <span className="law-card-kind">{LAW_KIND_LABEL[law?.kind ?? ''] ?? 'Law'}</span>
                <strong>{law?.name ?? id}</strong>
                <span className="law-card-text">{law?.text}</span>
              </button>
            );
          })}
        </div>
        <div className="law-picker-actions">
          <button type="button" onClick={onHide}>
            View board
          </button>
          <button type="button" onClick={onSkip}>
            Skip this cycle
          </button>
          <button
            type="button"
            className="primary"
            disabled={!pick}
            onClick={() => pick && onEnact(pick)}
          >
            {picked ? `Enact ${picked.name}` : 'Select a law'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Graveyard({
  items,
  catalog,
  color,
}: {
  items: Array<{ defId: string; class: string }>;
  catalog: Catalog | null;
  color: 'white' | 'black';
}) {
  if (!items.length) return <p className="muted">None</p>;
  return (
    <div className="grave">
      {items.map((g, i) => (
        <PieceIcon
          key={`${g.defId}-${i}`}
          defId={g.defId}
          color={color}
          className="sm"
          title={pieceMeta(catalog, g.defId)?.name ?? g.defId}
        />
      ))}
    </div>
  );
}

function GamblerPrompt({
  prompt,
  you,
  state,
  catalog,
  onResolve,
}: {
  prompt: NonNullable<GameState['pendingPrompt']>;
  you: Color;
  state: GameState;
  catalog: Catalog | null;
  onResolve: (payload: unknown) => void;
}) {
  const roll = prompt.roll ?? 0;
  const cardPlayer = prompt.color ?? you;
  const classes = ['pawn', 'rook', 'knight', 'bishop', 'wildcard', 'queen'];

  const graveButtons = (color: Color) =>
    state.players[color].graveyard.map((g, idx) => (
      <button
        key={`${g.defId}-${idx}`}
        type="button"
        onClick={() => onResolve({ class: g.class, idx, defId: g.defId })}
      >
        <PieceIcon defId={g.defId} color={color} className="sm" />{' '}
        {pieceMeta(catalog, g.defId)?.name ?? g.defId}
      </button>
    ));

  if (roll <= 4 && you !== cardPlayer) {
    const filter =
      prompt.cardDefId === 'gamblers_gambit'
        ? (p: { class: string }) => p.class !== 'king' && p.class !== 'queen'
        : (p: { class: string }) => p.class === 'pawn';
    const choices = state.pieces.filter((p) => p.color === cardPlayer && filter(p));
    if (prompt.cardDefId === 'gamblers_delight' && choices.length === 0) {
      return (
        <div className="banner">
          {prompt.message}
          <span className="prompt-actions">
            <button type="button" className="primary" onClick={() => onResolve(null)}>
              Confirm
            </button>
          </span>
        </div>
      );
    }
    return (
      <div className="banner">
        {prompt.message} Click a highlighted piece on the board, then Confirm.
      </div>
    );
  }

  if (prompt.cardDefId === 'gamblers_gambit' && roll === 10) {
    if (you !== opposite(cardPlayer)) {
      return <div className="banner">{prompt.message}</div>;
    }
    const buttons = graveButtons(you);
    return (
      <div className="banner">
        {prompt.message}
        <span className="prompt-actions">
          {buttons.length ? (
            buttons
          ) : (
            <button type="button" className="primary" onClick={() => onResolve(null)}>
              No fallen pieces — skip
            </button>
          )}
        </span>
      </div>
    );
  }

  if (prompt.color !== you) return <div className="banner">{prompt.message}</div>;

  if (roll >= 7 && roll <= 9) {
    return (
      <div className="banner">
        {prompt.message}
        <span className="prompt-actions">
          {classes.map((c) => (
            <button key={c} type="button" onClick={() => onResolve(c)}>
              {c}
            </button>
          ))}
        </span>
      </div>
    );
  }

  if (prompt.cardDefId === 'gamblers_delight' && roll >= 10 && roll <= 11) {
    const gy = graveButtons(you);
    return (
      <div className="banner">
        {prompt.message}
        <span className="prompt-actions">
          {gy}
          {classes.map((c) => (
            <button key={c} type="button" onClick={() => onResolve(c)}>
              {c}
            </button>
          ))}
          {gy.length === 0 &&
            state.players[opposite(you)].graveyard.length === 0 && (
              <button type="button" className="primary" onClick={() => onResolve(null)}>
                Nothing to revive — skip
              </button>
            )}
        </span>
      </div>
    );
  }

  if (prompt.cardDefId === 'gamblers_gambit' && roll === 11) {
    const buttons = graveButtons(you);
    return (
      <div className="banner">
        {prompt.message}
        <span className="prompt-actions">
          {buttons.length ? (
            buttons
          ) : (
            <button type="button" className="primary" onClick={() => onResolve(null)}>
              No fallen pieces — skip
            </button>
          )}
        </span>
      </div>
    );
  }

  if (roll <= 6 || roll >= 10) {
    return (
      <div className="banner">
        {prompt.message}
        <span className="prompt-actions">
          <button type="button" className="primary" onClick={() => onResolve(null)}>
            Confirm
          </button>
        </span>
      </div>
    );
  }
  return <div className="banner">{prompt.message}</div>;
}
