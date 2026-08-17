import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { listMoves as engineListMoves, availableAbilities as engineAbilities } from '@shared/engine/game.ts';
import { isPigLShape } from '@shared/pieces/helpers.ts';
import { CosmicBackdrop, FxToggle, KnowledgeToggle, useFxEnabled, useKnowledgeEnabled } from './CosmicFx';
import {
  AudioToggles,
  playCardCastSfx,
  playPieceSfx,
  useAudioScene,
  useAudioSettings,
  useUiButtonSfx,
} from './AudioControl';
import { PieceIcon } from './PieceIcon';
import { getPieceInfo } from './pieceInfo';
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
  effects: Array<{ id?: string; kind: string; turnsRemaining?: number }>;
  charges?: number;
  gadgetUsed?: boolean;
  abilityCooldown?: number;
  ritualTurns?: number;
  reviveCount?: number;
  bloodlust?: boolean;
  coOccupantId?: string;
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
  tokens: Array<{ id: string; kind: string; pos: Coord; owner: Color }>;
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
    }
  >;
  turn: Color;
  turnPhase: string;
  turnCount?: number;
  dayNight: string;
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
    abilityId?: string;
    from?: Coord;
  };
  draft: null | {
    pickingColor: Color;
    blackChoseFirstPicker: boolean | null;
    order: string[];
    index: number;
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

function cardMeta(catalog: Catalog | null, defId: string) {
  return catalog?.cards.find((c) => c.id === defId);
}

function isAlliedTerritory(color: Color, pos: Coord): boolean {
  return color === 'white' ? pos.row >= 5 : pos.row < 5;
}

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/** Drop Best Buddy teleports that aren't a real Pig L (2×1). */
function sanitizeMoves(piece: Piece | undefined, opts: MoveOption[]): MoveOption[] {
  if (!piece || piece.defId !== 'pig') return opts;
  return opts.filter((m) => m.special !== 'best_buddy' || isPigLShape(piece.pos, m.to));
}

export default function App() {
  const { fxEnabled, setFxEnabled } = useFxEnabled();
  const { knowledgeEnabled, setKnowledgeEnabled } = useKnowledgeEnabled();
  const { musicEnabled, sfxEnabled, musicVolume, setMusicEnabled, setSfxEnabled, setMusicVolume } =
    useAudioSettings();
  useUiButtonSfx();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
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
  const prevTurnRef = useRef<string | null>(null);

  useEffect(() => {
    const s = io(SOCKET_URL || undefined, { transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('state', (payload: { state: GameState; you: Color; draftOptions: string[]; catalog: Catalog }) => {
      setState(payload.state);
      setYou(payload.you);
      setDraftOptions(payload.draftOptions ?? []);
      setCatalog(payload.catalog);
      setError(null);
      const turnKey = `${payload.state.turn}:${payload.state.phase}`;
      if (prevTurnRef.current && prevTurnRef.current !== turnKey) {
        setConfirmKey(null);
        setSpellConfirm(null);
        setFocusSpecial(null);
        setSelectedPiece(null);
        setMoves([]);
        setAbilities([]);
      }
      prevTurnRef.current = turnKey;
      if (payload.state.pendingPrompt?.message) setStatus(payload.state.pendingPrompt.message);
    });
    s.on('error_message', (msg: string) => setError(msg));
    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (state?.phase !== 'draft') return;
    setInspectedId((id) => (id?.startsWith('draft:') ? null : id));
  }, [state?.draft?.index, state?.draft?.pickingColor]);

  const send = (action: object) => {
    if (!socket || !roomCode) return;
    socket.emit('action', { code: roomCode, action }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error ?? 'Action failed');
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
      }
    } catch (e) {
      setError((e as Error).message);
      setMoves([]);
      setAbilities([]);
    }
  };

  const requestMoves = (pieceId: string) => {
    if (!state) return;
    setFocusSpecial(null);
    refreshMoves(pieceId, state);
    // Also ask server (authoritative); merge if still selecting this piece
    if (!socket || !roomCode) return;
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

  const createRoom = () => {
    socket?.emit('create_room', { name }, (res: { ok: boolean; code?: string; color?: Color; error?: string }) => {
      if (!res.ok) return setError(res.error ?? 'Create failed');
      setRoomCode(res.code!);
      setYou(res.color!);
      setStatus('Share the room code. Game starts when a second player joins.');
    });
  };

  const joinRoom = () => {
    socket?.emit(
      'join_room',
      { code: joinCode.trim(), name },
      (res: { ok: boolean; code?: string; color?: Color; error?: string }) => {
        if (!res.ok) return setError(res.error ?? 'Join failed');
        setRoomCode(res.code!);
        setYou(res.color!);
      },
    );
  };

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

  const activeCardDef = useMemo(() => {
    if (!state || !you || !selectedCard) return null;
    const card = state.players[you].hand.find((c) => c.instanceId === selectedCard);
    return card ? cardMeta(catalog, card.defId) ?? null : null;
  }, [state, you, selectedCard, catalog]);

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

  const targetNeeded = activeCardDef?.targeting && activeCardDef.targeting !== 'none';

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
    setStatus('Ability canceled.');
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
    playCardCastSfx();
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
        parts.push(`file ${c.col + 1}, rank ${10 - c.row}`);
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

  const onSquareClick = (row: number, col: number) => {
    if (!state || !you) return;
    playPieceSfx();
    const squareKey = `${row},${col}`;

    const prompt = state.pendingPrompt;
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
            ? `Move barrier to file ${col + 1}, rank ${10 - row}?`
            : `Select barrier at file ${col + 1}, rank ${10 - row}?`;
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

    // Click your barrier on your turn to start Barrier Shift (Enchanted Pawn)
    const barrierHere = state.tokens.find(
      (t) => t.kind === 'barrier' && t.owner === you && t.pos.row === row && t.pos.col === col,
    );
    if (
      barrierHere &&
      state.turn === you &&
      state.phase === 'playing' &&
      !state.pendingPrompt &&
      state.players[you].army.pawn === 'enchanted_pawn'
    ) {
      const ep = state.pieces.find((p) => p.color === you && p.defId === 'enchanted_pawn');
      if (ep) {
        const summary = `Shift barrier at file ${col + 1}, rank ${10 - row}?`;
        setSpellConfirm({
          summary,
          mode: 'move',
          move: {
            pieceId: ep.id,
            to: { row, col },
            meta: { special: 'barrier_shift_select', from: { row, col } },
          },
        });
        setSelectedPiece(ep.id);
        setMoves([]);
        setAbilities([]);
        setStatus(summary);
        clearBoardConfirm();
        return;
      }
    }

    if (selectedCard && targetNeeded) {
      const mode = activeCardDef!.targeting;

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
        if (activeCardDef!.id === 'teleport') {
          if (next.length >= 2) {
            offerSpellConfirm(next);
          } else {
            setPendingTargets(next);
            clearBoardConfirm();
            setSpellConfirm(null);
            setStatus('Teleport: pick destination (exactly 2 steps).');
          }
          return;
        }
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

    if (selectedPiece && moves.some((m) => m.to.row === row && m.to.col === col)) {
      const pool = focusSpecial ? moves.filter((m) => m.special === focusSpecial) : moves;
      const candidates = pool.filter((m) => m.to.row === row && m.to.col === col);
      if (!candidates.length) {
        if (focusSpecial) {
          setStatus(`That square is not a valid ${focusSpecial.replace(/_/g, ' ')} target`);
          return;
        }
      } else {
        const move = candidates.find((m) => m.special) ?? candidates[0]!;
        if (move.special === 'best_buddy') {
          const pig = state.pieces.find((p) => p.id === selectedPiece);
          if (!pig || !isPigLShape(pig.pos, { row, col })) {
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
                  : move.special === 'castle_swap'
                    ? 'Castle'
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
    if (piece && selectedCard && targetNeeded) {
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
          setPendingTargets([piece.id]);
          clearBoardConfirm();
          setSpellConfirm(null);
          setStatus('Teleport: now pick a destination 2 spaces away');
          return;
        }
        if (activeCardDef!.id === 'swap') {
          const next = [...pendingTargets, piece.id];
          setPendingTargets(next);
          clearBoardConfirm();
          setSpellConfirm(null);
          if (next.length === 1) {
            setStatus('Swap: pick a different variant id from the buttons below');
            return;
          }
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
        if (!isPigLShape(selected.pos, piece.pos)) {
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
      setSelectedPiece(null);
      setMoves([]);
      setAbilities([]);
      setInspectedId(null);
      setHoveredId(null);
    }
  };

  const castCard = () => {
    if (!selectedCard || !activeCardDef) return;
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

  const inspectedPiece = useMemo(() => {
    if (!state) return null;
    const id = inspectedId && !inspectedId.startsWith('draft:') ? inspectedId : null;
    const hover = hoveredId && !hoveredId.startsWith('draft:') ? hoveredId : null;
    const active = id ?? hover;
    if (!active) return null;
    return state.pieces.find((p) => p.id === active) ?? null;
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
    </div>
  );

  if (!roomCode || !state) {
    return (
      <div className="shell lobby-shell home">
        <CosmicBackdrop enabled={fxEnabled} dayNight="day" />
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
            <div className="home-actions">
              <button type="button" className="primary home-cta" onClick={createRoom}>
                Create room
              </button>
              <div className="home-join">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ROOM"
                  maxLength={5}
                  aria-label="Room code"
                />
                <button type="button" onClick={joinRoom}>
                  Join
                </button>
              </div>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
          <button type="button" className="home-rules" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
        </main>
        <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
        <KnowledgeToggle
          enabled={knowledgeEnabled}
          onToggle={() => setKnowledgeEnabled((v) => !v)}
        />
        {audioFxStack}
      </div>
    );
  }

  const flip = you === 'black';

  return (
    <div className="shell">
      <CosmicBackdrop enabled={fxEnabled} dayNight={state.dayNight} />
      {(state.phase === 'playing' && state.turn !== you) ||
      (state.phase === 'opening_draw' &&
        state.pendingPrompt?.type === 'opening_mulligan' &&
        state.pendingPrompt.color !== you) ||
      (state.phase === 'draft' &&
        state.draft &&
        state.draft.blackChoseFirstPicker != null &&
        state.draft.pickingColor !== you) ? (
        <div className="waiting-opponent" role="status" aria-live="polite">
          <span className="waiting-opponent-dot" aria-hidden />
          Waiting for opponent
          {state.phase === 'opening_draw' ? (
            <span className="waiting-opponent-sub"> — opening hand</span>
          ) : state.phase === 'draft' ? (
            <span className="waiting-opponent-sub"> — draft</span>
          ) : null}
        </div>
      ) : null}
      <div className="shell-content">
      <header className="top">
        <div>
          <p className="brand">
            Chesspansion <span className="beta-tag" aria-label="Beta">Beta</span>
          </p>
          <p className="meta">
            Room <strong>{roomCode}</strong> · You are <strong>{you}</strong> ·{' '}
            <span className={state.dayNight}>{state.dayNight}</span> · cycle {state.cycleCount}
          </p>
        </div>
        <div className="meta right">
          {state.phase === 'playing' && (
            <div
              className={`turn-pill ${state.turn === you ? 'turn-yours' : 'turn-theirs'}`}
              role="status"
              aria-live="polite"
            >
              <span className="turn-pill-label">
                {state.turn === you ? 'Your turn' : "Opponent's turn"}
              </span>
              <span className="turn-pill-phase">{state.turnPhase}</span>
              {state.check ? <span className="turn-pill-check">{state.check} in check</span> : null}
            </div>
          )}
          {state.phase === 'ended' && (
            <span className="winner">
              {state.winner} wins ({state.winReason})
            </span>
          )}
        </div>
      </header>

      {state.phase === 'playing' && state.turn === you && (
        <div className="turn-banner turn-yours" role="status">
          <strong>Your turn</strong>
          <span> — cast a spell or move a piece ({state.turnPhase})</span>
        </div>
      )}

      <div className="banner">{status}</div>
      {error && <div className="banner error">{error}</div>}

      {state.pendingPrompt?.type === 'opening_mulligan' && state.pendingPrompt.color === you && (
        <div className="banner">
          Opening hand — keep, or select one card and redraw once.
          <span className="prompt-actions">
            <button type="button" className="primary" onClick={() => send({ type: 'opening_keep' })}>
              Keep hand
            </button>
            {selectedCard && !state.players[you!].openingRedrawUsed && (
              <button type="button" onClick={() => send({ type: 'opening_redraw', instanceId: selectedCard })}>
                Redraw selected
              </button>
            )}
          </span>
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
                  setStatus(`Selected ${kind} — click an adjacent empty square`);
                }}
              >
                {kind.replace('_', ' ')}
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
        state.pendingPrompt.abilityId !== 'revive' && (
          <div className="banner">
            {state.pendingPrompt.message}
            <span className="prompt-actions">
              <button type="button" onClick={cancelAbility}>
                Cancel
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

      {state.pendingPrompt?.type === 'gambler_choice' && (
        <GamblerPrompt
          prompt={state.pendingPrompt}
          you={you!}
          state={state}
          catalog={catalog}
          onResolve={(payload) => send({ type: 'resolve_prompt', payload })}
        />
      )}

      {state.phase === 'draft' && state.draft && (
        <section className="panel draft">
          <h2>Army draft</h2>
          {state.draft.blackChoseFirstPicker == null ? (
            you === 'black' ? (
              <div className="row draft-center-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => send({ type: 'choose_first_picker', whitePicksFirst: true })}
                >
                  White picks first
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => send({ type: 'choose_first_picker', whitePicksFirst: false })}
                >
                  Black picks first
                </button>
              </div>
            ) : (
              <p className="draft-status">Waiting for Black to choose who drafts first…</p>
            )
          ) : (
            <>
              <p className="draft-status">
                Picking <strong>{state.draft.order[state.draft.index]}</strong> —{' '}
                {state.draft.pickingColor === you ? 'Your pick' : 'Opponent picking'}
              </p>
              <div className="variant-grid draft-grid">
                {draftOptions.map((id) => {
                  const p = pieceMeta(catalog, id);
                  const selected = draftInspectDefId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={[
                        'draft-tile',
                        selected ? 'selected' : '',
                        state.draft?.pickingColor !== you ? 'muted-pick' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setInspectedId(`draft:${id}`)}
                      onMouseEnter={() => setHoveredId(`draft:${id}`)}
                      onMouseLeave={() =>
                        setHoveredId((h) => (h === `draft:${id}` ? null : h))
                      }
                    >
                      <span className="sym">
                        <PieceIcon defId={id} color={you ?? 'white'} title={p?.name} />
                      </span>
                      <span className="draft-tile-name">{p?.name ?? id}</span>
                    </button>
                  );
                })}
              </div>
              {draftInspectDefId && state.draft.pickingColor === you && (
                <div className="draft-confirm-row">
                  <button
                    type="button"
                    className="primary draft-confirm"
                    onClick={() => {
                      send({ type: 'draft_pick', defId: draftInspectDefId });
                      setInspectedId(null);
                    }}
                  >
                    Confirm {pieceMeta(catalog, draftInspectDefId)?.name ?? draftInspectDefId}
                  </button>
                </div>
              )}
              {draftInspectDefId && state.draft.pickingColor !== you && (
                <p className="draft-status muted">Select a piece to preview — waiting for opponent to pick.</p>
              )}
            </>
          )}
        </section>
      )}

      {(state.phase === 'playing' || state.phase === 'opening_draw' || state.phase === 'ended') && (
        <div className="play-layout">
          <aside className="side">
            <h2>{state.players.white.name} (white)</h2>
            <Graveyard items={state.players.white.graveyard} catalog={catalog} color="white" />
            <h2>{state.players.black.name} (black)</h2>
            <Graveyard items={state.players.black.graveyard} catalog={catalog} color="black" />
            <h2>Log</h2>
            <ul className="log">
              {state.history.slice(0, 14).map((h, i) => {
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
            <div className={`board ${flip ? 'flipped' : ''} ${state.phase === 'playing' ? (state.turn === you ? 'board-your-turn' : 'board-their-turn') : ''}`}>
              {Array.from({ length: 10 }, (_, visualRow) =>
                Array.from({ length: 10 }, (_, visualCol) => {
                  const row = flip ? 9 - visualRow : visualRow;
                  const col = flip ? 9 - visualCol : visualCol;
                  const piece = board[row][col];
                  const dark = (row + col) % 2 === 1;
                  const selected = piece && piece.id === selectedPiece;
                  const moveOpts = (focusSpecial
                    ? moves.filter((m) => m.special === focusSpecial)
                    : moves
                  ).filter((m) => m.to.row === row && m.to.col === col);
                  const moveHere = moveOpts.length > 0;
                  const specialHere = moveOpts.some((m) => Boolean(m.special));
                  const captureHere = moveOpts.some((m) => m.capture || Boolean(m.special));
                  const key = `${row},${col}`;
                  const barrierPick = barrierShiftHighlights.barriers.has(key);
                  const barrierFrom = barrierShiftHighlights.fromKey === key;
                  const barrierDest = barrierShiftHighlights.destinations.has(key);
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
                  const lastFrom =
                    !!state.lastMove &&
                    state.lastMove.from.row === row &&
                    state.lastMove.from.col === col;
                  const lastTo =
                    !!state.lastMove &&
                    state.lastMove.to.row === row &&
                    state.lastMove.to.col === col;
                  const lastPiece = !!(piece && state.lastMove?.pieceId === piece.id);
                  const showingInfo =
                    (piece && piece.id === inspectedId) ||
                    (piece && !infoLocked && piece.id === hoveredId);
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      className={[
                        'sq',
                        dark ? 'dark' : 'light',
                        selected ? 'selected' : '',
                        piece && piece.id === inspectedId ? 'inspected' : '',
                        piece && !infoLocked && piece.id === hoveredId ? 'info-hover' : '',
                        lastFrom ? 'last-from' : '',
                        lastTo || lastPiece ? 'last-to' : '',
                        hasPigBuddy ? 'pig-buddy-sq' : '',
                        moveHere ? 'move' : '',
                        moveHere && captureHere ? 'move-capture' : '',
                        moveHere && specialHere ? 'move-special' : '',
                        confirmKey === key || confirmKey === (piece ? `piece:${piece.id}` : '')
                          ? 'confirm-pending'
                          : '',
                        barrierPick || barrierFrom ? 'barrier-source' : '',
                        barrierDest ? 'barrier-target' : '',
                      ].join(' ')}
                      onClick={() => onSquareClick(row, col)}
                      onMouseEnter={() => {
                        if (piece) setHoveredId(piece.id);
                      }}
                      onMouseLeave={() => {
                        setHoveredId((h) => (piece && h === piece.id ? null : h));
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
                                : undefined
                      }
                    >
                      {toks.map((t) => (
                        <span key={t.id} className={`token ${t.kind}`} title={t.kind} />
                      ))}
                      {piece && (
                        <span
                          className={`piece ${lastPiece ? 'last-moved' : ''}${
                            (piece.effects ?? []).some((e) => effectTone(e.kind) === 'debuff')
                              ? ' has-debuff'
                              : (piece.effects ?? []).length
                                ? ' has-buff'
                                : ''
                          }`}
                          title={[
                            meta?.name ?? piece.defId,
                            hasPigBuddy ? 'Pig Best Buddy sharing this tile' : null,
                            ...visibleBoardEffects(piece.effects ?? []).map(formatEffectTitle),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <PieceIcon defId={piece.defId} color={piece.color} title={meta?.name ?? piece.defId} />
                          {hasPigBuddy && (
                            <i className="pig-buddy" title="Pig is Best Buddy on this piece">
                              <PieceIcon defId="pig" color={piece.color} className="sm" title="Pig buddy" />
                            </i>
                          )}
                          {piece.charges != null && piece.charges > 0 && <i className="charge">{piece.charges}</i>}
                          {piece.ritualTurns != null && piece.ritualTurns > 0 && (
                            <i className="ritual" title="Revive ritual">{piece.ritualTurns}</i>
                          )}
                          {(() => {
                            const statuses = visibleBoardEffects(piece.effects ?? []);
                            if (piece.bloodlust) {
                              statuses.unshift({ id: 'bloodlust', kind: 'bloodlust' });
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

            <div className="ability-bar" aria-live="polite">
              {selectedPiece && abilities.length > 0 && state.turn === you
                ? abilities.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`${a.passive ? '' : 'primary'} ${focusSpecial === a.id ? 'active' : ''}`}
                      disabled={!a.ready && !a.passive}
                      title={a.hint}
                      onClick={() => {
                        if (a.passive) {
                          if (a.id === 'bloodlust') {
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
            {you &&
              state.turn === you &&
              state.phase === 'playing' &&
              state.players[you].army.pawn === 'enchanted_pawn' &&
              state.tokens.some((t) => t.kind === 'barrier' && t.owner === you) &&
              !state.pendingPrompt && (
                <p className="hint barrier-hint">
                  Tip: click a barrier, press <strong>Confirm</strong>, then click a highlighted square and Confirm again
                  (<strong>Barrier Shift</strong>). Or select an Enchanted Pawn and use the ability button.
                </p>
              )}
          </main>

          <aside className="side hand-side">
            <h2>Your hand</h2>
            <div
              className={`hand ${
                state.phase === 'playing' && state.turn === you && state.turnPhase === 'move'
                  ? 'hand-spell-locked'
                  : ''
              }`}
            >
              {you &&
                state.players[you].hand.map((c) => {
                  const meta = cardMeta(catalog, c.defId);
                  const spellLocked =
                    state.phase === 'playing' && state.turn === you && state.turnPhase === 'move';
                  return (
                    <button
                      key={c.instanceId}
                      type="button"
                      className={`card ${selectedCard === c.instanceId ? 'active' : ''} ${spellLocked ? 'card-dimmed' : ''}`}
                      disabled={spellLocked}
                      title={spellLocked ? 'Spell phase skipped — cards available next turn' : undefined}
                      onClick={() => {
                        if (spellLocked) return;
                        setSelectedCard(c.instanceId);
                        setPendingTargets([]);
                        setSpellConfirm(null);
                        clearBoardConfirm();
                      }}
                    >
                      <img src={meta?.image ?? '/cards/Back_Of_Card.png'} alt={meta?.name ?? c.defId} />
                      <span>{meta?.name ?? c.defId}</span>
                      {meta?.description?.[0] && <small className="card-blurb">{meta.description[0]}</small>}
                    </button>
                  );
                })}
            </div>

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
                      if (promptType === 'gadget_choice' || promptType === 'ability_target') {
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

            {state.phase === 'playing' && (
              <div className="row">
                {((state.turn === you &&
                  state.turnPhase === 'spell' &&
                  state.players[you].spellsThisTurn < state.players[you].maxSpellsThisTurn) ||
                  (selectedCard && activeCardDef?.playOnOpponentTurn && state.turn !== you)) && (
                  <button
                    type="button"
                    className="primary"
                    onClick={castCard}
                    disabled={!selectedCard || !!spellConfirm}
                  >
                    Cast selected
                  </button>
                )}
                {state.turn === you && state.turnPhase === 'spell' && (
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

            {activeCardDef?.id === 'swap' && pendingTargets.length === 1 && (
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

            {activeCardDef && (
              <div className="card-details">
                <h3>{activeCardDef.name}</h3>
                <ul>
                  {activeCardDef.description.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="hint">
              Flow: spell (optional) → move one piece. Putting the opponent in check ends your turn immediately. Add more
              cards in <code>shared/src/cards/</code> without touching the UI.
            </p>
          </aside>
        </div>
      )}

      {knowledgeEnabled && inspectedPiece && (
        <PieceInfoTile
          defId={inspectedPiece.defId}
          color={inspectedPiece.color}
          locked={infoLocked}
          live={{
            charges: inspectedPiece.charges,
            ritualTurns: inspectedPiece.ritualTurns,
            gadgetUsed: inspectedPiece.gadgetUsed,
            abilityCooldown: inspectedPiece.abilityCooldown,
            bloodlust: inspectedPiece.bloodlust,
            coOccupantId: inspectedPiece.coOccupantId,
            hasPigBuddy: pigHostIds.has(inspectedPiece.id),
            effects: inspectedPiece.effects,
          }}
          onClose={() => {
            setInspectedId(null);
            setHoveredId(null);
          }}
        />
      )}
      {draftInspectDefId && (
        <PieceInfoTile
          defId={draftInspectDefId}
          color={you ?? 'white'}
          locked={Boolean(inspectedId?.startsWith('draft:'))}
          onClose={() => {
            setInspectedId(null);
            setHoveredId(null);
          }}
        />
      )}
      </div>
      <KnowledgeToggle
        enabled={knowledgeEnabled}
        onToggle={() => setKnowledgeEnabled((v) => !v)}
      />
      {audioFxStack}
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

function PieceInfoTile({
  defId,
  color,
  live,
  locked = false,
  onClose,
}: {
  defId: string;
  color: Color;
  live?: {
    charges?: number;
    ritualTurns?: number;
    gadgetUsed?: boolean;
    abilityCooldown?: number;
    bloodlust?: boolean;
    coOccupantId?: string;
    hasPigBuddy?: boolean;
    effects?: Array<{ id?: string; kind: string; turnsRemaining?: number }>;
  };
  locked?: boolean;
  onClose: () => void;
}) {
  const info = getPieceInfo(defId);
  const [previewColor, setPreviewColor] = useState<Color>(color);

  useEffect(() => {
    setPreviewColor(color);
  }, [color, defId]);

  return (
    <aside
      className={`piece-info-tile ${previewColor} ${locked ? 'is-locked' : 'is-hover'}`}
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
      <div className="piece-info-head">
        <div className="piece-info-icon-wrap">
          <PieceIcon defId={defId} color={previewColor} title={info.name} />
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

      {info.abilities.length > 0 && (
        <section>
          <h3>Abilities</h3>
          <ul>
            {info.abilities.map((line) => (
              <li key={line}>{formatNamedLine(line)}</li>
            ))}
          </ul>
        </section>
      )}

      {info.misc && info.misc.length > 0 && (
        <section>
          <h3>Notes</h3>
          <ul>
            {info.misc.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {live && (
        <div className="piece-info-live">
          {live.charges != null && <span>Charges: {live.charges}</span>}
          {live.ritualTurns != null && live.ritualTurns > 0 && <span>Ritual: {live.ritualTurns}</span>}
          {live.gadgetUsed && <span>Gadget used</span>}
          {live.abilityCooldown != null && live.abilityCooldown > 0 && (
            <span>Cooldown: {live.abilityCooldown}</span>
          )}
          {live.bloodlust && <span>Bloodlust</span>}
          {live.coOccupantId && <span className="live-effect tone-buff">Pig Best Buddy</span>}
          {live.hasPigBuddy && <span className="live-effect tone-buff">Pig riding</span>}
          {live.effects?.map((e) => (
            <span key={e.id} className={`live-effect tone-${effectTone(e.kind)}`}>
              {formatEffectTitle(e)}
            </span>
          ))}
        </div>
      )}
    </aside>
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
  const actor = prompt.color ?? you;
  if (prompt.cardDefId === 'gamblers_gambit' && roll <= 4 && you !== actor) {
    const choices = state.pieces.filter(
      (p) => p.color === actor && p.class !== 'king' && p.class !== 'queen',
    );
    return (
      <div className="banner">
        Choose an enemy piece to remove:
        <span className="prompt-actions">
          {choices.map((p) => (
            <button key={p.id} type="button" onClick={() => onResolve(p.id)}>
              <PieceIcon defId={p.defId} color={p.color} className="sm" />{' '}
              {pieceMeta(catalog, p.defId)?.name}
            </button>
          ))}
        </span>
      </div>
    );
  }
  if (prompt.color !== you) return <div className="banner">{prompt.message}</div>;
  if (roll >= 7 && roll <= 9) {
    const classes = ['pawn', 'rook', 'knight', 'bishop', 'wildcard', 'queen'];
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
