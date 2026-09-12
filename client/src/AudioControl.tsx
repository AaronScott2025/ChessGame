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

const engine: AudioEngine = {
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
};

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

let proceduralCtx: AudioContext | null = null;

function getProceduralCtx(): AudioContext | null {
  if (!engine.sfxEnabled) return null;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!proceduralCtx) proceduralCtx = new Ctx();
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

/** Soft wooden-metal tap when you capture an enemy piece. */
export function playCaptureSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  playTone(ctx, master, { type: 'triangle', freq: 210, endFreq: 92, start: t, dur: 0.11, peak: 0.2 });
  playTone(ctx, master, { type: 'sine', freq: 540, endFreq: 320, start: t + 0.012, dur: 0.07, peak: 0.09 });

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 0.08);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 900;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.07, t);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(master);
  noise.start(t);
  noise.stop(t + 0.08);
}

/** Muted falling thud when one of your pieces is taken. */
export function playPieceLostSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  playTone(ctx, master, { type: 'sine', freq: 168, endFreq: 64, start: t, dur: 0.22, peak: 0.18 });
  playTone(ctx, master, { type: 'triangle', freq: 240, endFreq: 90, start: t + 0.03, dur: 0.18, peak: 0.08 });
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

/** Soft sparkle when a spell card is successfully cast. */
export function playCardCastSfx() {
  if (!engine.sfxEnabled) return;
  unlockAudio();
  const ctx = getProceduralCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  playTone(ctx, master, { type: 'sine', freq: 620, endFreq: 880, start: t, dur: 0.16, peak: 0.11 });
  playTone(ctx, master, { type: 'triangle', freq: 880, endFreq: 1320, start: t + 0.05, dur: 0.18, peak: 0.08 });

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 0.16);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  filter.Q.value = 0.8;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, t);
  nGain.gain.linearRampToValueAtTime(0.05, t + 0.02);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(master);
  noise.start(t);
  noise.stop(t + 0.16);
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
