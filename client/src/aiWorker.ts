import { aiStep, type AiDifficulty } from '@shared/ai/index.ts';
import type { Color, GameState } from '@shared/types.ts';

interface Job {
  id: number;
  state: GameState;
  color: Color;
  difficulty: AiDifficulty;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (e) => {
  const { id, state, color, difficulty } = e.data;
  try {
    scope.postMessage({ id, ok: true, state: aiStep(state, color, difficulty) });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: (err as Error).message });
  }
};
