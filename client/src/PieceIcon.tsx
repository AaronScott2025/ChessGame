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
  prince_princess: { folder: 'Wildcards', file: 'PrincePrincess' },
  demon: { folder: 'Wildcards', file: 'Demon' },
  mimic: { folder: 'Wildcards', file: 'Mimic' },
  gambler: { folder: 'Wildcards', file: 'Gambler' },
  timekeeper: { folder: 'Wildcards', file: 'TimeKeeper' },
  prototype: { folder: 'Wildcards', file: 'Prototype' },
  drone: { folder: 'Wildcards', file: 'Drone' },
  backup_drone: { folder: 'Wildcards', file: 'BackupDrone' },
  king: { folder: 'Kings', file: 'King' },
};

/** Prototype art tier: upgrades every 2 mutations, capped at 6 (tier 3). */
export function prototypeTier(gained: number | undefined): number {
  return Math.max(0, Math.min(3, Math.floor((gained ?? 0) / 2)));
}

export function pieceArtSrc(defId: string, color: Color, tier = 0): string {
  const art = PIECE_ART[defId] ?? PIECE_ART.pawn;
  const tone = color === 'white' ? 'White' : 'Black';
  const stage = defId === 'prototype' && tier > 0 ? String(tier) : '';
  return `/Chesspansion/${art.folder}/${art.file}${stage}${tone}.png`;
}

export function PieceIcon({
  defId,
  color,
  className = '',
  title,
  tier = 0,
}: {
  defId: string;
  color: Color;
  className?: string;
  title?: string;
  tier?: number;
}) {
  const id = PIECE_ART[defId] ? defId : 'pawn';
  const src = pieceArtSrc(id, color, tier);
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
