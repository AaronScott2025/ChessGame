import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import {
  applyMove,
  availableAbilities,
  chooseFirstPicker,
  createLobbyState,
  draftPick,
  getDraftOptions,
  listMoves,
  openingKeep,
  openingRedraw,
  playCard,
  publicState,
  cancelPrompt,
  resolvePrompt,
  skipSpell,
  startDraft,
  useAbility,
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
}

const rooms = new Map<string, Room>();

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

function emitRoom(room: Room): void {
  for (const color of ['white', 'black'] as Color[]) {
    const sid = room.sockets[color];
    if (!sid) continue;
    io.to(sid).emit('state', {
      state: publicState(room.state, color),
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
  socket.on('create_room', (payload: { name?: string }, ack?: (r: unknown) => void) => {
    let roomCode = code();
    while (rooms.has(roomCode)) roomCode = code();
    const state = createLobbyState(roomCode);
    const room: Room = { code: roomCode, state, sockets: { white: socket.id } };
    state.players.white.connected = true;
    state.players.white.name = payload?.name?.trim() || 'White';
    rooms.set(roomCode, room);
    socket.join(roomCode);
    ack?.({ ok: true, code: roomCode, color: 'white' });
    emitRoom(room);
  });

  socket.on('join_room', (payload: { code: string; name?: string }, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(payload.code);
      let color: Color;
      if (!room.sockets.white) color = 'white';
      else if (!room.sockets.black) color = 'black';
      else {
        ack?.({ ok: false, error: 'Room full' });
        return;
      }
      room.sockets[color] = socket.id;
      room.state.players[color].connected = true;
      room.state.players[color].name = payload?.name?.trim() || (color === 'white' ? 'White' : 'Black');
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
      room.state = reduce(room.state, color, payload.action);
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

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      for (const color of ['white', 'black'] as Color[]) {
        if (room.sockets[color] === socket.id) {
          room.sockets[color] = undefined;
          room.state.players[color].connected = false;
          emitRoom(room);
        }
      }
    }
  });
});

function reduce(state: GameState, color: Color, action: ClientAction): GameState {
  switch (action.type) {
    case 'set_name':
      state.players[color].name = action.name;
      return state;
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
    case 'resign':
      state.phase = 'ended';
      state.winner = color === 'white' ? 'black' : 'white';
      state.winReason = `${color} resigned`;
      return state;
    default:
      throw new Error(`Unknown action: ${(action as { type?: string })?.type ?? 'undefined'}`);
  }
}

const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
  console.log(`Chesspansion server on http://localhost:${PORT}`);
});
