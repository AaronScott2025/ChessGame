import { useEffect, useState } from 'react';

const FX_STORAGE_KEY = 'chesspansion-fx-enabled';
const KNOWLEDGE_STORAGE_KEY = 'chesspansion-knowledge-enabled';
const BAN_PHASE_STORAGE_KEY = 'chesspansion-rule-ban-phase';
const ANONYMOUS_STORAGE_KEY = 'chesspansion-rule-anonymous';
const TURN_TIMER_STORAGE_KEY = 'chesspansion-rule-turn-timer';

function usePersistedToggle(storageKey: string, defaultValue = true) {
  const [enabled, setEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw == null ? defaultValue : raw === '1';
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [storageKey, enabled]);

  return [enabled, setEnabled] as const;
}

export function useFxEnabled() {
  const [fxEnabled, setFxEnabled] = usePersistedToggle(FX_STORAGE_KEY);

  useEffect(() => {
    document.documentElement.classList.toggle('fx-off', !fxEnabled);
  }, [fxEnabled]);

  return { fxEnabled, setFxEnabled };
}

export function useKnowledgeEnabled() {
  const [knowledgeEnabled, setKnowledgeEnabled] = usePersistedToggle(KNOWLEDGE_STORAGE_KEY);
  return { knowledgeEnabled, setKnowledgeEnabled };
}

export function useBanPhaseRule() {
  const [banPhaseRule, setBanPhaseRule] = usePersistedToggle(BAN_PHASE_STORAGE_KEY);
  return { banPhaseRule, setBanPhaseRule };
}

export function useAnonymousRule() {
  const [anonymousRule, setAnonymousRule] = usePersistedToggle(ANONYMOUS_STORAGE_KEY, false);
  return { anonymousRule, setAnonymousRule };
}

/** Chess but Fast seconds per turn; 0 means the rule is off. */
export function useTurnTimerRule() {
  const [turnTimerRule, setTurnTimerRule] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(TURN_TIMER_STORAGE_KEY));
      return Number.isFinite(raw) ? raw : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(TURN_TIMER_STORAGE_KEY, String(turnTimerRule));
    } catch {
      /* ignore */
    }
  }, [turnTimerRule]);

  return { turnTimerRule, setTurnTimerRule };
}

export function CosmicBackdrop({
  enabled,
  dayNight = 'day',
}: {
  enabled: boolean;
  dayNight?: 'day' | 'night' | string;
}) {
  const cycle = dayNight === 'night' ? 'cycle-night' : 'cycle-day';
  return (
    <div
      className={`cosmic-backdrop ${enabled ? 'is-on' : 'is-off'} ${cycle}`}
      aria-hidden
    >
      <div className="cosmic-nebula cosmic-nebula-a" />
      <div className="cosmic-nebula cosmic-nebula-b" />
      <div className="cosmic-nebula cosmic-nebula-c" />
      <div className="cosmic-stars cosmic-stars-far" />
      <div className="cosmic-stars cosmic-stars-near" />
      <div className="cosmic-vines" />
      {enabled && (
        <>
          <span className="shooting-star s1" />
          <span className="shooting-star s2" />
          <span className="shooting-star s3" />
          <span className="shooting-star s4" />
          <span className="cosmic-ember e1" />
          <span className="cosmic-ember e2" />
          <span className="cosmic-ember e3" />
        </>
      )}
    </div>
  );
}

export function FxToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`fx-toggle ${enabled ? 'on' : 'off'}`}
      onClick={onToggle}
      title={enabled ? 'Disable ambient animations' : 'Enable ambient animations'}
      aria-pressed={enabled}
    >
      <span className="fx-toggle-glyph" aria-hidden>
        {enabled ? '✦' : '✧'}
      </span>
      <span className="fx-toggle-label">{enabled ? 'FX On' : 'FX Off'}</span>
    </button>
  );
}

export function KnowledgeToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`knowledge-toggle ${enabled ? 'on' : 'off'}`}
      onClick={onToggle}
      title={enabled ? 'Hide piece knowledge panel' : 'Show piece knowledge panel'}
      aria-pressed={enabled}
    >
      <span className="fx-toggle-glyph" aria-hidden>
        {enabled ? '◉' : '○'}
      </span>
      <span className="fx-toggle-label">{enabled ? 'Info On' : 'Info Off'}</span>
    </button>
  );
}
