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
 * - sfxChecked → loops while you were recently put in check (next 3 of your turns)
 * - sfxCheckDealt → loops while you recently put the opponent in check (next 3 of your turns)
 * - musicVictory → plays once when you win
 * - musicLoss → plays once when you lose
 * Draw / discard / day-night SFX are procedural (Web Audio) and need no files.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/** Edit these paths when you add or rename assets. */
export const AUDIO_FILES = {
  musicMenu: '/audio/music-menu.mp3',
  musicGame: '/audio/music-game.mp3',
  sfxUi: '/audio/sfx-ui.mp3',
  sfxPiece: '/audio/sfx-piece.mp3',
  sfxCardCast: '/audio/sfx-card-cast.mp3',
  sfxChecked: '/audio/checked.mp3',
  sfxCheckDealt: '/audio/check.mp3',
  musicVictory: '/audio/victory.mp3',
  musicLoss: '/audio/losing.mp3',
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
  checked: HTMLAudioElement | null;
  checkedTurnsLeft: number;
  checking: HTMLAudioElement | null;
  checkingTurnsLeft: number;
  result: HTMLAudioElement | null;
  resultVictory: HTMLAudioElement | null;
  resultLoss: HTMLAudioElement | null;
  resultKind: 'victory' | 'loss' | null;
  resultFinished: boolean;
  resultStarted: boolean;
};

const engineHost = window as Window & { __chesspansionEngine?: AudioEngine };
const freshEngine = !engineHost.__chesspansionEngine;

/** Lives on `window` so a hot-reloaded copy of this module drives the same tracks instead of orphaning them. */
const engine: AudioEngine = (engineHost.__chesspansionEngine ??= {
  musicEnabled: readFlag(MUSIC_KEY, true),
  sfxEnabled: readFlag(SFX_KEY, true),
  musicVolume: readVolume(MUSIC_VOL_KEY, DEFAULT_MUSIC_VOLUME),
  scene: 'none',
  unlocked: false,
  menu: null,
  game: null,
  checked: null,
  checkedTurnsLeft: 0,
  checking: null,
  checkingTurnsLeft: 0,
  result: null,
  resultVictory: null,
  resultLoss: null,
  resultKind: null,
  resultFinished: false,
  resultStarted: false,
});

const CHECKED_VOLUME_SCALE = 1;

function ownAudio(audio: HTMLAudioElement) {
  audioBag().add(audio);
  return audio;
}

function audioBag(): Set<HTMLAudioElement> {
  const host = window as Window & { __chesspansionAudio?: Set<HTMLAudioElement> };
  if (!host.__chesspansionAudio) host.__chesspansionAudio = new Set();
  return host.__chesspansionAudio;
}

function silenceOwnedAudio() {
  for (const audio of audioBag()) {
    playIntent.set(audio, 'pause');
    audio.muted = true;
    audio.volume = 0;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      /* not seekable */
    }
    audio.removeAttribute('src');
    audio.load();
  }
  audioBag().clear();
  oneShots.clear();
}

function ensureCheckedTrack() {
  if (!engine.checked) {
    engine.checked = ownAudio(new Audio(AUDIO_FILES.sfxChecked));
    engine.checked.loop = true;
    engine.checked.preload = 'auto';
  }
}

function ensureCheckingTrack() {
  if (!engine.checking) {
    engine.checking = ownAudio(new Audio(AUDIO_FILES.sfxCheckDealt));
    engine.checking.loop = true;
    engine.checking.preload = 'auto';
  }
}

function applyMusicVolume() {
  const vol = engine.musicVolume;
  if (engine.menu) engine.menu.volume = vol;
  if (engine.game) engine.game.volume = vol;
  if (engine.checked) engine.checked.volume = vol * CHECKED_VOLUME_SCALE;
  if (engine.checking) engine.checking.volume = vol * CHECKED_VOLUME_SCALE;
  if (engine.result) engine.result.volume = engine.musicVolume > 0 ? engine.musicVolume : 0.85;
}

function pauseCheckedAudio() {
  if (!engine.checked) return;
  pauseTrack(engine.checked);
  seekStart(engine.checked);
}

function pauseResultAudio() {
  if (!engine.result) return;
  pauseTrack(engine.result);
  seekStart(engine.result);
}

function seekStart(audio: HTMLAudioElement) {
  try {
    if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = 0;
    }
  } catch {
    /* not seekable yet */
  }
}

function resultElement(kind: 'victory' | 'loss') {
  const key = kind === 'victory' ? 'resultVictory' : 'resultLoss';
  if (!engine[key]) {
    const audio = ownAudio(new Audio(kind === 'victory' ? AUDIO_FILES.musicVictory : AUDIO_FILES.musicLoss));
    audio.preload = 'auto';
    audio.loop = false;
    audio.setAttribute('playsinline', '');
    engine[key] = audio;
  }
  return engine[key]!;
}

/** Unlock both result files during a tap so a later win or loss can play them. */
function primeResultAudio() {
  for (const kind of ['victory', 'loss'] as const) {
    const audio = resultElement(kind);
    if (audio.dataset.primed === '1') continue;
    audio.muted = true;
    const pending = audio.play();
    if (!pending || typeof pending.then !== 'function') continue;
    pending
      .then(() => {
        if (engine.result === audio && engine.resultKind) {
          audio.muted = false;
          audio.dataset.primed = '1';
          return;
        }
        audio.pause();
        audio.muted = false;
        try {
          audio.currentTime = 0;
        } catch {
          /* not seekable yet */
        }
        audio.dataset.primed = '1';
      })
      .catch(() => {});
  }
}

function clearResultState() {
  engine.resultKind = null;
  engine.resultFinished = false;
  engine.resultStarted = false;
}

/** Play victory.mp3 or losing.mp3 once, in place of the game bed. */
export function playResultTrack(kind: 'victory' | 'loss') {
  const audio = resultElement(kind);
  const other = resultElement(kind === 'victory' ? 'loss' : 'victory');
  if (engine.resultKind === kind && engine.result === audio && engine.resultStarted && !audio.paused) return;

  engine.scene = 'game';
  engine.resultKind = kind;
  engine.result = audio;
  engine.resultFinished = false;
  engine.resultStarted = true;
  engine.checkedTurnsLeft = 0;
  engine.checkingTurnsLeft = 0;
  engine.unlocked = true;
  pauseTrack(other);
  pauseCheckedAudio();
  pauseCheckingAudio();
  pauseTrack(engine.menu);
  pauseTrack(engine.game);
  audio.muted = false;
  applyMusicVolume();
  seekStart(audio);
  safePlay(audio);
}

export function stopResultTrack() {
  if (!engine.resultKind && !engine.resultFinished && !(engine.result && !engine.result.paused)) return;
  clearResultState();
  pauseResultAudio();
  syncMusic();
}

function pauseCheckingAudio() {
  if (!engine.checking) return;
  pauseTrack(engine.checking);
  seekStart(engine.checking);
}

/** Start or refresh the "you are in check" theme: 3 of your turns. */
export function beginCheckedTrack() {
  engine.checkedTurnsLeft = 3;
  engine.checkingTurnsLeft = 0;
  pauseCheckingAudio();
  unlockAudio();
  syncMusic();
}

/** Start or refresh the "you put them in check" theme: 3 of your turns. */
export function beginCheckingTrack() {
  engine.checkingTurnsLeft = 3;
  engine.checkedTurnsLeft = 0;
  pauseCheckedAudio();
  unlockAudio();
  syncMusic();
}

/** Call after the checked player finishes a turn. Returns remaining turns. */
export function tickCheckedPlayerTurn(): number {
  if (engine.checkedTurnsLeft <= 0) return 0;
  engine.checkedTurnsLeft -= 1;
  if (engine.checkedTurnsLeft <= 0) stopCheckedTrack();
  return engine.checkedTurnsLeft;
}

/** Call after the player who delivered check finishes a turn. Returns remaining turns. */
export function tickCheckingPlayerTurn(): number {
  if (engine.checkingTurnsLeft <= 0) return 0;
  engine.checkingTurnsLeft -= 1;
  if (engine.checkingTurnsLeft <= 0) stopCheckingTrack();
  return engine.checkingTurnsLeft;
}

export function stopCheckedTrack() {
  engine.checkedTurnsLeft = 0;
  pauseCheckedAudio();
  if (engine.scene === 'game') syncMusic();
}

export function stopCheckingTrack() {
  engine.checkingTurnsLeft = 0;
  pauseCheckingAudio();
  if (engine.scene === 'game') syncMusic();
}

function ensureTracks() {
  if (!engine.menu) {
    engine.menu = ownAudio(new Audio(AUDIO_FILES.musicMenu));
    engine.menu.loop = true;
    engine.menu.preload = 'auto';
  }
  if (!engine.game) {
    engine.game = ownAudio(new Audio(AUDIO_FILES.musicGame));
    engine.game.loop = true;
    engine.game.preload = 'auto';
  }
  applyMusicVolume();
}

const playIntent = new WeakMap<HTMLAudioElement, 'play' | 'pause'>();
const oneShots = new Set<HTMLAudioElement>();
// Tracks left by an older copy of this module have no engine steering them.
if (freshEngine) silenceOwnedAudio();

function markPaused(audio: HTMLAudioElement) {
  playIntent.set(audio, 'pause');
}

function safePlay(audio: HTMLAudioElement | null) {
  if (!audio) return;
  playIntent.set(audio, 'play');
  const pending = audio.play();
  if (pending && typeof pending.then === 'function') {
    pending.then(() => {
      if (playIntent.get(audio) === 'pause') audio.pause();
    }).catch(() => {
      /* autoplay blocked or missing file — ignored until next gesture */
    });
  }
}

function pauseTrack(audio: HTMLAudioElement | null) {
  if (!audio) return;
  playIntent.set(audio, 'pause');
  audio.pause();
}

type MusicBed = 'menu' | 'game' | 'checked' | 'checking' | 'result';

function musicAllowed() {
  return engine.musicEnabled && engine.unlocked && engine.musicVolume > 0 && engine.scene !== 'none';
}

function resultWanted() {
  return !!engine.resultKind && !engine.resultFinished && engine.scene === 'game';
}

/** Exactly one bed may play, and only on the screen it belongs to. */
function wantedBed(): MusicBed | null {
  if (resultWanted()) return 'result';
  if (!musicAllowed()) return null;
  if (engine.scene === 'menu') return 'menu';
  if (engine.scene !== 'game') return null;
  if (engine.checkedTurnsLeft > 0) return 'checked';
  if (engine.checkingTurnsLeft > 0) return 'checking';
  return 'game';
}

function syncMusic() {
  ensureTracks();
  applyMusicVolume();
  if (engine.scene !== 'game') {
    clearResultState();
    engine.checkedTurnsLeft = 0;
    engine.checkingTurnsLeft = 0;
  }

  const bed = wantedBed();
  if (bed !== 'menu') pauseTrack(engine.menu);
  if (bed !== 'game') pauseTrack(engine.game);
  if (bed !== 'checked') pauseCheckedAudio();
  if (bed !== 'checking') pauseCheckingAudio();
  if (bed !== 'result') pauseResultAudio();

  if (bed === 'menu') safePlay(engine.menu);
  else if (bed === 'game') safePlay(engine.game);
  else if (bed === 'checked') {
    ensureCheckedTrack();
    applyMusicVolume();
    safePlay(engine.checked);
  } else if (bed === 'checking') {
    ensureCheckingTrack();
    applyMusicVolume();
    safePlay(engine.checking);
  } else if (bed === 'result' && engine.resultKind) {
    const audio = resultElement(engine.resultKind);
    engine.result = audio;
    audio.muted = false;
    applyMusicVolume();
    if (audio.paused) safePlay(audio);
  }
}

function stopOneShots() {
  for (const audio of oneShots) {
    pauseTrack(audio);
    audio.currentTime = 0;
  }
  oneShots.clear();
}

function haltProcedural() {
  if (!proceduralCtx) return;
  const ctx = proceduralCtx;
  proceduralCtx = null;
  fxCtxHost.__chesspansionFxCtx = null;
  void ctx.close().catch(() => {});
}

/** Stop every track this page has started, then play only the bed for `scene`. */
export function resetStuckAudio(scene: MusicScene) {
  engine.scene = scene;
  clearResultState();
  engine.checkedTurnsLeft = 0;
  engine.checkingTurnsLeft = 0;
  engine.sfxEnabled = true;
  writeFlag(SFX_KEY, true);
  haltProcedural();
  silenceOwnedAudio();
  engine.menu = null;
  engine.game = null;
  engine.checked = null;
  engine.checking = null;
  engine.result = null;
  engine.resultVictory = null;
  engine.resultLoss = null;
  window.setTimeout(() => {
    if (engine.scene !== scene) return;
    syncMusic();
  }, 0);
}

export function unlockAudio() {
  engine.unlocked = true;
  ensureTracks();
  primeResultAudio();
  syncMusic();
}

function setMusicEnabled(enabled: boolean) {
  engine.musicEnabled = enabled;
  writeFlag(MUSIC_KEY, enabled);
  if (enabled) engine.unlocked = true;
  syncMusic();
}

function setSfxEnabled(enabled: boolean) {
  engine.sfxEnabled = enabled;
  writeFlag(SFX_KEY, enabled);
  if (!enabled) {
    stopOneShots();
    haltProcedural();
  }
}

function setMusicVolume(volume: number) {
  engine.musicVolume = Math.min(1, Math.max(0, volume));
  writeVolume(MUSIC_VOL_KEY, engine.musicVolume);
  applyMusicVolume();
  if (engine.musicVolume > 0 && engine.musicEnabled) engine.unlocked = true;
  syncMusic();
}

export function setMusicScene(scene: MusicScene) {
  engine.scene = scene;
  if (scene !== 'game') {
    clearResultState();
    engine.checkedTurnsLeft = 0;
    engine.checkingTurnsLeft = 0;
  }
  syncMusic();
}

export function playSfx(id: SfxId) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const src = SFX_SRC[id];
  const audio = ownAudio(new Audio(src));
  audio.volume = id === 'ui' ? 0.55 : 0.7;
  oneShots.add(audio);
  audio.addEventListener('ended', () => oneShots.delete(audio));
  safePlay(audio);
}

export const playUiSfx = () => playSfx('ui');

/** Light tap when selecting a board square or piece (original Web Audio). */
export function playPieceSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.gain.exponentialRampToValueAtTime(0.18, t + 0.006);
  master.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(240, t + 0.035);
  osc.connect(master);
  osc.start(t);
  osc.stop(t + 0.08);
}

/** Slide + landing tick when a piece moves (matches board animation). */
export function playMoveSfx(deltaCol = 0, deltaRow = 0) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const dist = Math.max(Math.abs(deltaCol), Math.abs(deltaRow), 1);
  const slide = Math.min(0.22, 0.05 + dist * 0.022);
  const t = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, t + slide + 0.1);
  master.connect(ctx.destination);

  const pickup = ctx.createOscillator();
  pickup.type = 'sine';
  pickup.frequency.setValueAtTime(200 + dist * 10, t);
  pickup.frequency.exponentialRampToValueAtTime(130, t + 0.035);
  const pickupGain = ctx.createGain();
  pickupGain.gain.setValueAtTime(0.3, t);
  pickupGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  pickup.connect(pickupGain);
  pickupGain.connect(master);
  pickup.start(t);
  pickup.stop(t + 0.06);

  const bufferSize = Math.ceil(ctx.sampleRate * (slide + 0.06));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(350, t + 0.015);
  filter.frequency.exponentialRampToValueAtTime(900 + dist * 40, t + slide);
  filter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, t);
  noiseGain.gain.linearRampToValueAtTime(0.1, t + 0.03);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + slide + 0.04);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(t + 0.015);
  noise.stop(t + slide + 0.06);

  const land = ctx.createOscillator();
  land.type = 'triangle';
  land.frequency.setValueAtTime(165, t + slide);
  land.frequency.exponentialRampToValueAtTime(110, t + slide + 0.045);
  const landGain = ctx.createGain();
  landGain.gain.setValueAtTime(0.0001, t);
  landGain.gain.linearRampToValueAtTime(0.16, t + slide);
  landGain.gain.exponentialRampToValueAtTime(0.0001, t + slide + 0.065);
  land.connect(landGain);
  landGain.connect(master);
  land.start(t + slide);
  land.stop(t + slide + 0.07);
}

const fxCtxHost = window as Window & { __chesspansionFxCtx?: AudioContext | null };
let proceduralCtx: AudioContext | null = fxCtxHost.__chesspansionFxCtx ?? null;

function getProceduralCtx(): AudioContext | null {
  if (!engine.sfxEnabled) return null;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!proceduralCtx || proceduralCtx.state === 'closed') {
      proceduralCtx = new Ctx();
      fxCtxHost.__chesspansionFxCtx = proceduralCtx;
    }
    if (proceduralCtx.state === 'suspended') {
      proceduralCtx.resume().catch(() => {});
    }
    return proceduralCtx;
  } catch {
    return null;
  }
}

/** Short chime when previewing a draft variant (original Web Audio — no asset file). */
export function playDraftSelectSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
  master.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(740, t);
  osc.frequency.exponentialRampToValueAtTime(980, t + 0.08);
  osc.connect(master);
  osc.start(t);
  osc.stop(t + 0.24);
}

/** Two quick low buzzes for a rejected click (e.g. tapping a banned piece). */
export function playErrorBuzzSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const t = ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1400, t);
  filter.connect(ctx.destination);

  for (const offset of [0, 0.12]) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, t + offset + 0.01);
    gain.gain.setValueAtTime(0.16, t + offset + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.1);
    gain.connect(filter);
    for (const freq of [138, 146]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t + offset);
      osc.connect(gain);
      osc.start(t + offset);
      osc.stop(t + offset + 0.11);
    }
  }
}

/**
 * Clock tick for Chess but Fast's final seconds. `urgency` (0–1) raises the pitch and
 * adds a second, sharper blip in the last moments.
 */
export function playTimerTickSfx(urgency: number) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const u = Math.max(0, Math.min(1, urgency));
  const t = ctx.currentTime;
  const blips = u >= 0.7 ? [0, 0.11] : [0];
  for (const offset of blips) {
    const osc = ctx.createOscillator();
    osc.type = u >= 0.7 ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(880 + u * 660 + offset * 1200, t + offset);
    const gain = ctx.createGain();
    const peak = 0.07 + u * 0.09;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(peak, t + offset + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.1);
  }
}

/** Alarm when the turn clock hits zero and a random move is forced. */
export function playTimeUpSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const t = ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, t);
  filter.connect(ctx.destination);
  [0, 0.16, 0.32].forEach((offset, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const start = t + offset;
    osc.frequency.setValueAtTime(i === 2 ? 520 : 760, start);
    if (i === 2) osc.frequency.exponentialRampToValueAtTime(180, start + 0.45);
    const gain = ctx.createGain();
    const len = i === 2 ? 0.5 : 0.12;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.2, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + len);
    osc.connect(gain);
    gain.connect(filter);
    osc.start(start);
    osc.stop(start + len + 0.02);
  });
}

/** Heavy descending slam when a piece is banned. */
export function playDraftBanSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
  master.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, t);
  filter.frequency.exponentialRampToValueAtTime(300, t + 0.45);
  master.connect(filter);
  filter.connect(ctx.destination);

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(320, t);
  saw.frequency.exponentialRampToValueAtTime(70, t + 0.4);
  saw.connect(master);
  saw.start(t);
  saw.stop(t + 0.5);

  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(110, t);
  thud.frequency.exponentialRampToValueAtTime(45, t + 0.2);
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.9, t);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  thud.connect(thudGain);
  thudGain.connect(master);
  thud.start(t);
  thud.stop(t + 0.26);
}

/** Cosmic stamp when a draft pick lands in the roster (matches pick flash animation). */
export function playDraftPickSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;

  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.gain.exponentialRampToValueAtTime(0.5, t + 0.018);
  master.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
  master.connect(ctx.destination);

  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(165, t);
  thud.frequency.exponentialRampToValueAtTime(82, t + 0.14);
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.7, t);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  thud.connect(thudGain);
  thudGain.connect(master);
  thud.start(t);
  thud.stop(t + 0.22);

  const gold = ctx.createOscillator();
  gold.type = 'triangle';
  gold.frequency.setValueAtTime(784, t + 0.025);
  gold.frequency.exponentialRampToValueAtTime(1175, t + 0.16);
  const goldGain = ctx.createGain();
  goldGain.gain.setValueAtTime(0.0001, t);
  goldGain.gain.linearRampToValueAtTime(0.28, t + 0.04);
  goldGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  gold.connect(goldGain);
  goldGain.connect(master);
  gold.start(t + 0.025);
  gold.stop(t + 0.45);

  const teal = ctx.createOscillator();
  teal.type = 'sine';
  teal.frequency.setValueAtTime(588, t + 0.05);
  teal.frequency.exponentialRampToValueAtTime(880, t + 0.28);
  const tealGain = ctx.createGain();
  tealGain.gain.setValueAtTime(0.0001, t);
  tealGain.gain.linearRampToValueAtTime(0.18, t + 0.07);
  tealGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  teal.connect(tealGain);
  tealGain.connect(master);
  teal.start(t + 0.05);
  teal.stop(t + 0.58);
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const size = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playTone(
  ctx: AudioContext,
  dest: AudioNode,
  {
    type = 'sine',
    freq,
    endFreq,
    start,
    dur,
    peak = 0.16,
  }: {
    type?: OscillatorType;
    freq: number;
    endFreq?: number;
    start: number;
    dur: number;
    peak?: number;
  },
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq != null) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 20), start + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/** Master bus with a limiter so the big layered hits stay loud without clipping. */
function limitedMaster(ctx: AudioContext, level = 1): GainNode {
  const master = ctx.createGain();
  master.gain.value = level;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 6;
  comp.ratio.value = 8;
  comp.attack.value = 0.002;
  comp.release.value = 0.18;
  master.connect(comp);
  comp.connect(ctx.destination);
  return master;
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    start: number;
    dur: number;
    peak: number;
    filter: BiquadFilterType;
    freq: number;
    endFreq?: number;
    q?: number;
    drive?: number;
  },
) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, opts.dur + 0.02);
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filter;
  filter.frequency.setValueAtTime(opts.freq, opts.start);
  if (opts.endFreq) filter.frequency.exponentialRampToValueAtTime(opts.endFreq, opts.start + opts.dur);
  filter.Q.value = opts.q ?? 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, opts.start);
  gain.gain.exponentialRampToValueAtTime(opts.peak, opts.start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur);
  src.connect(filter);
  if (opts.drive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(opts.drive);
    shaper.oversample = '2x';
    filter.connect(shaper);
    shaper.connect(gain);
  } else {
    filter.connect(gain);
  }
  gain.connect(dest);
  src.start(opts.start);
  src.stop(opts.start + opts.dur + 0.02);
}

/** Punchy crunch with a small chime when you capture an enemy piece. */
export function playCaptureSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = limitedMaster(ctx, 1);

  // Thump
  playTone(ctx, master, { type: 'sine', freq: 170, endFreq: 55, start: t, dur: 0.24, peak: 0.34 });
  playTone(ctx, master, { type: 'triangle', freq: 230, endFreq: 90, start: t, dur: 0.12, peak: 0.16 });

  // Crunch
  noiseBurst(ctx, master, {
    start: t,
    dur: 0.14,
    peak: 0.22,
    filter: 'bandpass',
    freq: 1900,
    endFreq: 520,
    q: 0.9,
    drive: 18,
  });

  // Light clang + two-note chime
  playTone(ctx, master, { type: 'triangle', freq: 1370, endFreq: 1260, start: t + 0.01, dur: 0.18, peak: 0.05 });
  [1318, 1760].forEach((freq, i) => {
    playTone(ctx, master, { type: 'triangle', freq, start: t + 0.08 + i * 0.06, dur: 0.14, peak: 0.07 });
  });
}

/** Heavy thud with a short sinking tone when one of your pieces is taken. */
export function playPieceLostSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = limitedMaster(ctx, 1);

  // Thud
  playTone(ctx, master, { type: 'sine', freq: 140, endFreq: 40, start: t, dur: 0.34, peak: 0.36 });
  noiseBurst(ctx, master, {
    start: t,
    dur: 0.13,
    peak: 0.18,
    filter: 'lowpass',
    freq: 1200,
    endFreq: 200,
    drive: 12,
  });

  // Small crack
  noiseBurst(ctx, master, { start: t + 0.02, dur: 0.16, peak: 0.07, filter: 'highpass', freq: 4000, q: 1.1 });

  // Sinking "wahh"
  const horn = ctx.createBiquadFilter();
  horn.type = 'lowpass';
  horn.frequency.value = 900;
  horn.Q.value = 1.5;
  horn.connect(master);
  const start = t + 0.1;
  const dur = 0.36;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(277, start);
  osc.frequency.exponentialRampToValueAtTime(196, start + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.1, start + 0.03);
  gain.gain.setValueAtTime(0.1, start + dur * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(horn);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** One-shot retro sword slash when your king is put in check. */
export function playCheckSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  // Blade whoosh — filtered noise sweeping down like an 8-bit slash
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 0.22);
  const hipass = ctx.createBiquadFilter();
  hipass.type = 'highpass';
  hipass.frequency.setValueAtTime(2800, t);
  hipass.frequency.exponentialRampToValueAtTime(420, t + 0.16);
  hipass.Q.value = 0.7;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(4200, t);
  band.frequency.exponentialRampToValueAtTime(700, t + 0.18);
  band.Q.value = 1.4;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, t);
  nGain.gain.linearRampToValueAtTime(0.38, t + 0.012);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  noise.connect(hipass);
  hipass.connect(band);
  band.connect(nGain);
  nGain.connect(master);
  noise.start(t);
  noise.stop(t + 0.22);

  // NES-style square dive (the "hit")
  playTone(ctx, master, { type: 'square', freq: 1480, endFreq: 220, start: t, dur: 0.14, peak: 0.2 });
  playTone(ctx, master, { type: 'square', freq: 980, endFreq: 140, start: t + 0.02, dur: 0.12, peak: 0.12 });
  // Tiny metallic ping
  playTone(ctx, master, { type: 'square', freq: 2480, endFreq: 1760, start: t + 0.04, dur: 0.06, peak: 0.09 });
}

/** Rising fanfare when you put the opponent in check — the reverse of the slash. */
export function playCheckDealtSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 0.28);
  const hipass = ctx.createBiquadFilter();
  hipass.type = 'highpass';
  hipass.frequency.setValueAtTime(380, t);
  hipass.frequency.exponentialRampToValueAtTime(3200, t + 0.2);
  hipass.Q.value = 0.6;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, t);
  nGain.gain.linearRampToValueAtTime(0.22, t + 0.04);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  noise.connect(hipass);
  hipass.connect(nGain);
  nGain.connect(master);
  noise.start(t);
  noise.stop(t + 0.28);

  playTone(ctx, master, { type: 'square', freq: 330, endFreq: 660, start: t, dur: 0.1, peak: 0.14 });
  playTone(ctx, master, { type: 'square', freq: 523, endFreq: 1046, start: t + 0.08, dur: 0.12, peak: 0.13 });
  playTone(ctx, master, { type: 'triangle', freq: 784, endFreq: 1568, start: t + 0.16, dur: 0.16, peak: 0.11 });
  playTone(ctx, master, { type: 'sine', freq: 1318, endFreq: 1760, start: t + 0.22, dur: 0.18, peak: 0.08 });
}

/** Cool descending wash as day becomes night. */
export function playDayToNightSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  playTone(ctx, master, { type: 'sine', freq: 392, endFreq: 196, start: t, dur: 0.55, peak: 0.12 });
  playTone(ctx, master, { type: 'triangle', freq: 494, endFreq: 247, start: t + 0.06, dur: 0.5, peak: 0.07 });

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1400, t);
  filter.frequency.exponentialRampToValueAtTime(280, t + 0.45);
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, t);
  nGain.gain.linearRampToValueAtTime(0.045, t + 0.08);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(master);
  noise.start(t);
  noise.stop(t + 0.5);
}

/** Warm rising chime as night becomes day. */
export function playNightToDaySfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  playTone(ctx, master, { type: 'sine', freq: 196, endFreq: 392, start: t, dur: 0.5, peak: 0.11 });
  playTone(ctx, master, { type: 'triangle', freq: 247, endFreq: 523, start: t + 0.08, dur: 0.46, peak: 0.07 });
}

/**
 * Card cast: a card-flick whoosh, then the card's own signature sound (see `CARD_SFX`).
 * Cards without a signature fall back to a ringing rune chord with an echo tail.
 * Your casts resolve bright; opponent casts resolve lower and darker.
 */
export function playCardCastSfx(mine = true, defId?: string | null) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = limitedMaster(ctx, 0.95);

  if (defId && playCardSignatureSfx(defId, mine)) {
    noiseBurst(ctx, master, { start: t, dur: 0.05, peak: 0.1, filter: 'highpass', freq: 2600 });
    noiseBurst(ctx, master, { start: t + 0.02, dur: 0.14, peak: 0.06, filter: 'bandpass', freq: 700, endFreq: 2800, q: 1.4 });
    return;
  }

  const bus = ctx.createGain();
  bus.connect(master);
  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.15;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3200;
  const wet = ctx.createGain();
  wet.gain.value = 0.38;
  bus.connect(echo);
  echo.connect(tone);
  tone.connect(feedback);
  feedback.connect(echo);
  tone.connect(wet);
  wet.connect(master);

  // Card flick + rising swoosh
  noiseBurst(ctx, bus, { start: t, dur: 0.05, peak: 0.12, filter: 'highpass', freq: 2600 });
  noiseBurst(ctx, bus, { start: t + 0.02, dur: 0.3, peak: 0.08, filter: 'bandpass', freq: 500, endFreq: 3400, q: 1.4 });

  // Charging glide
  const [glideFrom, glideTo] = mine ? [330, 660] : [262, 466];
  playTone(ctx, bus, { type: 'sine', freq: glideFrom, endFreq: glideTo, start: t + 0.03, dur: 0.26, peak: 0.08 });
  playTone(ctx, bus, { type: 'triangle', freq: glideFrom * 1.007, endFreq: glideTo * 1.007, start: t + 0.03, dur: 0.26, peak: 0.04 });

  // Release: soft whomp + rune chord
  const hit = t + 0.27;
  playTone(ctx, master, { type: 'sine', freq: 120, endFreq: 62, start: hit, dur: 0.3, peak: 0.2 });
  const chord = mine ? [659, 831, 988, 1319] : [587, 698, 880, 1047];
  chord.forEach((freq, i) => {
    const start = hit + i * 0.025;
    playTone(ctx, bus, { type: 'triangle', freq, start, dur: 0.85, peak: 0.055 });
    playTone(ctx, bus, { type: 'sine', freq: freq * 2.01, start, dur: 0.45, peak: 0.018 });
  });

  // Shimmer dust
  const sparkles = mine ? [3520, 2960, 3950, 2637, 3320] : [2490, 2217, 2793, 1976, 2349];
  sparkles.forEach((freq, i) => {
    playTone(ctx, bus, { type: 'sine', freq, start: hit + 0.05 + i * 0.055, dur: 0.12, peak: 0.025 });
  });
}

/** Quiet paper flick when a card is discarded. */
export function playCardDiscardSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 0.14);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1700, t);
  filter.frequency.exponentialRampToValueAtTime(700, t + 0.1);
  filter.Q.value = 0.9;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, t);
  nGain.gain.linearRampToValueAtTime(0.08, t + 0.012);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(master);
  noise.start(t);
  noise.stop(t + 0.14);

  playTone(ctx, master, { type: 'triangle', freq: 220, endFreq: 140, start: t + 0.02, dur: 0.08, peak: 0.06 });
}

/** Soft deal swoosh when a card is drawn into hand. */
export function playCardDrawSfx(count = 1) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const n = Math.min(4, Math.max(1, Math.floor(count)));
  for (let i = 0; i < n; i++) {
    const start = t + i * 0.068;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, start);
    filter.frequency.exponentialRampToValueAtTime(900, start + 0.09);
    filter.Q.value = 0.75;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, start);
    nGain.gain.linearRampToValueAtTime(0.07, start + 0.01);
    nGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(master);
    noise.start(start);
    noise.stop(start + 0.12);

    playTone(ctx, master, {
      type: 'triangle',
      freq: 360 + i * 18,
      endFreq: 210,
      start: start + 0.015,
      dur: 0.09,
      peak: 0.055,
    });
  }
}

/** Soft chime when a room/lobby is created. */
export function playLobbyCreatedSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  playTone(ctx, master, { type: 'sine', freq: 392, endFreq: 523, start: t, dur: 0.18, peak: 0.12 });
  playTone(ctx, master, { type: 'triangle', freq: 523, endFreq: 659, start: t + 0.09, dur: 0.2, peak: 0.1 });
  playTone(ctx, master, { type: 'sine', freq: 784, endFreq: 988, start: t + 0.2, dur: 0.28, peak: 0.09 });
}

/** Clash sting when the second player joins (Player vs Player). */
export function playMatchJoinSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  playTone(ctx, master, { type: 'triangle', freq: 140, endFreq: 88, start: t, dur: 0.14, peak: 0.2 });
  playTone(ctx, master, { type: 'triangle', freq: 210, endFreq: 120, start: t + 0.12, dur: 0.16, peak: 0.18 });
  playTone(ctx, master, { type: 'sine', freq: 660, endFreq: 880, start: t + 0.16, dur: 0.22, peak: 0.11 });
  playTone(ctx, master, { type: 'triangle', freq: 990, endFreq: 1320, start: t + 0.22, dur: 0.2, peak: 0.07 });

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 0.18);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1200;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, t + 0.1);
  nGain.gain.linearRampToValueAtTime(0.07, t + 0.14);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(master);
  noise.start(t + 0.1);
  noise.stop(t + 0.28);
}

/** Stamp when Black chooses who drafts first. */
export function playDraftOrderSfx(whiteFirst: boolean) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const base = whiteFirst ? 196 : 147;
  playTone(ctx, master, { type: 'sine', freq: base * 2, endFreq: base, start: t, dur: 0.16, peak: 0.2 });
  playTone(ctx, master, {
    type: 'triangle',
    freq: whiteFirst ? 784 : 587,
    endFreq: whiteFirst ? 1046 : 784,
    start: t + 0.05,
    dur: 0.32,
    peak: 0.12,
  });
  playTone(ctx, master, {
    type: 'sine',
    freq: whiteFirst ? 523 : 392,
    endFreq: whiteFirst ? 659 : 494,
    start: t + 0.12,
    dur: 0.28,
    peak: 0.08,
  });
}

type FxLayerTiming = {
  /** Start offset in seconds. */
  at?: number;
  /** Duration in seconds. */
  d: number;
  /** Peak gain. */
  v?: number;
  /** Attack time in seconds. */
  a?: number;
  /** End frequency (exponential sweep). */
  to?: number;
};
type FxLayer =
  | (FxLayerTiming & { tone: OscillatorType; f: number; vib?: [rate: number, depth: number] })
  | (FxLayerTiming & { noise: BiquadFilterType; f: number; q?: number });

const tone = (
  type: OscillatorType,
  f: number,
  d: number,
  o: Omit<Extract<FxLayer, { tone: OscillatorType }>, 'tone' | 'f' | 'd'> = {},
): FxLayer => ({ tone: type, f, d, ...o });
const noise = (
  type: BiquadFilterType,
  f: number,
  d: number,
  o: Omit<Extract<FxLayer, { noise: BiquadFilterType }>, 'noise' | 'f' | 'd'> = {},
): FxLayer => ({ noise: type, f, d, ...o });

type LayerPlayback = {
  gain: number;
  maxGain: number;
  stretch: number;
  sweep: number;
  vibrato: number;
  echoDelay: number;
  echoFeedback: number;
  echoMix: number;
  /** Frequency multiplier applied to every layer. */
  pitch?: number;
  /** Seconds to wait before the first layer. */
  delay?: number;
};

/** Ability sounds are deliberately over the top: louder, longer, wider sweeps, deeper wobble, plus an echo. */
const ABILITY_EXAGGERATION: LayerPlayback = {
  gain: 1.9,
  maxGain: 0.42,
  stretch: 1.4,
  sweep: 1.6,
  vibrato: 2,
  echoDelay: 0.17,
  echoFeedback: 0.38,
  echoMix: 0.45,
};

/** Card signatures play as written, with a light echo. */
const CARD_PLAYBACK: LayerPlayback = {
  gain: 1.2,
  maxGain: 0.3,
  stretch: 1,
  sweep: 1,
  vibrato: 1,
  echoDelay: 0.14,
  echoFeedback: 0.26,
  echoMix: 0.28,
};

function exaggeratedSweep(f: number, to: number | undefined, sweep: number): number | undefined {
  if (to == null) return undefined;
  const swept = f * Math.pow(to / f, sweep);
  return Math.min(18000, Math.max(20, swept));
}

function playLayers(layers: FxLayer[], x: LayerPlayback = ABILITY_EXAGGERATION) {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.01 + (x.delay ?? 0);
  const pitch = x.pitch ?? 1;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(limiter);

  const echo = ctx.createDelay(1);
  echo.delayTime.value = x.echoDelay;
  const feedback = ctx.createGain();
  feedback.gain.value = x.echoFeedback;
  const wet = ctx.createGain();
  wet.gain.value = x.echoMix;
  master.connect(echo);
  echo.connect(feedback);
  feedback.connect(echo);
  echo.connect(wet);
  wet.connect(limiter);

  let lastEnd = t0;
  for (const layer of layers) {
    const start = t0 + (layer.at ?? 0) * x.stretch;
    const dur = layer.d * x.stretch;
    const end = start + dur;
    lastEnd = Math.max(lastEnd, end);
    const attack = Math.min((layer.a ?? 0.012) * x.stretch, dur * 0.8);
    const peak = Math.min((layer.v ?? 0.1) * x.gain, x.maxGain);
    const f = layer.f * pitch;
    const to = exaggeratedSweep(f, layer.to == null ? undefined : layer.to * pitch, x.sweep);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(master);

    if ('tone' in layer) {
      const osc = ctx.createOscillator();
      osc.type = layer.tone;
      osc.frequency.setValueAtTime(f, start);
      if (to != null) osc.frequency.exponentialRampToValueAtTime(to, end);
      if (layer.vib) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = layer.vib[0];
        depth.gain.value = layer.vib[1] * x.vibrato;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(start);
        lfo.stop(end + 0.02);
      }
      osc.connect(gain);
      osc.start(start);
      osc.stop(end + 0.02);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, dur + 0.03);
      const filter = ctx.createBiquadFilter();
      filter.type = layer.noise;
      filter.frequency.setValueAtTime(f, start);
      if (to != null) filter.frequency.exponentialRampToValueAtTime(to, end);
      filter.Q.value = (layer.q ?? 1) * 1.4;
      src.connect(filter);
      filter.connect(gain);
      src.start(start);
      src.stop(end + 0.02);
    }
  }

  const tailMs = (lastEnd - ctx.currentTime + 2) * 1000;
  window.setTimeout(() => {
    feedback.disconnect();
    echo.disconnect();
    wet.disconnect();
    master.disconnect();
    limiter.disconnect();
  }, tailMs);
}

/** One recipe per ability id recorded by the engine (`state.abilityFx`). */
const ABILITY_SFX: Record<string, FxLayer[]> = {
  // Gnome — ratchet clicks, then a springy gadget pop
  gadget_deploy: [
    noise('highpass', 3000, 0.03, { v: 0.12 }),
    noise('highpass', 3200, 0.03, { at: 0.06, v: 0.12 }),
    noise('highpass', 3400, 0.03, { at: 0.12, v: 0.12 }),
    tone('square', 220, 0.2, { to: 440, at: 0.18, v: 0.06 }),
    tone('triangle', 330, 0.28, { to: 660, at: 0.2, v: 0.1, vib: [22, 40] }),
  ],
  ice_floor: [
    noise('highpass', 4200, 0.4, { to: 2500, v: 0.1 }),
    tone('sine', 2100, 0.4, { to: 1200, v: 0.05, vib: [14, 40] }),
  ],
  spring_board: [tone('triangle', 160, 0.4, { to: 720, v: 0.14, vib: [18, 60] })],
  gnome_hole: [
    tone('sine', 650, 0.18, { to: 90, v: 0.12 }),
    tone('sine', 90, 0.15, { to: 520, at: 0.24, v: 0.12 }),
    noise('lowpass', 600, 0.06, { at: 0.36, v: 0.1 }),
  ],
  // Fleece — pickpocket swish and disguise warble; coin blip when loot is stored
  identity_theft: [
    noise('bandpass', 3200, 0.22, { to: 700, q: 1.2, v: 0.18 }),
    tone('sine', 880, 0.12, { to: 440, at: 0.08, v: 0.08 }),
    tone('triangle', 220, 0.4, { to: 330, at: 0.18, v: 0.1, vib: [6, 12] }),
  ],
  identity_loot: [tone('square', 988, 0.08, { v: 0.07 }), tone('square', 1319, 0.22, { at: 0.07, v: 0.07 })],
  fraudulent_fate: [
    tone('sawtooth', 392, 0.2, { v: 0.06 }),
    tone('sawtooth', 370, 0.2, { at: 0.22, v: 0.06 }),
    tone('sawtooth', 349, 0.45, { to: 262, at: 0.44, v: 0.06, vib: [6, 8] }),
  ],
  // Wizard — sparkle arpeggio; Magic Be-gone drains everything downward
  enchant: [
    ...[880, 1109, 1319, 1760].map((f, i) => tone('sine', f, 0.22, { at: i * 0.06, v: 0.09 })),
    noise('highpass', 6000, 0.35, { at: 0.05, v: 0.03 }),
  ],
  magic_begone: [
    tone('sawtooth', 1400, 0.45, { to: 120, v: 0.06 }),
    tone('sine', 700, 0.4, { to: 90, at: 0.03, v: 0.1 }),
    noise('lowpass', 4000, 0.45, { to: 200, v: 0.09 }),
  ],
  // Angel — slow choir swell to start, bright bell when the piece returns
  revive_ritual: [
    tone('triangle', 523, 0.9, { a: 0.3, v: 0.07 }),
    tone('triangle', 659, 0.9, { a: 0.35, at: 0.05, v: 0.06 }),
    tone('triangle', 784, 0.9, { a: 0.4, at: 0.1, v: 0.05 }),
    tone('sine', 1047, 0.8, { a: 0.3, at: 0.2, v: 0.03, vib: [5, 6] }),
  ],
  revive_complete: [
    tone('sine', 1047, 1.2, { v: 0.12 }),
    tone('sine', 1568, 1.0, { v: 0.06 }),
    tone('sine', 2093, 0.8, { v: 0.04 }),
    tone('triangle', 523, 0.9, { at: 0.05, v: 0.06 }),
  ],
  bless: [
    tone('sine', 784, 0.6, { a: 0.08, v: 0.08 }),
    tone('sine', 1175, 0.6, { a: 0.1, at: 0.08, v: 0.06 }),
    tone('sine', 1568, 0.7, { a: 0.12, at: 0.16, v: 0.04, vib: [6, 4] }),
  ],
  // Crystalite — glassy pings
  barrier_shift: [
    tone('sine', 2637, 0.25, { v: 0.07 }),
    tone('sine', 3136, 0.3, { at: 0.09, v: 0.06 }),
    noise('highpass', 5000, 0.3, { to: 2000, at: 0.02, v: 0.05 }),
    tone('triangle', 1319, 0.35, { to: 1976, at: 0.15, v: 0.06 }),
  ],
  barrier_phase: [
    tone('sine', 1568, 0.4, { to: 784, v: 0.08, vib: [9, 30] }),
    noise('bandpass', 2500, 0.3, { q: 4, v: 0.06 }),
  ],
  // TimeKeeper — clock ticks into a warp
  temporal_shift: [
    ...[0, 0.14, 0.28, 0.42].map((at, i) => tone('square', i % 2 ? 1500 : 2000, 0.03, { at, v: 0.07 })),
    tone('sine', 300, 0.55, { to: 1200, at: 0.1, v: 0.09, vib: [7, 25] }),
  ],
  // Crocodile — vacuum inhale, launch, chomp
  ultimate_suck: [
    noise('lowpass', 200, 0.4, { to: 3200, a: 0.36, v: 0.2 }),
    tone('sine', 120, 0.4, { to: 500, a: 0.3, v: 0.08 }),
    tone('sine', 260, 0.18, { to: 1100, at: 0.4, v: 0.14 }),
    tone('square', 150, 0.09, { to: 60, at: 0.58, v: 0.12 }),
    noise('lowpass', 900, 0.08, { at: 0.58, v: 0.12 }),
  ],
  // Rook — two heavy thunks and a little fanfare
  castle_swap: [
    tone('triangle', 170, 0.14, { to: 80, v: 0.18 }),
    tone('triangle', 150, 0.14, { to: 70, at: 0.13, v: 0.18 }),
    tone('square', 523, 0.12, { at: 0.24, v: 0.06 }),
    tone('square', 784, 0.22, { at: 0.33, v: 0.06 }),
  ],
  // Stoneman — grinding stone
  ancient_shuffle: [
    noise('lowpass', 420, 0.55, { to: 220, a: 0.08, v: 0.2 }),
    tone('sine', 72, 0.55, { to: 52, a: 0.06, v: 0.16 }),
    tone('triangle', 110, 0.3, { to: 90, at: 0.25, v: 0.06 }),
  ],
  // Yeti — huge ground-shaking boom
  giga_stomp: [
    tone('sine', 95, 0.7, { to: 28, v: 0.3 }),
    tone('square', 62, 0.35, { to: 35, v: 0.08 }),
    noise('lowpass', 320, 0.5, { to: 80, v: 0.3 }),
  ],
  // Reaper
  swap_of_fates: [
    tone('sine', 300, 0.45, { to: 620, v: 0.09 }),
    tone('sine', 620, 0.45, { to: 300, v: 0.09 }),
    tone('triangle', 150, 0.5, { v: 0.05, vib: [4, 8] }),
  ],
  shadow_step: [
    noise('bandpass', 900, 0.3, { to: 180, q: 1.2, v: 0.14 }),
    tone('sine', 220, 0.3, { to: 100, v: 0.08 }),
  ],
  death_stare: [
    tone('sawtooth', 110, 0.5, { a: 0.05, v: 0.06 }),
    tone('square', 55, 0.5, { v: 0.06 }),
    tone('sine', 1760, 0.18, { to: 880, at: 0.05, v: 0.08 }),
    noise('bandpass', 300, 0.4, { q: 2, v: 0.07 }),
  ],
  soul_lock: [
    tone('square', 1800, 0.07, { v: 0.05 }),
    tone('square', 2400, 0.07, { at: 0.05, v: 0.05 }),
    tone('square', 1800, 0.07, { at: 0.16, v: 0.05 }),
    tone('square', 2400, 0.1, { at: 0.21, v: 0.05 }),
    tone('sine', 150, 0.45, { to: 110, v: 0.1 }),
  ],
  world_shatterer: [
    noise('highpass', 2500, 0.6, { v: 0.18 }),
    tone('sine', 60, 0.8, { to: 25, v: 0.28 }),
    ...[3200, 2700, 2100, 3700].map((f, i) => tone('triangle', f, 0.12, { to: f * 0.6, at: 0.05 + i * 0.05, v: 0.05 })),
  ],
  reaper_harvest: [
    tone('sine', 196, 1.4, { v: 0.14 }),
    tone('sine', 392, 1.1, { v: 0.06 }),
    tone('sine', 588, 0.8, { v: 0.04 }),
    tone('triangle', 98, 1.2, { v: 0.06 }),
  ],
  // Pig — squeaky double boop and an oink
  best_buddy: [
    tone('square', 660, 0.08, { to: 990, v: 0.06 }),
    tone('square', 990, 0.12, { to: 1320, at: 0.09, v: 0.06 }),
    tone('triangle', 320, 0.16, { to: 210, at: 0.2, v: 0.12, vib: [30, 20] }),
  ],
  // Archer — bowstring twang, arrow whoosh, thunk; Steady Aim focus ping
  archer_shot: [
    tone('triangle', 240, 0.16, { to: 170, v: 0.16, vib: [40, 15] }),
    noise('highpass', 6500, 0.2, { to: 1800, at: 0.03, v: 0.12 }),
    tone('sine', 200, 0.06, { to: 90, at: 0.22, v: 0.14 }),
  ],
  steady_aim: [tone('sine', 1000, 0.15, { v: 0.06 }), tone('sine', 1500, 0.2, { at: 0.12, v: 0.07 })],
  // Snake — hiss and growl
  bloodlust: [
    noise('highpass', 5000, 0.45, { a: 0.05, v: 0.12 }),
    tone('sawtooth', 110, 0.4, { to: 80, v: 0.06, vib: [25, 10] }),
  ],
  // Leapfrog — boing
  leap: [tone('sine', 300, 0.14, { to: 950, v: 0.12 }), tone('sine', 950, 0.16, { to: 420, at: 0.14, v: 0.1 })],
  // Worm — dirt digging
  burrow: [
    noise('lowpass', 500, 0.06, { v: 0.16 }),
    noise('lowpass', 450, 0.06, { at: 0.08, v: 0.16 }),
    noise('lowpass', 400, 0.08, { at: 0.16, v: 0.16 }),
    tone('sine', 130, 0.3, { to: 70, v: 0.1 }),
  ],
  // Ghost — wavering "oooh"
  phase_walk: [
    tone('sine', 440, 0.55, { to: 330, a: 0.1, v: 0.09, vib: [5, 14] }),
    tone('triangle', 660, 0.5, { to: 495, a: 0.12, v: 0.04, vib: [5, 20] }),
  ],
  // Spiders — silk thwips and sticky snares
  trail_of_webs: [
    noise('highpass', 3500, 0.06, { v: 0.08 }),
    tone('triangle', 1300, 0.09, { to: 420, v: 0.08 }),
    tone('triangle', 1100, 0.09, { to: 380, at: 0.08, v: 0.07 }),
  ],
  web_snare: [
    tone('sawtooth', 210, 0.3, { to: 120, v: 0.05 }),
    noise('lowpass', 900, 0.25, { to: 300, v: 0.12 }),
    tone('sine', 500, 0.12, { to: 250, at: 0.15, v: 0.06 }),
  ],
  spider_web: [
    tone('square', 900, 0.08, { to: 300, v: 0.06 }),
    tone('square', 800, 0.1, { to: 260, at: 0.09, v: 0.06 }),
    noise('lowpass', 700, 0.2, { at: 0.1, v: 0.1 }),
  ],
  // Demon — detuned growl while a soul is drawn in
  soul_syphon: [
    tone('sawtooth', 80, 0.6, { a: 0.1, v: 0.06 }),
    tone('sawtooth', 83, 0.6, { a: 0.1, v: 0.05 }),
    tone('sine', 700, 0.5, { to: 90, v: 0.08 }),
    noise('lowpass', 200, 0.5, { to: 1200, a: 0.3, v: 0.08 }),
  ],
  // Vampire — blood drip
  blood_token: [tone('sine', 1200, 0.08, { to: 400, v: 0.12 }), tone('sine', 900, 0.1, { to: 300, at: 0.14, v: 0.08 })],
  // Snail — slimy sweep; sad sigh when out of tiles
  snail_wipe: [
    noise('lowpass', 300, 0.6, { to: 1800, a: 0.2, v: 0.18 }),
    tone('sine', 220, 0.6, { to: 45, v: 0.14 }),
    tone('triangle', 440, 0.4, { to: 110, at: 0.1, v: 0.05 }),
  ],
  snail_exhausted: [
    tone('triangle', 330, 0.35, { to: 262, v: 0.08 }),
    tone('triangle', 262, 0.5, { to: 165, at: 0.3, v: 0.08 }),
  ],
  // Prince & Princess — sweet harmony; heartbreak when both fall
  dance_of_romance: [
    tone('sine', 523, 0.3, { v: 0.07 }),
    tone('sine', 659, 0.3, { v: 0.06 }),
    tone('sine', 659, 0.4, { at: 0.2, v: 0.07 }),
    tone('sine', 784, 0.4, { at: 0.2, v: 0.06 }),
  ],
  true_love: [
    tone('triangle', 659, 0.35, { v: 0.08 }),
    tone('triangle', 622, 0.35, { at: 0.3, v: 0.08 }),
    tone('triangle', 523, 0.7, { to: 440, at: 0.6, v: 0.08, vib: [5, 6] }),
  ],
  // President — three gavel raps call the session, then a brass fanfare when the law passes
  president_session: [
    ...[0, 0.2, 0.4].map((at) => noise('lowpass', 900, 0.06, { at, v: 0.2 })),
    ...[0, 0.2, 0.4].map((at) => tone('sine', 190, 0.12, { to: 120, at, v: 0.12 })),
  ],
  president_law: [
    noise('lowpass', 1100, 0.07, { v: 0.22 }),
    tone('sine', 170, 0.16, { to: 100, v: 0.14 }),
    tone('sawtooth', 392, 0.16, { at: 0.16, v: 0.05 }),
    tone('sawtooth', 523, 0.16, { at: 0.3, v: 0.05 }),
    tone('sawtooth', 659, 0.5, { at: 0.44, v: 0.05, vib: [5, 4] }),
    tone('sawtooth', 523, 0.5, { at: 0.44, v: 0.035 }),
    tone('triangle', 784, 0.5, { at: 0.44, v: 0.04 }),
  ],
  // Gambler — dice rattle and a ding
  lucky_draw: [
    ...[0, 0.05, 0.11, 0.16, 0.24, 0.3].map((at) => noise('bandpass', 2400, 0.025, { at, q: 3, v: 0.12 })),
    tone('square', 1047, 0.12, { at: 0.38, v: 0.06 }),
    tone('square', 1568, 0.25, { at: 0.47, v: 0.06 }),
  ],
  // Prototype — a servo shift into each forme, then that forme's signature
  forme_speed: [
    ...[0, 0.06].map((at) => tone('square', 900, 0.04, { at, v: 0.05 })),
    tone('sine', 300, 0.3, { to: 2400, at: 0.1, v: 0.1, vib: [40, 80] }),
    noise('highpass', 3000, 0.3, { to: 9000, at: 0.1, v: 0.07 }),
  ],
  forme_attack: [
    ...[0, 0.06].map((at) => tone('square', 900, 0.04, { at, v: 0.05 })),
    tone('sawtooth', 110, 0.45, { to: 220, at: 0.1, v: 0.09, vib: [30, 15] }),
    noise('highpass', 5000, 0.12, { to: 9000, at: 0.3, v: 0.14 }),
  ],
  forme_defense: [
    ...[0, 0.06].map((at) => tone('square', 900, 0.04, { at, v: 0.05 })),
    tone('triangle', 180, 0.5, { to: 120, at: 0.1, v: 0.16 }),
    tone('sine', 1100, 0.6, { at: 0.1, v: 0.07, vib: [7, 12] }),
    noise('bandpass', 2500, 0.12, { at: 0.1, q: 5, v: 0.14 }),
  ],
  forme_temporal: [
    ...[0, 0.06].map((at) => tone('square', 900, 0.04, { at, v: 0.05 })),
    tone('sine', 1200, 0.6, { to: 80, at: 0.1, v: 0.1, vib: [24, 200] }),
    tone('sine', 660, 0.9, { at: 0.2, v: 0.05, vib: [3, 20] }),
    ...[0.35, 0.6, 0.85].map((at) => noise('bandpass', 2400, 0.03, { at, q: 6, v: 0.1 })),
  ],
  forme_reboot: [
    tone('sawtooth', 440, 0.7, { to: 55, v: 0.09 }),
    noise('lowpass', 1500, 0.5, { to: 150, at: 0.1, v: 0.1 }),
    tone('square', 220, 0.06, { at: 0.75, v: 0.04 }),
  ],
  attack_bonus: [
    noise('bandpass', 2000, 0.08, { q: 2, v: 0.16 }),
    noise('bandpass', 2400, 0.08, { at: 0.1, q: 2, v: 0.16 }),
    tone('square', 440, 0.2, { to: 880, at: 0.18, v: 0.07 }),
  ],
  defense_drone: [
    noise('lowpass', 1200, 0.12, { v: 0.16 }),
    tone('sawtooth', 200, 0.6, { to: 600, at: 0.08, v: 0.06, vib: [60, 30] }),
    tone('square', 1200, 0.06, { at: 0.5, v: 0.05 }),
    tone('square', 1600, 0.1, { at: 0.58, v: 0.05 }),
  ],
};

/** Play the sound for an ability id recorded by the engine. */
export function playAbilitySfx(id: string) {
  const layers = ABILITY_SFX[id];
  if (layers) playLayers(layers);
}

/** Signature sound per spell card id, layered on top of a short shared card flick. */
const CARD_SFX: Record<string, FxLayer[]> = {
  // Stone wall grinding up out of the floor, then settling with a clank
  barrier: [
    noise('lowpass', 180, 0.45, { to: 700, a: 0.08, v: 0.2 }),
    tone('sine', 95, 0.35, { to: 55, v: 0.26 }),
    tone('square', 330, 0.08, { at: 0.32, v: 0.05 }),
    noise('bandpass', 900, 0.12, { at: 0.32, q: 2, v: 0.12 }),
  ],
  // Zip out, pop, and a faint zip back (the marked return square)
  blink: [
    tone('sine', 600, 0.1, { to: 2400, v: 0.12 }),
    tone('sine', 1800, 0.06, { at: 0.11, v: 0.1 }),
    tone('sine', 2400, 0.12, { at: 0.22, to: 600, v: 0.05 }),
  ],
  // Shimmering rising arpeggio over a warm pad
  enchant: [
    tone('sine', 262, 0.8, { a: 0.2, v: 0.06 }),
    ...[523, 659, 784, 1047].map((f, i) => tone('triangle', f, 0.3, { at: i * 0.08, v: 0.08, vib: [6, 6] })),
  ],
  // Hoofbeats, then a short regal fanfare
  kingstead: [
    ...[0, 0.09, 0.25, 0.34].map((at) => noise('bandpass', 1200, 0.05, { at, q: 3, v: 0.16 })),
    tone('triangle', 392, 0.35, { at: 0.42, to: 523, v: 0.1 }),
    tone('triangle', 659, 0.3, { at: 0.48, v: 0.07 }),
  ],
  // Revving zoom that tops out in a blip
  speed_plus: [
    tone('sawtooth', 200, 0.35, { to: 1600, v: 0.06 }),
    noise('highpass', 2000, 0.3, { to: 6000, v: 0.08 }),
    tone('square', 1568, 0.06, { at: 0.34, v: 0.06 }),
  ],
  // Calculator beeps climbing to a "plus" chime
  mathematical: [
    ...[880, 1175, 1568].map((f, i) => tone('square', f, 0.05, { at: i * 0.08, v: 0.05 })),
    tone('sine', 2093, 0.25, { at: 0.24, v: 0.1 }),
    tone('sine', 2637, 0.2, { at: 0.24, v: 0.04 }),
  ],
  // Shield clang
  fortify: [
    tone('sine', 131, 0.3, { v: 0.2 }),
    noise('bandpass', 3000, 0.06, { q: 1.5, v: 0.14 }),
    tone('square', 523, 0.4, { to: 510, v: 0.06 }),
    tone('triangle', 1046, 0.5, { to: 1030, v: 0.08 }),
  ],
  // Tick... tock... then time slows and freezes into a crystal ping
  pause: [
    noise('highpass', 4000, 0.02, { v: 0.16 }),
    noise('highpass', 3000, 0.02, { at: 0.18, v: 0.14 }),
    tone('sine', 1200, 0.5, { at: 0.3, to: 300, v: 0.08 }),
    tone('sine', 2637, 0.4, { at: 0.36, v: 0.06 }),
  ],
  // Two identical sparkles, then both at once
  doublecast: [
    tone('triangle', 880, 0.15, { to: 1320, v: 0.09 }),
    tone('triangle', 880, 0.15, { at: 0.18, to: 1320, v: 0.09 }),
    tone('sine', 1320, 0.3, { at: 0.36, v: 0.08 }),
    tone('sine', 1760, 0.3, { at: 0.36, v: 0.06 }),
  ],
  // One ping that repeats itself, fading
  echo: [0, 0.16, 0.32, 0.48].map((at, i) => tone('sine', 988, 0.15, { at, v: 0.14 / (i + 1) })),
  // Card-shuffle riffle, then scrambled notes
  rearrange: [
    ...[0, 0.06, 0.12, 0.18].map((at) => noise('bandpass', 2500, 0.05, { at, q: 2, v: 0.12 })),
    ...[659, 523, 784, 587].map((f, i) => tone('triangle', f, 0.08, { at: 0.26 + i * 0.06, v: 0.08 })),
  ],
  // Force push: boom, a rushing gust, and a falling whine
  repel: [
    tone('sine', 180, 0.3, { to: 60, v: 0.26 }),
    noise('lowpass', 2000, 0.35, { to: 200, v: 0.14 }),
    tone('sawtooth', 400, 0.3, { at: 0.05, to: 120, v: 0.05 }),
  ],
  // War drum and horn call
  rally: [
    tone('sine', 110, 0.2, { to: 60, v: 0.24 }),
    tone('sawtooth', 196, 0.6, { a: 0.08, v: 0.07, vib: [5, 3] }),
    tone('sawtooth', 294, 0.5, { at: 0.1, a: 0.08, v: 0.05, vib: [5, 3] }),
  ],
  // Warp out, crackle, warp in
  teleport: [
    tone('sine', 300, 0.25, { to: 2400, v: 0.1, vib: [30, 40] }),
    noise('bandpass', 4000, 0.06, { at: 0.26, q: 2, v: 0.1 }),
    tone('sine', 2400, 0.25, { at: 0.28, to: 300, v: 0.1, vib: [30, 40] }),
  ],
  // Homing glide down to an anchor bell
  recall: [
    tone('triangle', 1046, 0.35, { to: 523, v: 0.08, vib: [8, 10] }),
    tone('sine', 523, 0.45, { at: 0.38, v: 0.1 }),
    tone('sine', 784, 0.4, { at: 0.38, v: 0.05 }),
  ],
  // Tape rewinding, then a clunk
  rewind: [
    tone('sawtooth', 1600, 0.5, { to: 300, v: 0.04, vib: [18, 60] }),
    noise('bandpass', 3000, 0.5, { to: 800, q: 1.5, v: 0.06 }),
    tone('sine', 140, 0.12, { at: 0.5, v: 0.2 }),
  ],
  // Two tones crossing paths, then a pop
  swap: [
    tone('sine', 400, 0.3, { to: 1000, v: 0.09 }),
    tone('sine', 1000, 0.3, { to: 400, v: 0.09 }),
    tone('triangle', 1318, 0.1, { at: 0.3, v: 0.08 }),
  ],
  // Choir-like swell rising into a bell
  revive: [
    ...[262, 330, 392].map((f) => tone('sine', f, 0.8, { a: 0.2, v: 0.06 })),
    tone('triangle', 523, 0.4, { at: 0.2, to: 1046, v: 0.07 }),
    tone('sine', 2093, 0.4, { at: 0.5, v: 0.05 }),
  ],
  // A rinse of water, bubbles, and a clean chime
  refresh: [
    noise('bandpass', 800, 0.3, { to: 3000, q: 2, v: 0.1 }),
    ...[0.05, 0.12, 0.2].map((at, i) => tone('sine', 700 + i * 150, 0.05, { at, to: 1100 + i * 150, v: 0.07 })),
    tone('sine', 1568, 0.3, { at: 0.3, v: 0.08 }),
  ],
  // Marching drum taps and a little bugle
  pawn_summon: [
    tone('sine', 150, 0.12, { to: 80, v: 0.22 }),
    tone('sine', 150, 0.12, { at: 0.14, to: 80, v: 0.22 }),
    tone('square', 523, 0.1, { at: 0.3, v: 0.05 }),
    tone('square', 659, 0.22, { at: 0.4, v: 0.05 }),
  ],
  // Creaking gate, heavy thud, two pieces trading places
  pocket_castle: [
    tone('sawtooth', 110, 0.3, { to: 90, v: 0.04, vib: [7, 6] }),
    tone('sine', 90, 0.2, { at: 0.32, to: 50, v: 0.24 }),
    tone('triangle', 392, 0.25, { at: 0.35, to: 523, v: 0.07 }),
    tone('triangle', 523, 0.25, { at: 0.35, to: 392, v: 0.07 }),
  ],
  // Swirling vortex
  portal: [
    tone('sine', 200, 0.6, { to: 800, v: 0.08, vib: [9, 50] }),
    tone('sine', 800, 0.6, { to: 200, v: 0.06, vib: [7, 40] }),
    noise('bandpass', 1500, 0.6, { q: 4, a: 0.15, v: 0.06 }),
  ],
  // Sneaky tiptoe, a swipe, and a "ka-ching"
  blind_gambit: [
    ...[784, 659, 523].map((f, i) => tone('triangle', f, 0.06, { at: i * 0.09, v: 0.08 })),
    noise('highpass', 3000, 0.1, { at: 0.28, to: 6000, v: 0.1 }),
    tone('sine', 2637, 0.25, { at: 0.36, v: 0.07 }),
    tone('sine', 3520, 0.25, { at: 0.36, v: 0.05 }),
  ],
  // Dice rattle, then a tense two-note slot ding
  gamblers_gambit: [
    ...[0, 0.05, 0.1, 0.16, 0.21, 0.28].map((at) => noise('bandpass', 3500, 0.03, { at, q: 4, v: 0.14 })),
    tone('square', 1046, 0.08, { at: 0.38, v: 0.05 }),
    tone('square', 1318, 0.2, { at: 0.46, v: 0.05 }),
  ],
  // Lighter dice rattle and a cheerful major arpeggio
  gamblers_delight: [
    ...[0, 0.06, 0.12, 0.2].map((at) => noise('bandpass', 3800, 0.03, { at, q: 4, v: 0.12 })),
    ...[784, 988, 1175, 1568].map((f, i) => tone('triangle', f, 0.14, { at: 0.3 + i * 0.06, v: 0.07 })),
  ],
};

/** Signature layers for a card, played after the shared cast flick. Returns false if the card has none. */
export function playCardSignatureSfx(defId: string, mine: boolean): boolean {
  const layers = CARD_SFX[defId];
  if (!layers) return false;
  playLayers(layers, { ...CARD_PLAYBACK, pitch: mine ? 1 : 0.89, delay: 0.12 });
  return true;
}

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

  const setMusicEnabledState = ((value: SetStateAction<boolean>) => {
    const next = typeof value === 'function' ? value(musicEnabled) : value;
    setMusic(next);
    setMusicEnabled(next);
  }) as Dispatch<SetStateAction<boolean>>;

  const setSfxEnabledState = ((value: SetStateAction<boolean>) => {
    const next = typeof value === 'function' ? value(sfxEnabled) : value;
    setSfx(next);
    setSfxEnabled(next);
  }) as Dispatch<SetStateAction<boolean>>;

  const setMusicVolumeState = ((value: SetStateAction<number>) => {
    const next = typeof value === 'function' ? value(musicVolume) : value;
    setMusicVol(next);
    setMusicVolume(next);
  }) as Dispatch<SetStateAction<number>>;

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
    setMusicEnabled: setMusicEnabledState,
    setSfxEnabled: setSfxEnabledState,
    setMusicVolume: setMusicVolumeState,
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
      if (button.closest('.draft-tile')) return;
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
