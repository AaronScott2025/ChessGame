# Adding cards

Cards are data + one `play` function. The UI and deck do not hard-code card names.

## Register

```ts
// shared/src/cards/definitions.ts
import { registerCard, requirePiece } from './registry.js';
import { addEffect } from '../utils.js';

registerCard({
  id: 'example',
  name: 'Example',
  description: ['Give an allied piece +1 movement.'],
  image: '/cards/Example.png',
  copiesInDeck: 2,
  targeting: 'allied_piece',
  tags: [], // add 'rally' for opening-hand ban; 'instant' for flavor; 'persistent' if face-up ongoing
  playOnOpponentTurn: false,
  canPlay: (ctx) => null, // or return an error string
  play: (ctx, targets) => {
    if (!targets.length) {
      return { state: ctx.state, done: false, message: 'Pick an allied piece' };
    }
    const piece = requirePiece(ctx.state, targets[0] as string);
    addEffect(piece, {
      id: `ex_${piece.id}`,
      kind: 'mathematical',
      sourceCardId: 'example',
    });
    return { state: ctx.state, done: true };
  },
});
```

If you put the card in a new file, import that file from `shared/src/cards/index.ts`:

```ts
import './myNewCards.js';
```

## Targeting modes

| Mode | Player selects |
|------|----------------|
| `none` | Nothing — resolves immediately |
| `piece` | Any piece |
| `allied_piece` | Your piece |
| `enemy_piece` | Opponent piece |
| `any_piece_non_king` | Any non-king |
| `empty_allied` | Empty square in your half (rows) |
| `empty_any` | Empty square |
| `multi_allied` | Several allied pieces (`targetCount`) |
| `graveyard` | Fallen piece + square |
| `variant_choice` | Piece definition id |

Return `{ done: false, message }` when more input is needed; `{ done: true }` when finished. The engine discards the card from hand when done.

## Ongoing effects

Use `piece.effects` with a `kind` string and optional `turnsRemaining`. Tick logic lives in `tickEffectsOnTurnEnd` in `shared/src/engine/game.ts`. Prefer new `kind` values over special-casing card ids in the move generator.
