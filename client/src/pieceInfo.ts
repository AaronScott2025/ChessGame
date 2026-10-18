import {
  FORME_DURATION,
  FORME_FIELD_COOLDOWN,
  FORME_ORDER,
  FORME_SWAP_COOLDOWN,
  FORMES,
  TIMED_PERK,
} from '@shared/pieces/prototype.ts';

export interface PieceInfo {
  id: string;
  name: string;
  classLabel: string;
  movement: string[];
  abilities: string[];
  notes?: string[];
}

const FAR_EDGE_PROMOTION =
  'Also promotes if it lands on the far edge any other way (spell, revive, push) — that promotion does not use your turn.';

export const PIECE_INFO: Record<string, PieceInfo> = {
  pawn: {
    id: 'pawn',
    name: 'Pawn',
    classLabel: 'Pawn',
    movement: ['Moves 1 square forward.', 'First move may go up to 2 squares forward.'],
    abilities: ['Promote into a Queen or Queen variant at the far edge.', FAR_EDGE_PROMOTION],
    notes: ['Captures diagonally forward only.'],
  },
  nwap: {
    id: 'nwap',
    name: 'nwaP',
    classLabel: 'Pawn',
    movement: ['Moves 1 square diagonally forward.', 'First move may go up to 2 squares diagonally forward.'],
    abilities: ['Promote into Horse, Bishop, Wildcard, or Rook variants at the far edge.', FAR_EDGE_PROMOTION],
    notes: ['Captures straight forward only (not diagonally).'],
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    classLabel: 'Pawn',
    movement: [
      'Moves 1 square forward, or 1 square diagonally backward.',
      'First move may go up to 2 squares forward.',
    ],
    abilities: ['Promote into Bishop or Rook variants at the far edge.', FAR_EDGE_PROMOTION],
    notes: ['Captures diagonally forward, diagonally backward, or straight backward.'],
  },
  leapfrog: {
    id: 'leapfrog',
    name: 'Leapfrog',
    classLabel: 'Pawn',
    movement: ['Moves 1 square forward (cannot capture that way).'],
    abilities: [
      'Leap: jump over one adjacent allied piece in any direction, landing on the square beyond if it is a legal destination.',
      'Promote into a Queen or Queen variant at the far edge.',
      FAR_EDGE_PROMOTION,
    ],
    notes: [
      'Captures one square horizontally.',
      'May also capture on the square landed on after a Leap.',
    ],
  },
  spider: {
    id: 'spider',
    name: 'Spider',
    classLabel: 'Pawn',
    movement: [
      'Moves 1 square forward (cannot capture that way).',
      'First move may go 2 squares forward, or 1–2 squares diagonally forward.',
    ],
    abilities: [
      'Web: if captured in enemy territory, the capturing piece is webbed for 2 turns (cannot move).',
    ],
    notes: ['Captures diagonally forward only.', 'Reaching the far edge takes the Spider (it does not promote).'],
  },
  enchanted_pawn: {
    id: 'enchanted_pawn',
    name: 'Crystalite',
    classLabel: 'Pawn',
    movement: [
      'Moves 1 square orthogonally (any direction).',
      'First move may go up to 2 squares orthogonally.',
    ],
    abilities: [
      'Barrier Spell: starting army places barriers on the side frontline squares instead of those pawns.',
      'Barrier Phase: may occupy and pass through barrier tiles (click the highlighted square to walk onto it).',
      'Barrier Shift: press the Barrier Shift button, then choose a barrier and an empty allied square (uses your turn).',
    ],
    notes: ['Captures diagonally only.', 'Barriers cannot sit adjacent to each other.'],
  },
  rook: {
    id: 'rook',
    name: 'Rook',
    classLabel: 'Rook',
    movement: ['Moves any number of squares horizontally or vertically (up to 10).'],
    abilities: ['Castle: swap with an adjacent King.'],
  },
  stoneman: {
    id: 'stoneman',
    name: 'Golem',
    classLabel: 'Rook',
    movement: ['Moves up to 3 squares horizontally or vertically.'],
    abilities: [
      'Ancient Shuffle: while in allied territory, swap with an allied piece that has clear orthogonal line of sight (also in allied territory).',
    ],
    notes: ['Allied territory is the first 5 rows from your side.'],
  },
  gnome: {
    id: 'gnome',
    name: 'Gnome',
    classLabel: 'Rook',
    movement: ['Moves up to 3 squares horizontally or vertically.'],
    abilities: [
      'Gadget Deploy (once per game): place Ice Floor, Spring Board, or Gnome Hole on an adjacent empty tile.',
      'Ice Floor: pieces that land there slide one more tile in their arrival direction (cannot slide onto or capture a king).',
      'Spring Board: bounce 2 tiles in a chosen direction (captures on landing, except the king).',
      'Gnome Hole: allied pieces may travel to a gnome starting square.',
    ],
  },
  yeti: {
    id: 'yeti',
    name: 'Yeti',
    classLabel: 'Rook',
    movement: ['Moves up to 3 squares horizontally, or up to 2 squares vertically.'],
    abilities: [
      'Giga Stomp (once per game): stomp 3 tiles in any direction. Removes every allied and enemy piece in that line. The Yeti does not move. Kings are immune.',
    ],
  },
  crocodile: {
    id: 'crocodile',
    name: 'Crocodile',
    classLabel: 'Rook',
    movement: ['Moves up to 2 squares horizontally or vertically.'],
    abilities: [
      'Ultimate Suck (5-turn cooldown): grab any allied or enemy piece within 2 tiles (not a king) and launch it exactly 3 tiles in a straight line (orthogonal or diagonal). The first 2 tiles of the path must be clear.',
      'If the 3rd tile holds an enemy piece, it is captured. Kings and protected pieces cannot be captured this way.',
    ],
    notes: ['The Crocodile does not move when using Ultimate Suck. Using it takes your turn.'],
  },
  horse: {
    id: 'horse',
    name: 'Horse',
    classLabel: 'Knight',
    movement: ['Moves in an L shape (2 then 1) in any direction.'],
    abilities: ['Giddyup!: can jump over pieces.'],
  },
  snake: {
    id: 'snake',
    name: 'Snake',
    classLabel: 'Knight',
    movement: ['Moves in an L shape (2 then 1). Cannot jump over pieces or barriers normally.'],
    abilities: [
      'Bloodlust: after capturing, gain Bloodlust for 3 turns — can jump and use ±1 on an L-leg.',
      'Bloodlust does not stack; capturing again while Bloodlust is active does not renew it.',
    ],
  },
  pig: {
    id: 'pig',
    name: 'Pig',
    classLabel: 'Knight',
    movement: [
      'Day: moves in an L shape (2 then 1). Cannot jump over enemy pieces or barriers (allies on the long leg do not block).',
      'Night: moves 1 tile in any direction (a 1×1 area).',
    ],
    abilities: [
      'Best Buddy (day): may share a tile with an allied non-king piece that sits on a normal L (2–1) landing (same path rules as movement — not a teleport).',
      'While sharing, click the tile once to select the host and again to select the Pig. Moving either one ends Best Buddy.',
      'If that shared tile is captured, the Pig dies in the host’s place, the host is shoved to the nearest adjacent empty tile, and the Pig’s owner gains 2 bonus turns. If no adjacent tile is free, both fall.',
    ],
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    classLabel: 'Knight',
    movement: ['Moves 1 tile in any direction (a 1×1 area). Cannot capture by stepping onto a piece.'],
    abilities: [
      'Volley: capture an enemy on any knight L (2×1) without moving. The shot jumps over pieces.',
      'Steady Aim: if capturing a piece would apply a status effect to the Archer, ignore it.',
    ],
  },
  bishop: {
    id: 'bishop',
    name: 'Bishop',
    classLabel: 'Bishop',
    movement: ['Moves any number of squares diagonally (up to 10).'],
    abilities: [],
  },
  scamman: {
    id: 'scamman',
    name: 'Fleece',
    classLabel: 'Bishop',
    movement: ['Moves up to 4 squares diagonally.'],
    abilities: [
      'Fraudulent Fate: any non-pawn that captures this piece becomes a basic Pawn.',
      'Identity Theft (once): after capturing a piece, activate whenever you want to permanently add that piece’s movement to the Fleece, keeping its own diagonal moves (movement only, not specials). Later captures replace the stored identity until you activate.',
    ],
  },
  wizard: {
    id: 'wizard',
    name: 'Wizard',
    classLabel: 'Bishop',
    movement: ['Moves up to 3 squares diagonally.'],
    abilities: [
      'Enchant (free action — does not use your turn): give an adjacent piece +1 movement for 1 turn (4-turn cooldown).',
      'Magic Be-gone (2× per game): if both of your Wizards are alive, silence the opponent’s spells and magical abilities until the next day/night change (up to 5 turns). Uses your turn. Ends early if either of your Wizards dies.',
    ],
  },
  worm: {
    id: 'worm',
    name: 'Worm',
    classLabel: 'Bishop',
    movement: ['Moves exactly 2 squares orthogonally. The in-between square must be empty.'],
    abilities: [
      'Burrow: after the 2-step, if an allied piece is ahead and adjacent to that landing, may go to any square up to 1 tile orthogonally or 2 tiles diagonally from that ally (any direction, clear path). Further allies ahead of a square you can reach chain at 1-tile range each.',
    ],
  },
  skirmisher: {
    id: 'skirmisher',
    name: 'Skirmisher',
    classLabel: 'Bishop',
    movement: [
      'Moves up to 4 squares diagonally.',
      'Ricochet: if its diagonal reaches a board edge within those 4 squares, it may bounce off that edge at a 90° angle and carry on for up to 3 more squares.',
    ],
    abilities: [],
    notes: [
      'Only one ricochet per move, and never off a corner.',
      'It can capture at the end of either leg, but pieces block the path before and after the bounce.',
      'Lava and webs are checked along the whole ricochet route.',
    ],
  },
  queen: {
    id: 'queen',
    name: 'Queen',
    classLabel: 'Queen',
    movement: ['Moves any number of squares in any direction (up to 10).'],
    abilities: [],
  },
  spider_queen: {
    id: 'spider_queen',
    name: 'Spider Queen',
    classLabel: 'Queen',
    movement: [
      'Moves up to 3 squares in any direction (orthogonal or diagonal).',
      'While standing on any web, moves up to 4 squares instead.',
    ],
    abilities: [
      'Trail of Webs: after she leaves a square, a web is placed on that square and the tiles to her left and right of travel (horizontal move → above, origin, below).',
      'Any piece that moves onto or through a web is stopped there and stuck for 3 turns, or until that web disappears.',
      'She may have 2 web rows at once; placing a third removes the oldest row.',
    ],
    notes: ['Cannot web the Spider Queen or either King.', 'Webs are not placed on tiles occupied by allies.'],
  },
  angel: {
    id: 'angel',
    name: 'Angel',
    classLabel: 'Queen',
    movement: ['Moves 1 square in any direction.', 'Cannot capture.'],
    abilities: [
      'Revive: start a ritual lasting (8 − empty adjacent tiles) turns, minimum 1, to revive a piece from your graveyard beside the Angel.',
      'Max 4 revives — then the Angel dies.',
      'Bless: spend your turn to make an adjacent ally (not a King) uncapturable during the opponent’s next turn.',
    ],
    notes: ['Cannot revive itself or other Angels.', 'You can revive then move later, but not move then revive the same turn.'],
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    classLabel: 'Queen',
    movement: ['Moves to any tile in a 2×2 Chebyshev area around itself.'],
    abilities: ['Phase Walk: can move over pieces only during Night.'],
    notes: ['Cannot move until the first night of the game.'],
  },
  reaper: {
    id: 'reaper',
    name: 'Reaper',
    classLabel: 'Queen',
    movement: ['Moves 1 tile in any direction (range grows with charges).'],
    abilities: [
      'Gains 1 charge each night while alive (not while disabled).',
      '1+: Swap of Fates — swap with any allied piece.',
      '2+: Shadow Step — move in a 2×2 area, including over pieces.',
      '3+: Soul Lock — captures revive the victim as an ally on the Reaper’s start square (day or night).',
      '4+: Death Stare — capture in a 2×2 area without moving.',
      '5+: World Shatterer — captures also remove all enemy pieces of that class (day or night).',
      'After capturing the inverse of your charge count (1 charge → 5 captures, 5 charges → 1 capture): all charges are spent, return home, and disable for floor(charges × 2.5) turns.',
    ],
  },
  snail: {
    id: 'snail',
    name: 'Snail',
    classLabel: 'Wildcard',
    movement: ['Moves 1 tile in any direction.'],
    abilities: [
      'Trail: may move a maximum of 5 tiles per game. After that, it is immobilized permanently.',
      'If this piece captures, every enemy piece of that same class is also removed, whatever its variant (for example, capturing a Pawn also takes every enemy Rogue, nwaP, or Crystalite).',
    ],
  },
  vampire: {
    id: 'vampire',
    name: 'Vampire',
    classLabel: 'Queen',
    movement: [
      'Day: moves 1 tile in any direction.',
      'Night: the move area grows at Blood Token milestones.',
      '1 Blood Token → 1×1 area · 2 → 2×2 · 5 → 3×3 · 10 → 4×4 (max).',
    ],
    abilities: [
      'Starts with 1 Blood Token.',
      'Blood Token: gains 1 Blood Token each time it captures a piece (day or night).',
    ],
  },
  president: {
    id: 'president',
    name: 'President',
    classLabel: 'Queen',
    movement: ['Moves 1 tile in any direction (like a King).'],
    abilities: [
      'Executive Order: at the start of each day (including the first), choose 1 of 3 random laws, or skip until the next dawn. The law binds both players until the next dawn, through the whole night.',
      'Laws include frozen edge pawns, every knight forced to move like a Horse, a 3-square speed limit, no retreating, no captures on the middle ranks, a ban on magic, and more.',
      'Some laws benefit both sides: two spells per turn, pawns stepping sideways, reviving each side’s latest fallen piece, or an amnesty that clears freezes and cooldowns.',
    ],
    notes: [
      'Movement laws are lifted for a player whose King is in check, and never leave a side with no piece able to move.',
      'If both players field a President, each enacts a law and both apply.',
      'A law stays in force until dawn even if the President falls, but no new law is enacted without a President.',
    ],
  },
  merchant: {
    id: 'merchant',
    name: 'Merchant',
    classLabel: 'Queen',
    movement: ['Moves 1 square diagonally.'],
    abilities: [
      'Trade Route: earns 1 coin at the end of each of your turns that it ends in enemy territory (the opponent’s half of the board). Coins go into your purse, shown under your name.',
      'Shop (free actions on your turn, as often as you can pay): 3 coins — draw a spell card. 5 coins — give an allied non-king piece +1 range permanently. 8 coins — promote one of your pawns on the spot, wherever it stands.',
    ],
    notes: [
      'Buying does not use your turn; you can still cast and move afterwards.',
      '+1 range works like Speed+ (longer slides and jumps) and can be bought once per piece.',
      'A bought promotion that gives check ends your turn, like any free promotion.',
      'The purse belongs to you, but you can only shop while a Merchant is on the board.',
    ],
  },
  prince_princess: {
    id: 'prince_princess',
    name: 'Prince & Princess',
    classLabel: 'Wildcard',
    movement: [
      'Moves up to 3 orthogonally, or 1 diagonally.',
      'Cannot move over pieces (path must be clear for the piece you move).',
    ],
    abilities: [
      'Dance of Romance: moving one mirrors the other (horizontal directions reverse).',
      "True Love's Gambit: if one dies, the other falls too.",
    ],
    notes: [
      'If the piece you move has a clear straight-line path, its partner mirrors to the matching square even if other pieces stand in that partner’s way.',
      'The mirrored destination must still be on the board and cannot land on an allied piece.',
    ],
  },
  demon: {
    id: 'demon',
    name: 'Demon',
    classLabel: 'Wildcard',
    movement: [
      'Night: moves up to 2 tiles vertically, or 1 tile horizontally or diagonally.',
      'Day: moves only 1 tile diagonally.',
    ],
    abilities: ['Soul Syphon (night only): capturing an enemy converts it to your side.'],
    notes: ['During the day, captures are normal — the victim is taken, not converted.'],
  },
  mimic: {
    id: 'mimic',
    name: 'Mimic',
    classLabel: 'Wildcard',
    movement: ["Copies the opponent’s last played piece’s movement pattern only (not abilities)."],
    abilities: [
      'Timeless Energy: ignores day/night restrictions of the copied piece.',
      'Does not copy special abilities (Best Buddy, Ancient Shuffle, Swap of Fates, Death Stare, castling, etc.).',
    ],
    notes: ['If the opponent’s last piece was a Mimic, copy what that Mimic copied.'],
  },
  gambler: {
    id: 'gambler',
    name: 'Gambler',
    classLabel: 'Wildcard',
    movement: ['At night, moves 1 square diagonally only.'],
    abilities: [
      'Lucky Draw: each day, randomly copies the movement of some piece in the game (not its abilities).',
    ],
    notes: [
      'Both Gamblers cannot share the same movement style at the same time.',
      'Cannot roll the same movement style two days in a row.',
    ],
  },
  timekeeper: {
    id: 'timekeeper',
    name: 'TimeKeeper',
    classLabel: 'Wildcard',
    movement: [
      'Day: moves like a Bishop (any number of diagonal squares).',
      'Night: moves like a Knight (L-shape, can jump).',
    ],
    abilities: [
      'Temporal Shift (once): skip to the opposite phase, or revert the last day/night change. Affects day/night pieces; does not undo card draws.',
    ],
  },
  prototype: {
    id: 'prototype',
    name: 'The Prototype',
    classLabel: 'Wildcard',
    movement: [
      'Depends on its forme (eye color). Starts in Speed Forme.',
      ...FORME_ORDER.map(
        (id) =>
          `${FORMES[id].name} (${FORMES[id].eyes} eyes): ${FORMES[id].perks.filter((p) => p !== TIMED_PERK).join(' ')}`,
      ),
    ],
    abilities: [
      `Forme Swap: switch this Prototype to another forme without using your turn. ${FORME_SWAP_COOLDOWN}-turn cooldown, shared by both of your Prototypes (only one can swap at a time).`,
      'Neither Prototype can move on the turn you swap.',
      `Attack, Defense and Temporal Forme each last ${FORME_DURATION} turns (the swap turn plus ${FORME_DURATION - 1} more). Then the Prototype shuts down for 1 turn and returns to Speed Forme.`,
    ],
    notes: [
      `Defense drones and entering Temporal Forme each have a ${FORME_FIELD_COOLDOWN}-turn cooldown.`,
      'Temporal Forme cannot freeze Kings, and frozen pieces still give check.',
      'Attack Forme’s bonus move is skipped if the capture gives check.',
    ],
  },
  musician: {
    id: 'musician',
    name: 'Musician',
    classLabel: 'Wildcard',
    movement: [
      'Follows a 4-beat rhythm. The beat moves on at the end of each of your turns (the 4 dots above her show it).',
      'Beat 1 · Forte: up to 3 squares orthogonally. The only beat she can capture on.',
      'Beat 2 · Staccato: 1 square diagonally (no capture).',
      'Beat 3 · Leap: Knight jump (no capture).',
      'Beat 4 · Rest: cannot move, but plays one song as a free action.',
    ],
    abilities: [
      'Day songs — March: every allied pawn within 2 squares steps 1 square forward. Encore: an allied non-king piece within 2 squares makes one move now (no capture), then your turn continues.',
      'Night songs — Lullaby: enemy non-king pieces within 2 squares fall asleep and cannot move on their next turn. Discord: enemy non-king pieces within 2 squares are knocked 2 squares straight away from her.',
      'Crescendo: play the same song on two Rest beats in a row (moving no more than 1 square in between) to empower it. March and Lullaby reach 3 squares, Encore’s move may capture (not the King), and Discord knocks back 3 squares.',
      'Final Note: if the Musician is captured, every piece her Lullaby put to sleep wakes up.',
    ],
    notes: [
      'A sleeping piece wakes early if a piece next to it is captured.',
      'Discord pushes stop at pieces, barriers and the board edge. Pieces knocked into lava burn, into a web get stuck, and onto Ice Floor slide 1 more square.',
      'Songs are magic: Magic Be-gone silences them. Songs cannot be played while you are in check, and a song or Encore move that gives check ends your turn.',
    ],
  },
  drone: {
    id: 'drone',
    name: 'Attack Drone',
    classLabel: 'Wildcard',
    movement: ['Moves up to 2 squares orthogonally (cannot capture this way).'],
    abilities: ['Captures like a King: any adjacent enemy.'],
    notes: ['Deployed by a Prototype in Defense Forme when a nearby ally is captured.'],
  },
  king: {
    id: 'king',
    name: 'King',
    classLabel: 'King',
    movement: ['Moves 1 tile in any direction (more if under speed effects).'],
    abilities: ['Castle: swap with an adjacent Rook.'],
    notes: ['Losing the King ends the game.'],
  },
};

export function getPieceInfo(defId: string): PieceInfo {
  return (
    PIECE_INFO[defId] ?? {
      id: defId,
      name: defId.replace(/(^|_)([a-z])/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase()),
      classLabel: 'Unknown',
      movement: ['No details available.'],
      abilities: [],
    }
  );
}
