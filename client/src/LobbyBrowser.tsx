import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

type Color = 'white' | 'black';

export interface RoomSummary {
  code: string;
  host: string;
  locked: boolean;
  banPhase: boolean;
  anonymous?: boolean;
  turnTimerSeconds?: number | null;
  cardsDisabled?: boolean;
  noDupes?: boolean;
  phase: string;
  players: number;
  joinable: boolean;
  createdAt: number;
}

interface JoinResult {
  ok: boolean;
  code?: string;
  color?: Color;
  error?: string;
  needsPassword?: boolean;
}

function roomStatus(room: RoomSummary): { label: string; tone: 'open' | 'busy' | 'closed' } {
  if (room.phase === 'lobby' && room.joinable) return { label: 'Waiting for opponent', tone: 'open' };
  if (room.phase === 'ended') return { label: 'Finished', tone: 'closed' };
  if (room.joinable) return { label: 'In progress · seat open', tone: 'busy' };
  return { label: 'In progress · full', tone: 'closed' };
}

export function LobbyBrowser({
  open,
  onClose,
  socket,
  name,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  socket: Socket | null;
  name: string;
  onJoined: (code: string, color: Color) => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !socket) return;
    const onRooms = (list: RoomSummary[]) => setRooms(list);
    socket.on('rooms', onRooms);
    const subscribe = () =>
      socket.emit('list_rooms', {}, (res: { ok: boolean; rooms?: RoomSummary[] }) => {
        if (res?.ok) setRooms(res.rooms ?? []);
      });
    subscribe();
    socket.on('connect', subscribe);
    return () => {
      socket.off('rooms', onRooms);
      socket.off('connect', subscribe);
      socket.emit('unlist_rooms');
    };
  }, [open, socket]);

  useEffect(() => {
    if (!open) {
      setPasswordFor(null);
      setPassword('');
      setError(null);
      setBusy(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (passwordFor) passwordRef.current?.focus();
  }, [passwordFor]);

  if (!open) return null;

  const join = (code: string, pw?: string) => {
    const roomCode = code.trim().toUpperCase();
    if (!roomCode) return setError('Enter a room code');
    if (!socket?.connected) return setError('Not connected to the server');
    setBusy(true);
    setError(null);
    socket.emit('join_room', { code: roomCode, name, password: pw }, (res: JoinResult) => {
      setBusy(false);
      if (res.ok && res.code && res.color) {
        onJoined(res.code, res.color);
        return;
      }
      if (res.needsPassword) {
        if (passwordFor !== roomCode) setPassword('');
        setPasswordFor(roomCode);
        if (pw) setError(res.error ?? 'Wrong password');
        return;
      }
      setError(res.error ?? 'Join failed');
    });
  };

  const passwordForm = (code: string) => (
    <form
      className="lobby-password"
      onSubmit={(e) => {
        e.preventDefault();
        join(code, password);
      }}
    >
      <input
        ref={passwordRef}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Room password"
        aria-label={`Password for room ${code}`}
        maxLength={32}
        autoComplete="off"
      />
      <button type="submit" className="primary" disabled={busy || !password}>
        Unlock
      </button>
      <button
        type="button"
        onClick={() => {
          setPasswordFor(null);
          setError(null);
        }}
      >
        Cancel
      </button>
    </form>
  );

  const listedCodes = new Set((rooms ?? []).map((r) => r.code));

  return (
    <div className="lobby-browser-backdrop" role="presentation" onClick={onClose}>
      <section
        className="lobby-browser"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lobby-browser-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="lobby-browser-head">
          <div>
            <p className="lobby-browser-kicker">Online</p>
            <h2 id="lobby-browser-title">Join lobby</h2>
          </div>
          <button type="button" className="lobby-browser-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="lobby-browser-list" aria-live="polite">
          {rooms == null ? (
            <p className="lobby-browser-empty">Loading rooms…</p>
          ) : rooms.length === 0 ? (
            <p className="lobby-browser-empty">No games are hosted right now. Create one from the home screen!</p>
          ) : (
            rooms.map((room) => {
              const status = roomStatus(room);
              const prompting = passwordFor === room.code;
              return (
                <article key={room.code} className={`lobby-room tone-${status.tone}`}>
                  <div className="lobby-room-main">
                    <div className="lobby-room-title">
                      <span className="lobby-room-lock" title={room.locked ? 'Password protected' : 'Open'}>
                        {room.locked ? '🔒' : '🔓'}
                      </span>
                      <strong>{room.anonymous ? 'Anonymous room' : `${room.host}'s room`}</strong>
                      <code>{room.code}</code>
                    </div>
                    <div className="lobby-room-tags">
                      <span className={`lobby-room-status ${status.tone}`}>{status.label}</span>
                      <span className="lobby-room-tag">{room.players}/2 players</span>
                      <span className="lobby-room-tag">Bans {room.banPhase ? 'on' : 'off'}</span>
                      {room.turnTimerSeconds ? (
                        <span className="lobby-room-tag is-fast">⏱ {room.turnTimerSeconds}s/turn</span>
                      ) : null}
                      {room.anonymous && <span className="lobby-room-tag">Anonymous</span>}
                      {room.cardsDisabled && <span className="lobby-room-tag">No cards</span>}
                      {room.noDupes && <span className="lobby-room-tag">No Dupes</span>}
                    </div>
                  </div>
                  {!prompting && (
                    <button
                      type="button"
                      className="primary lobby-room-join"
                      disabled={!room.joinable || busy}
                      onClick={() => {
                        if (!room.locked) return join(room.code);
                        setPasswordFor(room.code);
                        setPassword('');
                        setError(null);
                      }}
                    >
                      {room.joinable ? (room.locked ? 'Join 🔒' : 'Join') : 'Full'}
                    </button>
                  )}
                  {prompting && passwordForm(room.code)}
                </article>
              );
            })
          )}
        </div>

        <footer className="lobby-browser-foot">
          <form
            className="lobby-code-join"
            onSubmit={(e) => {
              e.preventDefault();
              join(codeInput);
            }}
          >
            <label htmlFor="lobby-code-input">Have a room code?</label>
            <div className="lobby-code-row">
              <input
                id="lobby-code-input"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="ROOM"
                maxLength={5}
                autoComplete="off"
              />
              <button type="submit" disabled={busy || !codeInput.trim()}>
                Join
              </button>
            </div>
          </form>
          {passwordFor && !listedCodes.has(passwordFor) && (
            <div className="lobby-code-password">
              <p>
                Room <code>{passwordFor}</code> is password protected.
              </p>
              {passwordForm(passwordFor)}
            </div>
          )}
          {error && <p className="error lobby-browser-error">{error}</p>}
        </footer>
      </section>
    </div>
  );
}
