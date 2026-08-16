import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

type Color = 'white' | 'black';
type Coord = { row: number; col: number };

interface Piece {
  id: string;
  defId: string;
  class: string;
  color: Color;
  pos: Coord;
  effects: Array<{ kind: string; turnsRemaining?: number }>;
  charges?: number;
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
  dayNight: string;
  cycleCount: number;
  check: Color | null;
  winner: Color | null;
  winReason?: string;
  history: string[];
  pendingPrompt: null | {
    type: string;
    color?: Color;
    message?: string;
    options?: string[];
    pieceId?: string;
    cardDefId?: string;
    roll?: number;
    selected?: unknown[];
    cardInstanceId?: string;
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
}

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';

function pieceMeta(catalog: Catalog | null, defId: string) {
  return catalog?.pieces.find((p) => p.id === defId);
}

function cardMeta(catalog: Catalog | null, defId: string) {
  return catalog?.cards.find((c) => c.id === defId);
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [you, setYou] = useState<Color | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null);
  const [moves, setMoves] = useState<MoveOption[]>([]);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [pendingTargets, setPendingTargets] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Connect and create or join a room.');

  useEffect(() => {
    const s = io(SOCKET_URL || undefined, { transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('state', (payload: { state: GameState; you: Color; draftOptions: string[]; catalog: Catalog }) => {
      setState(payload.state);
      setYou(payload.you);
      setDraftOptions(payload.draftOptions ?? []);
      setCatalog(payload.catalog);
      setError(null);
      if (payload.state.pendingPrompt?.message) setStatus(payload.state.pendingPrompt.message);
    });
    s.on('error_message', (msg: string) => setError(msg));
    return () => {
      s.disconnect();
    };
  }, []);

  const send = (action: object) => {
    if (!socket || !roomCode) return;
    socket.emit('action', { code: roomCode, action }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error ?? 'Action failed');
    });
  };

  const requestMoves = (pieceId: string) => {
    if (!socket || !roomCode) return;
    socket.emit(
      'get_moves',
      { code: roomCode, pieceId },
      (res: { ok: boolean; moves?: MoveOption[]; error?: string }) => {
        if (!res?.ok) {
          setError(res?.error ?? 'Could not get moves');
          setMoves([]);
          return;
        }
        setMoves(res.moves ?? []);
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
      if (!grid[p.pos.row][p.pos.col]) grid[p.pos.row][p.pos.col] = p;
    }
    return grid;
  }, [state]);

  const activeCardDef = useMemo(() => {
    if (!state || !you || !selectedCard) return null;
    const card = state.players[you].hand.find((c) => c.instanceId === selectedCard);
    return card ? cardMeta(catalog, card.defId) ?? null : null;
  }, [state, you, selectedCard, catalog]);

  const targetNeeded = activeCardDef?.targeting && activeCardDef.targeting !== 'none';

  const finishCard = (targets: unknown[]) => {
    if (!selectedCard) return;
    send({ type: 'play_card', instanceId: selectedCard, targets });
    setSelectedCard(null);
    setPendingTargets([]);
    setStatus('Card played.');
  };

  const onSquareClick = (row: number, col: number) => {
    if (!state || !you) return;

    if (selectedCard && targetNeeded) {
      const mode = activeCardDef!.targeting;
      if (mode === 'empty_allied' || mode === 'empty_any' || mode === 'square') {
        const next = [...pendingTargets, { row, col }];
        const need = activeCardDef!.id === 'portal' || activeCardDef!.id === 'pawn_summon' ? 2 : 1;
        if (activeCardDef!.id === 'teleport') {
          // teleport needs piece then square — piece first
          setPendingTargets(next);
          setStatus('Teleport: pick destination (exactly 2 steps).');
          if (next.length >= 2) finishCard(next);
          return;
        }
        setPendingTargets(next);
        if (next.length >= need) finishCard(next);
        else setStatus(`Pick ${need - next.length} more square(s)`);
        return;
      }
    }

    if (selectedPiece && moves.some((m) => m.to.row === row && m.to.col === col)) {
      const move = moves.find((m) => m.to.row === row && m.to.col === col)!;
      send({
        type: 'move',
        pieceId: selectedPiece,
        to: { row, col },
        meta: move.special ? { special: move.special } : undefined,
      });
      setSelectedPiece(null);
      setMoves([]);
      return;
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
          setPendingTargets(next);
          if (next.length >= 4) {
            setStatus('Rearrange: click squares to assign order, or use default rotation');
            // default cyclic shift of positions
            const selectedPieces = next.map((id) => state.pieces.find((p) => p.id === id)!);
            const assignment: Record<string, Coord> = {};
            for (let i = 0; i < 4; i++) {
              assignment[selectedPieces[i].id] = selectedPieces[(i + 1) % 4].pos;
            }
            finishCard([...next, assignment]);
          } else setStatus(`Rearrange: pick ${4 - next.length} more allied piece(s)`);
          return;
        }
        if (activeCardDef!.id === 'teleport') {
          setPendingTargets([piece.id]);
          setStatus('Teleport: now pick a destination 2 spaces away');
          return;
        }
        if (activeCardDef!.id === 'swap') {
          const next = [...pendingTargets, piece.id];
          setPendingTargets(next);
          if (next.length === 1) {
            setStatus('Swap: pick a different variant id from the buttons below');
            return;
          }
        }
        finishCard([piece.id]);
        return;
      }
    }

    if (piece && piece.color === you) {
      setSelectedPiece(piece.id);
      requestMoves(piece.id);
    } else {
      setSelectedPiece(null);
      setMoves([]);
    }
  };

  const castCard = () => {
    if (!selectedCard || !activeCardDef) return;
    if (activeCardDef.targeting === 'none') {
      finishCard([]);
      return;
    }
    if (activeCardDef.targeting === 'graveyard') {
      const gy = you ? state?.players[you].graveyard ?? [] : [];
      if (!gy.length) {
        setError('No fallen pieces');
        return;
      }
      setStatus('Revive: click an empty spawn square after choosing index 0 by default');
      // simplified: revive first graveyard piece onto clicked square — handled via pending
      setPendingTargets([0]);
      return;
    }
    setPendingTargets([]);
    setStatus(`Select target for ${activeCardDef.name} (${activeCardDef.targeting})`);
  };

  if (!roomCode || !state) {
    return (
      <div className="shell lobby">
        <div className="lobby-card">
          <p className="brand">Chess 2</p>
          <h1>Build an army. Cast spells. Ruin openings.</h1>
          <p className="lede">
            10×10 board, wildcards, and a modular spell deck — create a room and share the code to play someone.
          </p>
          <label>
            Display name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" />
          </label>
          <div className="row">
            <button type="button" className="primary" onClick={createRoom}>
              Create room
            </button>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ROOM"
              maxLength={5}
            />
            <button type="button" onClick={joinRoom}>
              Join
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="lobby-art" aria-hidden />
      </div>
    );
  }

  const flip = you === 'black';

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="brand">Chess 2</p>
          <p className="meta">
            Room <strong>{roomCode}</strong> · You are <strong>{you}</strong> ·{' '}
            <span className={state.dayNight}>{state.dayNight}</span> · cycle {state.cycleCount}
          </p>
        </div>
        <div className="meta right">
          {state.phase === 'playing' && (
            <span>
              {state.turn === you ? 'Your turn' : 'Opponent turn'} · {state.turnPhase}
              {state.check ? ` · ${state.check} in check` : ''}
            </span>
          )}
          {state.phase === 'ended' && (
            <span className="winner">
              {state.winner} wins ({state.winReason})
            </span>
          )}
        </div>
      </header>

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
            {state.pendingPrompt.options?.map((opt) => (
              <button key={opt} type="button" onClick={() => send({ type: 'resolve_prompt', payload: opt })}>
                {pieceMeta(catalog, opt)?.name ?? opt}
              </button>
            ))}
          </span>
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
              <div className="row">
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
              <p>Waiting for Black to choose who drafts first…</p>
            )
          ) : (
            <>
              <p>
                Picking <strong>{state.draft.order[state.draft.index]}</strong> —{' '}
                {state.draft.pickingColor === you ? 'Your pick' : 'Opponent picking'}
              </p>
              <div className="variant-grid">
                {draftOptions.map((id) => {
                  const p = pieceMeta(catalog, id);
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={state.draft?.pickingColor !== you}
                      onClick={() => send({ type: 'draft_pick', defId: id })}
                    >
                      <span className="sym">{p?.symbol}</span>
                      <span>{p?.name ?? id}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {(state.phase === 'playing' || state.phase === 'opening_draw' || state.phase === 'ended') && (
        <div className="play-layout">
          <aside className="side">
            <h2>{state.players.white.name} (white)</h2>
            <Graveyard items={state.players.white.graveyard} catalog={catalog} />
            <h2>{state.players.black.name} (black)</h2>
            <Graveyard items={state.players.black.graveyard} catalog={catalog} />
            <h2>Log</h2>
            <ul className="log">
              {state.history.slice(0, 14).map((h, i) => (
                <li key={`${h}-${i}`}>{h}</li>
              ))}
            </ul>
          </aside>

          <main>
            <div className={`board ${flip ? 'flipped' : ''}`}>
              {Array.from({ length: 10 }, (_, visualRow) =>
                Array.from({ length: 10 }, (_, visualCol) => {
                  const row = flip ? 9 - visualRow : visualRow;
                  const col = flip ? 9 - visualCol : visualCol;
                  const piece = board[row][col];
                  const dark = (row + col) % 2 === 1;
                  const selected = piece && piece.id === selectedPiece;
                  const moveHere = moves.some((m) => m.to.row === row && m.to.col === col);
                  const toks = state.tokens.filter((t) => t.pos.row === row && t.pos.col === col);
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      className={['sq', dark ? 'dark' : 'light', selected ? 'selected' : '', moveHere ? 'move' : ''].join(
                        ' ',
                      )}
                      onClick={() => onSquareClick(row, col)}
                    >
                      {toks.map((t) => (
                        <span key={t.id} className={`token ${t.kind}`} title={t.kind} />
                      ))}
                      {piece && (
                        <span className={`piece ${piece.color}`} title={piece.defId}>
                          {pieceMeta(catalog, piece.defId)?.symbol ?? '?'}
                          {piece.charges != null && piece.charges > 0 && <i className="charge">{piece.charges}</i>}
                        </span>
                      )}
                    </button>
                  );
                }),
              )}
            </div>
          </main>

          <aside className="side hand-side">
            <h2>Your hand</h2>
            <div className="hand">
              {you &&
                state.players[you].hand.map((c) => {
                  const meta = cardMeta(catalog, c.defId);
                  return (
                    <button
                      key={c.instanceId}
                      type="button"
                      className={`card ${selectedCard === c.instanceId ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedCard(c.instanceId);
                        setPendingTargets([]);
                      }}
                    >
                      <img src={meta?.image ?? '/cards/Back_Of_Card.png'} alt={meta?.name ?? c.defId} />
                      <span>{meta?.name ?? c.defId}</span>
                    </button>
                  );
                })}
            </div>

            {state.phase === 'playing' && (
              <div className="row">
                {(state.turn === you && state.turnPhase === 'spell') ||
                (selectedCard && activeCardDef?.playOnOpponentTurn) ? (
                  <button type="button" className="primary" onClick={castCard} disabled={!selectedCard}>
                    Cast selected
                  </button>
                ) : null}
                {state.turn === you && state.turnPhase === 'spell' && (
                  <button type="button" onClick={() => send({ type: 'skip_spell' })}>
                    Skip spell
                  </button>
                )}
                <button type="button" className="danger" onClick={() => send({ type: 'resign' })}>
                  Resign
                </button>
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
                    <button key={p.id} type="button" onClick={() => finishCard([pendingTargets[0], p.id])}>
                      {p.name}
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
    </div>
  );
}

function Graveyard({
  items,
  catalog,
}: {
  items: Array<{ defId: string; class: string }>;
  catalog: Catalog | null;
}) {
  if (!items.length) return <p className="muted">None</p>;
  return (
    <div className="grave">
      {items.map((g, i) => (
        <span key={`${g.defId}-${i}`}>{pieceMeta(catalog, g.defId)?.symbol ?? g.defId}</span>
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
