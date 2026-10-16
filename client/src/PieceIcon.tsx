type Color = 'white' | 'black';

/** Maps piece defId → Chesspansion folder + PascalCase filename stem. */
const PIECE_ART: Record<string, { folder: string; file: string }> = {
  pawn: { folder: 'Pawns', file: 'Pawn' },
  nwap: { folder: 'Pawns', file: 'Nwap' },
  rogue: { folder: 'Pawns', file: 'Rogue' },
  enchanted_pawn: { folder: 'Pawns', file: 'EnchantedPawn' },
  leapfrog: { folder: 'Pawns', file: 'Leapfrog' },
  spider: { folder: 'Pawns', file: 'Spider' },
  rook: { folder: 'Rooks', file: 'Rook' },
  stoneman: { folder: 'Rooks', file: 'Stoneman' },
  gnome: { folder: 'Rooks', file: 'Gnome' },
  yeti: { folder: 'Rooks', file: 'Yeti' },
  crocodile: { folder: 'Rooks', file: 'Crocodile' },
  horse: { folder: 'Knights', file: 'Horse' },
  snake: { folder: 'Knights', file: 'Snake' },
  pig: { folder: 'Knights', file: 'Pig' },
  archer: { folder: 'Knights', file: 'Archer' },
  bishop: { folder: 'Bishops', file: 'Bishop' },
  scamman: { folder: 'Bishops', file: 'Scamman' },
  wizard: { folder: 'Bishops', file: 'Wizard' },
  worm: { folder: 'Bishops', file: 'Worm' },
  queen: { folder: 'Queens', file: 'Queen' },
  spider_queen: { folder: 'Queens', file: 'SpiderQueen' },
  angel: { folder: 'Queens', file: 'Angel' },
  ghost: { folder: 'Queens', file: 'Ghost' },
  reaper: { folder: 'Queens', file: 'Reaper' },
  snail: { folder: 'Queens', file: 'Snail' },
  vampire: { folder: 'Queens', file: 'Vampire' },
  president: { folder: 'Queens', file: 'President' },
  prince_princess: { folder: 'Wildcards', file: 'PrincePrincess' },
  demon: { folder: 'Wildcards', file: 'Demon' },
  mimic: { folder: 'Wildcards', file: 'Mimic' },
  gambler: { folder: 'Wildcards', file: 'Gambler' },
  timekeeper: { folder: 'Wildcards', file: 'TimeKeeper' },
  prototype: { folder: 'Wildcards', file: 'Prototype' },
  drone: { folder: 'Wildcards', file: 'Drone' },
  king: { folder: 'Kings', file: 'King' },
};

/** Prototype art per forme; the eye color shows the active forme. */
const PROTOTYPE_FORME_ART: Record<string, string> = {
  speed: 'Speed',
  attack: 'Attack',
  defense: 'Defense',
  temporal: 'Temporal',
};

export function pieceArtSrc(defId: string, color: Color, forme?: string): string {
  const art = PIECE_ART[defId] ?? PIECE_ART.pawn;
  const tone = color === 'white' ? 'White' : 'Black';
  const stage = defId === 'prototype' ? PROTOTYPE_FORME_ART[forme ?? 'speed'] ?? 'Speed' : '';
  return `/Chesspansion/${art.folder}/${art.file}${stage}${tone}.png`;
}

export function PieceIcon({
  defId,
  color,
  className = '',
  title,
  forme,
}: {
  defId: string;
  color: Color;
  className?: string;
  title?: string;
  /** Prototype only: the active forme, which picks the eye color. */
  forme?: string;
}) {
  const id = PIECE_ART[defId] ? defId : 'pawn';
  const src = pieceArtSrc(id, color, forme);
  return (
    <span
      className={`piece-icon piece-icon-art piece-art-${id} ${color} ${className}`.trim()}
      role={title ? 'img' : undefined}
      aria-label={title ?? id}
      title={title}
    >
      <img src={src} alt="" draggable={false} />
    </span>
  );
}
