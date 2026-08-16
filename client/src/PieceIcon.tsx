type Color = 'white' | 'black';

const PIECE_IDS = new Set([
  'pawn',
  'nwap',
  'rogue',
  'enchanted_pawn',
  'rook',
  'stoneman',
  'gnome',
  'horse',
  'snake',
  'pig',
  'bishop',
  'scamman',
  'wizard',
  'queen',
  'angel',
  'ghost',
  'reaper',
  'prince_princess',
  'demon',
  'mimic',
  'king',
]);

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
  const id = PIECE_IDS.has(defId) ? defId : 'pawn';
  const src = `/pieces/${id}_mask.png`;
  return (
    <span
      className={`piece-icon ${color} ${className}`.trim()}
      role={title ? 'img' : undefined}
      aria-label={title ?? id}
      title={title}
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
      }}
    />
  );
}
