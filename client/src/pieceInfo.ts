export interface PieceInfo {
  id: string;
  name: string;
  classLabel: string;
  movement: string[];
  abilities: string[];
  notes?: string[];
}

export const PIECE_INFO: Record<string, PieceInfo> = {
  pawn: {
    id: 'pawn',
    name: 'Pawn',
    classLabel: 'Pawn',
    movement: ['Moves 1 square forward.', 'First move may go up to 2 squares forward.'],
    abilities: ['Promote into a Queen or Queen variant at the far edge.'],
    notes: ['Captures diagonally forward only.'],
  },
  nwap: {
    id: 'nwap',
    name: 'nwaP',
    classLabel: 'Pawn',
    movement: ['Moves 1 square diagonally forward.', 'First move may go up to 2 squares diagonally forward.'],
    abilities: ['Promote into Horse, Bishop, Wildcard, or Rook variants at the far edge.'],
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
    abilities: ['Promote into Bishop or Rook variants at the far edge.'],
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
      'Web: if captured, the capturing piece is webbed for 1 turn (cannot move).',
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
    movement: ['Moves up to 2 squares horizontally or vertically.'],
    abilities: [
      'Gadget Deploy (once per game): place Ice Floor, Spring Board, or Gnome Hole on an adjacent empty tile.',
      'Ice Floor: pieces that land there slide one more tile in their arrival direction (cannot slide onto or capture a king).',
      'Spring Board: bounce 2 tiles in a chosen direction (captures on landing, except the king).',
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
    movement: ['Moves in an L shape (2 then 1). Cannot jump over pieces or barriers normally.'],
    abilities: [
      'Bloodlust: after capturing, on the Snake’s next move it gains ±1 on an L-leg and can jump over pieces.',
    ],
  },
  pig: {
    id: 'pig',
    name: 'Pig',
    classLabel: 'Knight',
    movement: [
      'Moves in an L shape (2 then 1). Cannot jump over enemy pieces or barriers (allies on the long leg do not block).',
    ],
    abilities: [
      'Best Buddy: may share a tile with an allied non-king piece that sits on a normal L (2–1) landing (same path rules as movement — not a teleport).',
      'If that shared tile is captured, both pieces fall and the Pig’s owner gains 3 bonus turns.',
    ],
    notes: ['Can only act during the day.'],
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
    movement: ['Moves 1 square diagonally.'],
    abilities: [
      'Fraudulent Fate: any non-pawn that captures this piece becomes a basic Pawn.',
      'Identity Theft (once): after capturing a piece, activate whenever you want to permanently move like that piece (movement only, not specials). Later captures replace the stored identity until you activate.',
    ],
  },
  wizard: {
    id: 'wizard',
    name: 'Wizard',
    classLabel: 'Bishop',
    movement: ['Moves up to 2 squares diagonally.'],
    abilities: [
      'Enchant: give an adjacent piece +1 movement for 2 turns (4-turn cooldown).',
      'Magic Be-gone (2× per game): if both of your Wizards are alive, silence the opponent’s spells and magical abilities until the next day/night change (up to 5 turns). Uses your turn. Ends early if either of your Wizards dies.',
    ],
  },
  worm: {
    id: 'worm',
    name: 'Worm',
    classLabel: 'Bishop',
    movement: ['Moves exactly 2 squares orthogonally. The in-between square must be empty.'],
    abilities: [
      'Burrow: after the 2-step, if an allied piece is ahead and adjacent to that landing, may go to any square up to 2 tiles from that ally (any direction, clear path). Further allies ahead of a square you can reach chain at 1-tile range each.',
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
    movement: ['Moves up to 4 squares in any direction (orthogonal or diagonal).'],
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
    movement: [
      'Moves 1 square orthogonally.',
      'Cannot move on consecutive turns.',
      'Cannot capture.',
    ],
    abilities: [
      'Revive: start a ritual lasting (10 − empty adjacent tiles) turns to revive a piece from your graveyard beside the Angel.',
      'Max 3 revives — then the Angel dies.',
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
      '3+: Soul Lock — night captures may revive the victim as an ally on the Reaper’s start square.',
      '4+: Death Stare — capture in a 2×2 area without moving.',
      '5+: World Shatterer — night captures also remove all enemy pieces of that class.',
      'After capturing the inverse of your charge count (1 charge → 5 captures, 5 charges → 1 capture): return home and disable for floor(charges × 2.5) turns.',
    ],
  },
  snail: {
    id: 'snail',
    name: 'Snail',
    classLabel: 'Queen',
    movement: ['Moves 1 tile in any direction.'],
    abilities: [
      'Trail: may move a maximum of 8 tiles per game. After that, it is immobilized permanently.',
      'If this piece captures, every enemy piece of that same variant is also removed (for example, capturing a Pawn takes all enemy Pawns).',
    ],
  },
  vampire: {
    id: 'vampire',
    name: 'Vampire',
    classLabel: 'Queen',
    movement: [
      'Day: moves 1 tile orthogonally.',
      'Night: a 1×1 Chebyshev area at 0 Blood Tokens.',
      'Every 3 Blood Tokens adds 1 tile of night radius (3 → 2×2), up to a 5×5 area.',
    ],
    abilities: ['Blood Token: gains 1 Blood Token each time it captures a piece (day or night).'],
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
    movement: ['Moves 1 tile in any direction.'],
    abilities: ['Soul Syphon: capturing an enemy converts it to your side.'],
    notes: ['Cannot move during the day.'],
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
