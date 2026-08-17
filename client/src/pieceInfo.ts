export interface PieceInfo {
  id: string;
  name: string;
  classLabel: string;
  movement: string[];
  abilities: string[];
  misc?: string[];
}

export const PIECE_INFO: Record<string, PieceInfo> = {
  pawn: {
    id: 'pawn',
    name: 'Pawn',
    classLabel: 'Pawn',
    movement: ['Moves 1 square forward.', 'First move may go up to 2 squares forward.'],
    abilities: ['Promote into a Queen or Queen variant at the far edge.'],
    misc: ['Captures diagonally forward only.'],
  },
  nwap: {
    id: 'nwap',
    name: 'nwaP',
    classLabel: 'Pawn',
    movement: ['Moves 1 square diagonally forward.', 'First move may go up to 2 squares diagonally forward.'],
    abilities: ['Promote into Horse, Bishop, Wildcard, or Rook variants at the far edge.'],
    misc: ['Captures straight forward only (not diagonally).'],
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    classLabel: 'Pawn',
    movement: [
      'Moves 1 square forward, or 1 square diagonally backward.',
      'First move may go up to 2 squares diagonally forward.',
    ],
    abilities: ['Promote into Bishop or Rook variants at the far edge.'],
    misc: ['Captures diagonally forward, diagonally backward, or straight backward.'],
  },
  enchanted_pawn: {
    id: 'enchanted_pawn',
    name: 'Enchanted Pawn',
    classLabel: 'Pawn',
    movement: [
      'Moves 1 square orthogonally (any direction).',
      'First move may go up to 2 squares orthogonally.',
    ],
    abilities: [
      'Barrier Spell: starting army places barriers on the side frontline squares instead of those pawns.',
      'Barrier Shift: move a barrier to an empty allied-territory square (uses your turn).',
      'Barrier Phase: can move over barriers.',
      'Promote into Rook variants at the far edge.',
    ],
    misc: ['Captures diagonally only.', 'Barriers cannot sit adjacent to each other.'],
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
    name: 'Stoneman',
    classLabel: 'Rook',
    movement: ['Moves up to 3 squares horizontally or vertically.'],
    abilities: [
      'Ancient Shuffle: while in allied territory, swap with an allied piece that has clear orthogonal line of sight (also in allied territory).',
    ],
    misc: ['Allied territory is the first 5 rows from your side.'],
  },
  gnome: {
    id: 'gnome',
    name: 'Gnome',
    classLabel: 'Rook',
    movement: ['Moves up to 2 squares horizontally or vertically.'],
    abilities: [
      'Gadget Deploy (once per game): place Ice Floor, Spring Board, or Gnome Hole on an adjacent empty tile.',
      'Ice Floor: pieces that land there slide one more tile in their arrival direction.',
      'Spring Board: bounce 2 tiles in a chosen direction (captures on landing).',
      'Gnome Hole: allied pieces may travel to a gnome starting square.',
    ],
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
    movement: ['Moves in an L shape (3 then 1). Cannot jump over pieces normally.'],
    abilities: [
      'Bloodlust: after capturing, on the Snake’s next move it gains ±1 on an L-leg and can jump over pieces.',
    ],
  },
  pig: {
    id: 'pig',
    name: 'Pig',
    classLabel: 'Knight',
    movement: ['Moves in an L shape (2 then 1). Cannot jump over pieces.'],
    abilities: [
      'Best Buddy: may share a tile with an allied non-king piece that sits on a normal L (2–1) landing (same path rules as movement — not a teleport).',
      'If that shared tile is captured, both pieces fall and you gain up to 3 bonus turns.',
    ],
    misc: ['Can only act during the day.'],
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
    name: 'TheScamMan',
    classLabel: 'Bishop',
    movement: ['Moves 1 square diagonally.'],
    abilities: [
      'Fraudulent Fate: any non-pawn that captures this piece becomes a basic Pawn.',
    ],
  },
  wizard: {
    id: 'wizard',
    name: 'Wizard',
    classLabel: 'Bishop',
    movement: ['Moves up to 2 squares diagonally.'],
    abilities: [
      'Enchant: give an adjacent piece +1 movement for 2 turns (4-turn cooldown).',
    ],
  },
  queen: {
    id: 'queen',
    name: 'Queen',
    classLabel: 'Queen',
    movement: ['Moves any number of squares in any direction (up to 10).'],
    abilities: [],
  },
  angel: {
    id: 'angel',
    name: 'Angel',
    classLabel: 'Queen',
    movement: [
      'Moves 1 square orthogonally.',
      'Cannot move on consecutive turns.',
      'Cannot capture.',
    ],
    abilities: [
      'Revive: start a ritual lasting (10 − empty adjacent tiles) turns to revive a piece from your graveyard beside the Angel.',
      'Max 3 revives — then the Angel dies.',
    ],
    misc: ['Cannot revive itself or other Angels.', 'You can revive then move later, but not move then revive the same turn.'],
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    classLabel: 'Queen',
    movement: ['Moves to any tile in a 2×2 Chebyshev area around itself.'],
    abilities: ['Phase Walk: can pass through pieces (like the Horse).'],
    misc: ['Cannot move until the first night of the game.'],
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
      '3+: Soul Lock — night captures may revive the victim as an ally on the Reaper’s start square.',
      '4+: Death Stare — capture in a 2×2 area without moving.',
      '5+: World Shatterer — night captures also remove all enemy pieces of that class.',
      'After spending charges on a capture: return home and disable for floor(charges × 2.5) turns.',
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
    misc: [
      'If the piece you move has a clear straight-line path, its partner mirrors to the matching square even if other pieces stand in that partner’s way.',
      'The mirrored destination must still be on the board and cannot land on an allied piece.',
    ],
  },
  demon: {
    id: 'demon',
    name: 'Demon',
    classLabel: 'Wildcard',
    movement: ['Moves 1 tile in any direction.'],
    abilities: ['Soul Syphon: capturing an enemy converts it to your side.'],
    misc: ['Cannot move during the day.'],
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
    misc: ['If the opponent’s last piece was a Mimic, copy what that Mimic copied.'],
  },
  king: {
    id: 'king',
    name: 'King',
    classLabel: 'King',
    movement: ['Moves 1 tile in any direction (more if under speed effects).'],
    abilities: [],
    misc: ['Losing the King ends the game.'],
  },
};

export function getPieceInfo(defId: string): PieceInfo {
  return (
    PIECE_INFO[defId] ?? {
      id: defId,
      name: defId,
      classLabel: 'Unknown',
      movement: ['No details available.'],
      abilities: [],
    }
  );
}
