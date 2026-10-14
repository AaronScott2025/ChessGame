import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import {
  availableAbilities,
  createLobbyState,
  forceTimeoutMove,
  getDraftOptions,
  listMoves,
  publicState,
  seatDisplayName,
  startDraft,
  syncTurnTimer,
  turnTimerExpired,
  applyClientAction,
  type ClientAction,
  type Color,
  type GameState,
  PIECES,
  CARD_REGISTRY,
} from '../../shared/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const clientDist = path.join(root, 'client', 'dist');
const clientPublic = path.join(root, 'client', 'public');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/cards', express.static(path.join(clientPublic, 'cards')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ['GET', 'POST'] },
});

interface Room {
  code: string;
  state: GameState;
  sockets: Partial<Record<Color, string>>;
  password?: string;
  createdAt: number;
  emptySince?: number;
  timerHandle?: ReturnType<typeof setTimeout>;
}

interface RoomSummary {
  code: string;
  host: string;
  locked: boolean;
  banPhase: boolean;
  anonymous: boolean;
  turnTimerSeconds: number | null;
  phase: GameState['phase'];
  players: number;
  joinable: boolean;
  createdAt: number;
}

interface CreateRoomPayload {
  name?: string;
  rules?: { banPhase?: unknown; anonymous?: unknown; turnTimerSeconds?: unknown };
  password?: unknown;
}

interface JoinRoomPayload {
  code: string;
  name?: string;
  password?: unknown;
}

const rooms = new Map<string, Room>();
const ROOM_BROWSER = 'room-browser';
const EMPTY_ROOM_TTL_MS = 2 * 60 * 1000;
const MAX_PASSWORD_LENGTH = 32;
let lastRoomListJson = '';

function roomSummary(room: Room): RoomSummary {
  const players = Number(Boolean(room.sockets.white)) + Number(Boolean(room.sockets.black));
  return {
    code: room.code,
    host: room.state.players.white.name || 'White',
    locked: Boolean(room.password),
    banPhase: room.state.rules?.banPhase !== false,
    anonymous: Boolean(room.state.rules?.anonymous),
    turnTimerSeconds: room.state.rules?.turnTimerSeconds ?? null,
    phase: room.state.phase,
    players,
    joinable: players < 2 && room.state.phase !== 'ended',
    createdAt: room.createdAt,
  };
}

function listRooms(): RoomSummary[] {
  return [...rooms.values()]
    .filter((r) => r.sockets.white || r.sockets.black)
    .map(roomSummary)
    .sort((a, b) => Number(b.joinable) - Number(a.joinable) || b.createdAt - a.createdAt);
}

function broadcastRooms(): void {
  const list = listRooms();
  const json = JSON.stringify(list);
  if (json === lastRoomListJson) return;
  lastRoomListJson = json;
  io.to(ROOM_BROWSER).emit('rooms', list);
}

function cleanupEmptyRooms(): void {
  const now = Date.now();
  for (const [key, room] of rooms) {
    if (room.sockets.white || room.sockets.black) {
      room.emptySince = undefined;
    } else if (room.emptySince == null) {
      room.emptySince = now;
    } else if (now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      if (room.timerHandle) clearTimeout(room.timerHandle);
      rooms.delete(key);
    }
  }
}

setInterval(() => {
  cleanupEmptyRooms();
  broadcastRooms();
}, 30_000);

function code(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function getRoom(roomCode: string): Room {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error('Room not found');
  return room;
}

function colorOf(room: Room, socketId: string): Color | null {
  if (room.sockets.white === socketId) return 'white';
  if (room.sockets.black === socketId) return 'black';
  return null;
}

function scheduleTurnTimeout(room: Room): void {
  if (room.timerHandle) clearTimeout(room.timerHandle);
  room.timerHandle = undefined;
  const deadline = room.state.turnTimer?.deadline;
  if (deadline == null) return;
  room.timerHandle = setTimeout(() => {
    room.timerHandle = undefined;
    if (!rooms.has(room.code) || (!room.sockets.white && !room.sockets.black)) return;
    if (turnTimerExpired(room.state, Date.now())) {
      try {
        room.state = forceTimeoutMove(room.state);
      } catch (e) {
        console.error(`Turn timeout failed in room ${room.code}:`, e);
      }
      const timer = room.state.turnTimer;
      if (timer && turnTimerExpired(room.state, Date.now())) {
        timer.deadline = Date.now() + timer.durationMs;
      }
    }
    emitRoom(room);
  }, Math.max(0, deadline - Date.now()) + 50);
}

function emitRoom(room: Room): void {
  syncTurnTimer(room.state, Date.now());
  scheduleTurnTimeout(room);
  for (const color of ['white', 'black'] as Color[]) {
    const sid = room.sockets[color];
    if (!sid) continue;
    io.to(sid).emit('state', {
      state: publicState(room.state, color),
      serverNow: Date.now(),
      you: color,
      legalMoves: {},
      draftOptions: getDraftOptions(room.state),
      catalog: {
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
      },
    });
  }
  // spectators / lobby
  io.to(room.code).emit('room_meta', {
    code: room.code,
    players: {
      white: Boolean(room.sockets.white),
      black: Boolean(room.sockets.black),
    },
    phase: room.state.phase,
  });
  broadcastRooms();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(clientDist));
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/socket.io') || req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

io.on('connection', (socket) => {
  socket.on('list_rooms', (_payload: unknown, ack?: (r: unknown) => void) => {
    socket.join(ROOM_BROWSER);
    ack?.({ ok: true, rooms: listRooms() });
  });

  socket.on('unlist_rooms', () => {
    socket.leave(ROOM_BROWSER);
  });

  socket.on('create_room', (payload: CreateRoomPayload, ack?: (r: unknown) => void) => {
    let roomCode = code();
    while (rooms.has(roomCode)) roomCode = code();
    const password = typeof payload?.password === 'string' ? payload.password.trim() : '';
    if (password.length > MAX_PASSWORD_LENGTH) {
      ack?.({ ok: false, error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer` });
      return;
    }
    const state = createLobbyState(roomCode, Date.now(), payload?.rules ?? {});
    const room: Room = {
      code: roomCode,
      state,
      sockets: { white: socket.id },
      password: password || undefined,
      createdAt: Date.now(),
    };
    state.players.white.connected = true;
    state.players.white.name = seatDisplayName(state, 'white', payload?.name);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    ack?.({ ok: true, code: roomCode, color: 'white' });
    emitRoom(room);
  });

  socket.on('join_room', (payload: JoinRoomPayload, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(String(payload?.code ?? ''));
      if (room.password) {
        const given = typeof payload?.password === 'string' ? payload.password.trim() : '';
        if (given !== room.password) {
          ack?.({
            ok: false,
            needsPassword: true,
            error: given ? 'Wrong password' : 'This room is password protected',
          });
          return;
        }
      }
      let color: Color;
      if (!room.sockets.white) color = 'white';
      else if (!room.sockets.black) color = 'black';
      else {
        ack?.({ ok: false, error: 'Room full' });
        return;
      }
      room.sockets[color] = socket.id;
      room.state.players[color].connected = true;
      room.state.players[color].name = seatDisplayName(room.state, color, payload?.name);
      socket.join(room.code);
      if (room.sockets.white && room.sockets.black && room.state.phase === 'lobby') {
        room.state = startDraft(room.state);
      }
      ack?.({ ok: true, code: room.code, color });
      emitRoom(room);
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
    }
  });

  socket.on('action', (payload: { code: string; action: ClientAction }, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(payload.code);
      const color = colorOf(room, socket.id);
      if (!color) throw new Error('Not a player in this room');
      room.state = applyClientAction(room.state, color, payload.action);
      ack?.({ ok: true });
      emitRoom(room);
      // also send legal moves for current player piece selections via separate event if needed
      const you = color;
      if (room.state.phase === 'playing' && room.state.turn === you) {
        const moves: Record<string, ReturnType<typeof listMoves>> = {};
        for (const p of room.state.pieces.filter((x) => x.color === you)) {
          moves[p.id] = listMoves(room.state, p.id);
        }
        socket.emit('legal_moves', moves);
      }
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
      socket.emit('error_message', (e as Error).message);
    }
  });

  socket.on('get_moves', (payload: { code: string; pieceId: string }, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(payload.code);
      const color = colorOf(room, socket.id);
      if (!color) throw new Error('Spectating');
      const piece = room.state.pieces.find((p) => p.id === payload.pieceId);
      if (!piece || piece.color !== color) throw new Error('Not your piece');
      ack?.({
        ok: true,
        moves: listMoves(room.state, payload.pieceId),
        abilities: availableAbilities(room.state, payload.pieceId),
      });
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
    }
  });

  const releaseSeats = (onlyCode?: string) => {
    for (const room of rooms.values()) {
      if (onlyCode && room.code !== onlyCode.toUpperCase()) continue;
      for (const color of ['white', 'black'] as Color[]) {
        if (room.sockets[color] === socket.id) {
          room.sockets[color] = undefined;
          room.state.players[color].connected = false;
          socket.leave(room.code);
          emitRoom(room);
        }
      }
    }
  };

  socket.on('leave_room', (payload: { code?: string }) => {
    if (typeof payload?.code === 'string') releaseSeats(payload.code);
  });

  socket.on('disconnect', () => {
    releaseSeats();
  });
});

const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
  console.log(`Chesspansion server on http://localhost:${PORT}`);
});
