/**
 * Chesspansion audio — plug-and-play.
 *
 * Drop MP3 files into `client/public/audio/` using the filenames in AUDIO_FILES
 * (or change the paths below). Missing files fail silently until you add them.
 *
 * Tracks:
 * - musicMenu  → home, draft, and any screen without the main board
 * - musicGame  → main board / in-game section
 * - sfxUi      → buttons outside the board
 * - sfxPiece   → board square / piece interactions
 * - sfxCardCast→ successfully casting a spell card
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/** Edit these paths when you add or rename assets. */
export const AUDIO_FILES = {
  musicMenu: '/audio/music-menu.mp3',
  musicGame: '/audio/music-game.mp3',
  sfxUi: '/audio/sfx-ui.mp3',
  sfxPiece: '/audio/sfx-piece.mp3',
  sfxCardCast: '/audio/sfx-card-cast.mp3',
} as const;

export type MusicScene = 'menu' | 'game' | 'none';
export type SfxId = 'ui' | 'piece' | 'cardCast';

const MUSIC_KEY = 'chesspansion-music-enabled';
const SFX_KEY = 'chesspansion-sfx-enabled';

const SFX_SRC: Record<SfxId, string> = {
  ui: AUDIO_FILES.sfxUi,
  piece: AUDIO_FILES.sfxPiece,
  cardCast: AUDIO_FILES.sfxCardCast,
};

function readFlag(key: string, fallback = true): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function usePersistedFlag(key: string, fallback = true) {
  const [enabled, setEnabled] = useState(() => readFlag(key, fallback));
  useEffect(() => {
    writeFlag(key, enabled);
  }, [key, enabled]);
  return [enabled, setEnabled] as const;
}

type AudioEngine = {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  scene: MusicScene;
  unlocked: boolean;
  menu: HTMLAudioElement | null;
  game: HTMLAudioElement | null;
};

const engine: AudioEngine = {
  musicEnabled: readFlag(MUSIC_KEY, true),
  sfxEnabled: readFlag(SFX_KEY, true),
  scene: 'none',
  unlocked: false,
  menu: null,
  game: null,
};

function ensureTracks() {
  if (!engine.menu) {
    engine.menu = new Audio(AUDIO_FILES.musicMenu);
    engine.menu.loop = true;
    engine.menu.preload = 'auto';
    engine.menu.volume = 0.45;
  }
  if (!engine.game) {
    engine.game = new Audio(AUDIO_FILES.musicGame);
    engine.game.loop = true;
    engine.game.preload = 'auto';
    engine.game.volume = 0.45;
  }
}

function safePlay(audio: HTMLAudioElement | null) {
  if (!audio) return;
  const p = audio.play();
  if (p && typeof p.catch === 'function') p.catch(() => undefined);
}

function pauseTrack(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause();
}

function syncMusic() {
  ensureTracks();
  if (!engine.musicEnabled || !engine.unlocked || engine.scene === 'none') {
    pauseTrack(engine.menu);
    pauseTrack(engine.game);
    return;
  }
  if (engine.scene === 'menu') {
    pauseTrack(engine.game);
    safePlay(engine.menu);
  } else {
    pauseTrack(engine.menu);
    safePlay(engine.game);
  }
}

function unlockAudio() {
  if (engine.unlocked) return;
  engine.unlocked = true;
  ensureTracks();
  // Warm decode; ignore failures until files exist
  void engine.menu?.load();
  void engine.game?.load();
  syncMusic();
}

function setMusicEnabled(enabled: boolean) {
  engine.musicEnabled = enabled;
  writeFlag(MUSIC_KEY, enabled);
  syncMusic();
}

function setSfxEnabled(enabled: boolean) {
  engine.sfxEnabled = enabled;
  writeFlag(SFX_KEY, enabled);
}

export function setMusicScene(scene: MusicScene) {
  if (engine.scene === scene) {
    syncMusic();
    return;
  }
  engine.scene = scene;
  syncMusic();
}

export function playSfx(id: SfxId) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const src = SFX_SRC[id];
  const audio = new Audio(src);
  audio.volume = id === 'ui' ? 0.55 : 0.7;
  safePlay(audio);
}

export const playUiSfx = () => playSfx('ui');
export const playPieceSfx = () => playSfx('piece');
export const playCardCastSfx = () => playSfx('cardCast');

/** Keep music scene in sync with the current UI surface. */
export function useAudioScene(scene: MusicScene) {
  useEffect(() => {
    setMusicScene(scene);
    return () => {
      /* leave scene as-is; next mount sets the next one */
    };
  }, [scene]);
}

export function useAudioSettings() {
  const [musicEnabled, setMusic] = usePersistedFlag(MUSIC_KEY, true);
  const [sfxEnabled, setSfx] = usePersistedFlag(SFX_KEY, true);

  useEffect(() => {
    setMusicEnabled(musicEnabled);
  }, [musicEnabled]);

  useEffect(() => {
    setSfxEnabled(sfxEnabled);
  }, [sfxEnabled]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return {
    musicEnabled,
    sfxEnabled,
    setMusicEnabled: setMusic as Dispatch<SetStateAction<boolean>>,
    setSfxEnabled: setSfx as Dispatch<SetStateAction<boolean>>,
  };
}

/**
 * Plays UI click SFX for buttons outside `.board`.
 * Skips audio/fx/knowledge toggles and elements marked `data-audio="off"`.
 */
export function useUiButtonSfx() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const button = target.closest('button');
      if (!button) return;
      if (button.disabled) return;
      if (button.dataset.audio === 'off') return;
      if (button.closest('.board')) return;
      if (button.closest('.fx-toggle, .knowledge-toggle, .audio-toggle')) return;
      playUiSfx();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

export function AudioToggles({
  musicEnabled,
  sfxEnabled,
  onToggleMusic,
  onToggleSfx,
}: {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`audio-toggle music-toggle ${musicEnabled ? 'on' : 'off'}`}
        onClick={onToggleMusic}
        title={musicEnabled ? 'Mute music' : 'Enable music'}
        aria-pressed={musicEnabled}
        data-audio="off"
      >
        <span className="fx-toggle-glyph" aria-hidden>
          {musicEnabled ? '♪' : '♩'}
        </span>
        <span className="fx-toggle-label">{musicEnabled ? 'Music On' : 'Music Off'}</span>
      </button>
      <button
        type="button"
        className={`audio-toggle sfx-toggle ${sfxEnabled ? 'on' : 'off'}`}
        onClick={onToggleSfx}
        title={sfxEnabled ? 'Mute sound effects' : 'Enable sound effects'}
        aria-pressed={sfxEnabled}
        data-audio="off"
      >
        <span className="fx-toggle-glyph" aria-hidden>
          {sfxEnabled ? '◈' : '◇'}
        </span>
        <span className="fx-toggle-label">{sfxEnabled ? 'SFX On' : 'SFX Off'}</span>
      </button>
    </>
  );
}
