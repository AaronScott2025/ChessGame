import { LAWS } from '@shared/laws.ts';
import { vampireNightRadius } from '@shared/utils.ts';

type PhasePiece = {
  defId: string;
  class: string;
  charges?: number;
  gamblerStyleDefId?: string;
};

type PhaseState = {
  dayNight: string;
  laws?: Array<{ id: string }>;
};

export interface PhaseForm {
  phase: 'day' | 'night';
  /** Short label for the board tooltip. */
  label: string;
}

/** The day/night form a piece is currently in, or null when the cycle isn't changing it right now. */
export function phaseFormFor(piece: PhasePiece, state: PhaseState): PhaseForm | null {
  const mandated = (state.laws ?? []).some((l) => {
    const m = LAWS[l.id]?.mandate;
    return m && m.class === piece.class && m.defId !== piece.defId;
  });
  if (mandated) return null;

  const night = state.dayNight === 'night';
  switch (piece.defId) {
    case 'pig':
      return night ? { phase: 'night', label: 'Night form: moves 1 tile in any direction (no Best Buddy)' } : null;
    case 'ghost':
      return night ? { phase: 'night', label: 'Night: Phase Walk — can move over pieces' } : null;
    case 'vampire': {
      const r = vampireNightRadius(piece.charges ?? 0);
      if (!night || r <= 1) return null;
      return { phase: 'night', label: `Night hunt: moves within a ${r}×${r} area` };
    }
    case 'demon':
      return night ? null : { phase: 'day', label: 'Daylight: 1 diagonal step only, no Soul Syphon' };
    case 'gambler':
      return night ? { phase: 'night', label: 'Night form: moves 1 square diagonally' } : null;
    case 'timekeeper':
      return night
        ? { phase: 'night', label: 'Night form: moves like a Knight' }
        : { phase: 'day', label: 'Day form: moves like a Bishop' };
    default:
      return null;
  }
}
