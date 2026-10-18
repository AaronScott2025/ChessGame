import { aiStep, type AiDifficulty } from '@shared/ai/index.ts';
import type { Color, GameState } from '@shared/types.ts';

export interface CpuOpponent {
  color: Color;
  difficulty: AiDifficulty;
}

export type CpuSide = Color | 'random';
export const CPU_SIDES: readonly CpuSide[] = ['white', 'black', 'random'];

export const CPU_DIFFICULTY_INFO: Record<AiDifficulty, { label: string; blurb: string }> = {
  easy: { label: 'Easy', blurb: 'Grabs pieces, misses threats' },
  medium: { label: 'Medium', blurb: 'Guards its pieces, casts useful spells' },
  hard: { label: 'Hard', blurb: 'Reads your replies before it moves' },
};

export function cpuName(difficulty: AiDifficulty): string {
  return `Computer (${CPU_DIFFICULTY_INFO[difficulty].label})`;
}

interface WorkerReply {
  id: number;
  ok: boolean;
  state?: GameState;
  error?: string;
}

let worker: Worker | null | undefined;
let seq = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

/** One computer decision, computed off the main thread when workers are available. */
export function runCpuStep(state: GameState, cpu: CpuOpponent): Promise<GameState> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => aiStep(state, cpu.color, cpu.difficulty));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerReply>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (e.data.ok && e.data.state) resolve(e.data.state);
      else reject(new Error(e.data.error ?? 'The computer could not decide'));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, state, color: cpu.color, difficulty: cpu.difficulty });
  });
}
