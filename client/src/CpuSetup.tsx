import { useEffect } from 'react';
import { AI_DIFFICULTIES, type AiDifficulty } from '@shared/ai/index.ts';
import { CPU_DIFFICULTY_INFO, CPU_SIDES, type CpuSide } from './cpu';

const SIDE_INFO: Record<CpuSide, { glyph: string; label: string; note: string }> = {
  white: { glyph: '♔', label: 'White', note: 'You move first' },
  black: { glyph: '♚', label: 'Black', note: 'You pick the draft order' },
  random: { glyph: '⚄', label: 'Random', note: 'Flip for it' },
};

export function CpuSetup({
  open,
  difficulty,
  side,
  onDifficulty,
  onSide,
  onStart,
  onClose,
}: {
  open: boolean;
  difficulty: AiDifficulty;
  side: CpuSide;
  onDifficulty: (d: AiDifficulty) => void;
  onSide: (s: CpuSide) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="lobby-browser-backdrop" role="presentation" onClick={onClose}>
      <section
        className="lobby-browser cpu-setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cpu-setup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="lobby-browser-head">
          <div>
            <p className="lobby-browser-kicker">Offline</p>
            <h2 id="cpu-setup-title">Versus Computer</h2>
          </div>
          <button type="button" className="lobby-browser-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="cpu-setup-body">
          <p className="home-section-title">Difficulty</p>
          <div className="cpu-difficulty" role="radiogroup" aria-label="Difficulty">
            {AI_DIFFICULTIES.map((d, i) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={difficulty === d}
                className={`cpu-difficulty-tile is-${d}${difficulty === d ? ' is-active' : ''}`}
                onClick={() => onDifficulty(d)}
              >
                <span className="cpu-difficulty-pips" aria-hidden>
                  {AI_DIFFICULTIES.map((_, j) => (
                    <i key={j} className={j <= i ? 'is-on' : ''} />
                  ))}
                </span>
                <strong>{CPU_DIFFICULTY_INFO[d].label}</strong>
                <em>{CPU_DIFFICULTY_INFO[d].blurb}</em>
              </button>
            ))}
          </div>

          <p className="home-section-title">Your side</p>
          <div className="cpu-side" role="radiogroup" aria-label="Your side">
            {CPU_SIDES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                className={`cpu-side-tile is-${s}${side === s ? ' is-active' : ''}`}
                onClick={() => onSide(s)}
              >
                <span className="cpu-side-glyph" aria-hidden>
                  {SIDE_INFO[s].glyph}
                </span>
                <strong>{SIDE_INFO[s].label}</strong>
                <em>{SIDE_INFO[s].note}</em>
              </button>
            ))}
          </div>
          <p className="cpu-setup-note">Uses the match rules you’ve set on the home screen.</p>
        </div>

        <footer className="lobby-browser-foot cpu-setup-foot">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary cpu-setup-start" onClick={onStart}>
            Start match
          </button>
        </footer>
      </section>
    </div>
  );
}
