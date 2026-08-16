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
const MUSIC_VOL_KEY = 'chesspansion-music-volume';

const SFX_SRC: Record<SfxId, string> = {
  ui: AUDIO_FILES.sfxUi,
  piece: AUDIO_FILES.sfxPiece,
  cardCast: AUDIO_FILES.sfxCardCast,
};

const DEFAULT_MUSIC_VOLUME = 0.55;

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

function readVolume(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  } catch {
    return fallback;
  }
}

function writeVolume(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
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
  musicVolume: number;
  scene: MusicScene;
  unlocked: boolean;
  menu: HTMLAudioElement | null;
  game: HTMLAudioElement | null;
};

const engine: AudioEngine = {
  musicEnabled: readFlag(MUSIC_KEY, true),
  sfxEnabled: readFlag(SFX_KEY, true),
  musicVolume: readVolume(MUSIC_VOL_KEY, DEFAULT_MUSIC_VOLUME),
  scene: 'none',
  unlocked: false,
  menu: null,
  game: null,
};

function applyMusicVolume() {
  const vol = engine.musicEnabled ? engine.musicVolume : 0;
  if (engine.menu) engine.menu.volume = vol;
  if (engine.game) engine.game.volume = vol;
}

function ensureTracks() {
  if (!engine.menu) {
    engine.menu = new Audio(AUDIO_FILES.musicMenu);
    engine.menu.loop = true;
    engine.menu.preload = 'auto';
  }
  if (!engine.game) {
    engine.game = new Audio(AUDIO_FILES.musicGame);
    engine.game.loop = true;
    engine.game.preload = 'auto';
  }
  applyMusicVolume();
}

function safePlay(audio: HTMLAudioElement | null) {
  if (!audio) return;
  const p = audio.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => {
      /* autoplay blocked or missing file — ignored until next gesture */
    });
  }
}

function pauseTrack(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause();
}

function syncMusic() {
  ensureTracks();
  applyMusicVolume();
  if (!engine.musicEnabled || !engine.unlocked || engine.scene === 'none' || engine.musicVolume <= 0) {
    pauseTrack(engine.menu);
    pauseTrack(engine.game);
    return;
  }
  if (engine.scene === 'menu') {
    pauseTrack(engine.game);
    safePlay(engine.menu);
  } else if (engine.scene === 'game') {
    pauseTrack(engine.menu);
    safePlay(engine.game);
  }
}

export function unlockAudio() {
  engine.unlocked = true;
  ensureTracks();
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

function setMusicVolume(volume: number) {
  engine.musicVolume = Math.min(1, Math.max(0, volume));
  writeVolume(MUSIC_VOL_KEY, engine.musicVolume);
  applyMusicVolume();
  if (engine.musicVolume > 0 && engine.musicEnabled) {
    unlockAudio();
    syncMusic();
  } else {
    pauseTrack(engine.menu);
    pauseTrack(engine.game);
  }
}

export function setMusicScene(scene: MusicScene) {
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
  }, [scene]);
}

export function useAudioSettings() {
  const [musicEnabled, setMusic] = usePersistedFlag(MUSIC_KEY, true);
  const [sfxEnabled, setSfx] = usePersistedFlag(SFX_KEY, true);
  const [musicVolume, setMusicVol] = useState(() => readVolume(MUSIC_VOL_KEY, DEFAULT_MUSIC_VOLUME));

  useEffect(() => {
    setMusicEnabled(musicEnabled);
  }, [musicEnabled]);

  useEffect(() => {
    setSfxEnabled(sfxEnabled);
  }, [sfxEnabled]);

  useEffect(() => {
    setMusicVolume(musicVolume);
  }, [musicVolume]);

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
    musicVolume,
    setMusicEnabled: setMusic as Dispatch<SetStateAction<boolean>>,
    setSfxEnabled: setSfx as Dispatch<SetStateAction<boolean>>,
    setMusicVolume: setMusicVol as Dispatch<SetStateAction<number>>,
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
      if (button.closest('.fx-toggle, .knowledge-toggle, .audio-toggle, .music-volume')) return;
      playUiSfx();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

export function AudioToggles({
  musicEnabled,
  sfxEnabled,
  musicVolume,
  onToggleMusic,
  onToggleSfx,
  onMusicVolume,
}: {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  musicVolume: number;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
  onMusicVolume: (volume: number) => void;
}) {
  const pct = Math.round(musicVolume * 100);

  return (
    <>
      <label className="music-volume" title={`Music volume ${pct}%`}>
        <span className="fx-toggle-label">Vol {pct}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          data-audio="off"
          aria-label="Music volume"
          onPointerDown={() => unlockAudio()}
          onChange={(e) => onMusicVolume(Number(e.target.value) / 100)}
        />
      </label>
      <button
        type="button"
        className={`audio-toggle music-toggle ${musicEnabled ? 'on' : 'off'}`}
        onClick={() => {
          unlockAudio();
          onToggleMusic();
        }}
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
