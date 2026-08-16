import { useEffect, useState } from 'react';

const FX_STORAGE_KEY = 'chesspansion-fx-enabled';
const KNOWLEDGE_STORAGE_KEY = 'chesspansion-knowledge-enabled';

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

export function CosmicBackdrop({ enabled }: { enabled: boolean }) {
  return (
    <div className={`cosmic-backdrop ${enabled ? 'is-on' : 'is-off'}`} aria-hidden>
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
