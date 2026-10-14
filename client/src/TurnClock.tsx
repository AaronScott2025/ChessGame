import { useEffect, useRef, useState } from 'react';
import { playTimerTickSfx, playTimeUpSfx } from './AudioControl';

type Color = 'white' | 'black';

export interface TurnTimerView {
  key: string;
  durationMs: number;
  deadline: number | null;
  remainingMs: number;
  paused: null | 'check' | 'waiting';
}

/** Seconds left at which the warning ticks start. */
function warnFromSeconds(durationMs: number): number {
  return durationMs <= 15_000 ? 5 : 10;
}

export function TurnClock({
  timer,
  turn,
  turnCount,
  you,
  localMode,
  offsetMs,
}: {
  timer: TurnTimerView;
  turn: Color;
  turnCount: number;
  you: Color | null;
  localMode: boolean;
  /** serverNow − clientNow, so online deadlines line up with the server clock. */
  offsetMs: number;
}) {
  const running = timer.deadline != null;
  const stale = timer.key !== `${turnCount}:${turn}`;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || stale) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [running, stale, timer.deadline]);

  const remainingMs = stale
    ? timer.durationMs
    : running
      ? Math.max(0, timer.deadline! - (now + offsetMs))
      : timer.remainingMs;
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const warnFrom = warnFromSeconds(timer.durationMs);
  const low = running && !stale && secondsLeft <= warnFrom;
  const critical = running && !stale && secondsLeft <= 3;
  const audible = localMode || you === turn;

  const lastTickRef = useRef<string | null>(null);
  useEffect(() => {
    if (!running || stale || !audible) return;
    const tickKey = `${timer.key}:${secondsLeft}`;
    if (lastTickRef.current === tickKey) return;
    lastTickRef.current = tickKey;
    if (secondsLeft === 0) playTimeUpSfx();
    else if (secondsLeft <= warnFrom) playTimerTickSfx(1 - (secondsLeft - 1) / warnFrom);
  }, [running, stale, audible, timer.key, secondsLeft, warnFrom]);

  const fraction = timer.paused === 'check' ? 1 : Math.max(0, Math.min(1, remainingMs / timer.durationMs));
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const label =
    timer.paused === 'check'
      ? '∞'
      : timer.paused === 'waiting'
        ? '⏸'
        : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const title =
    timer.paused === 'check'
      ? `${turn} is in check — no time limit this turn`
      : timer.paused === 'waiting'
        ? 'Clock paused while the opponent answers a prompt'
        : `${turn} has ${secondsLeft}s to move, or a random move is played`;

  return (
    <div
      className={[
        'turn-clock',
        `turn-clock-${turn}`,
        low ? 'is-low' : '',
        critical ? 'is-critical' : '',
        timer.paused ? `is-paused is-${timer.paused}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={title}
      role="timer"
      aria-label={title}
    >
      <svg className="turn-clock-ring" viewBox="0 0 36 36" aria-hidden>
        <circle className="turn-clock-track" cx="18" cy="18" r={radius} />
        <circle
          className="turn-clock-fill"
          cx="18"
          cy="18"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <span className="turn-clock-text">{label}</span>
      <span className="turn-clock-side" aria-hidden />
    </div>
  );
}
