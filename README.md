# Chesspansion

Online 10×10 chess expansion with army drafting, day/night, and a modular spell-card system.

## Play locally

```bash
npm install
npm --prefix client install
npm run dev
```

- Client: http://localhost:5173  
- Server: http://localhost:3001  

1. One player clicks **Create room** and shares the 5-character code.  
2. The other clicks **Join** with that code.  
3. Black chooses who drafts first, both players pick variants, then opening hands, then play.

## Host online (play with a friend)

Build the client, then run one Node process (serves UI + WebSockets):

```bash
npm --prefix client run build
npm start
```

Deploy that process to any Node host (Railway, Render, Fly.io, a VPS). Set `PORT` if the host requires it.

Examples:

### Railway / Render
- Root directory: repo root
- Build: `npm install && npm --prefix client install && npm --prefix client run build`
- Start: `npm start`

Share your public URL. Friend opens it, joins with your room code.

## Project layout

```
shared/src/          # game rules (pieces, cards, engine) — shared by server
server/src/          # Express + Socket.IO rooms
client/              # React UI
client/public/cards/ # card art
```

## Add a new card (no spaghetti)

1. Drop art into `client/public/cards/MyCard.png`
2. Register the card in `shared/src/cards/definitions.ts` (or a new file imported from `cards/index.ts`):

```ts
registerCard({
  id: 'my_card',
  name: 'My Card',
  description: ['Does a thing.'],
  image: '/cards/MyCard.png',
  targeting: 'allied_piece', // or 'none' | 'piece' | 'empty_allied' | ...
  play: (ctx, targets) => {
    // mutate ctx.state, then:
    return { state: ctx.state, done: true };
  },
});
```

3. Restart the server. The deck builder and UI catalog pick it up automatically.

See `ADDING_CARDS.md` for targeting modes and effect helpers.

## Add a piece variant

Add an entry to `shared/src/pieces/index.ts` in `PIECES` and include its id in `VARIANTS_BY_CLASS`.
