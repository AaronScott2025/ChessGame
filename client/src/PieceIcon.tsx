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
  horse: { folder: 'Knights', file: 'Horse' },
  snake: { folder: 'Knights', file: 'Snake' },
  pig: { folder: 'Knights', file: 'Pig' },
  bishop: { folder: 'Bishops', file: 'Bishop' },
  scamman: { folder: 'Bishops', file: 'Scamman' },
  wizard: { folder: 'Bishops', file: 'Wizard' },
  queen: { folder: 'Queens', file: 'Queen' },
  angel: { folder: 'Queens', file: 'Angel' },
  ghost: { folder: 'Queens', file: 'Ghost' },
  reaper: { folder: 'Queens', file: 'Reaper' },
  snail: { folder: 'Queens', file: 'Snail' },
  vampire: { folder: 'Queens', file: 'Vampire' },
  prince_princess: { folder: 'Wildcards', file: 'PrincePrincess' },
  demon: { folder: 'Wildcards', file: 'Demon' },
  mimic: { folder: 'Wildcards', file: 'Mimic' },
  gambler: { folder: 'Wildcards', file: 'Gambler' },
  king: { folder: 'Kings', file: 'King' },
};

export function pieceArtSrc(defId: string, color: Color): string {
  const art = PIECE_ART[defId] ?? PIECE_ART.pawn;
  const tone = color === 'white' ? 'White' : 'Black';
  return `/Chesspansion/${art.folder}/${art.file}${tone}.png`;
}

export function PieceIcon({
  defId,
  color,
  className = '',
  title,
}: {
  defId: string;
  color: Color;
  className?: string;
  title?: string;
}) {
  const id = PIECE_ART[defId] ? defId : 'pawn';
  const src = pieceArtSrc(id, color);
  return (
    <span
      className={`piece-icon piece-icon-art ${color} ${className}`.trim()}
      role={title ? 'img' : undefined}
      aria-label={title ?? id}
      title={title}
    >
      <img src={src} alt="" draggable={false} />
    </span>
  );
}
