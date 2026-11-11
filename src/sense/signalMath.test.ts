import { describe, expect, it } from 'vitest';
import { detectBreaths, instantBreathingRate, normalizeTrace, rhythmMatch } from './signalMath';
import type { TracePoint } from './types';

/** Chest trace sampled at 30 Hz breathing at `bpm`, with optional drift/noise. */
function trace(bpm: number, seconds: number, opts: { drift?: number; noise?: number; sign?: 1 | -1 } = {}): TracePoint[] {
  const points: TracePoint[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < seconds * 30; i++) {
    const t = (i / 30) * 1000;
    const breath = Math.sin(2 * Math.PI * (bpm / 60) * (t / 1000));
    points.push({
      t,
      v: (opts.sign ?? 1) * breath * 3 + (opts.drift ?? 0) * (t / 1000) + (opts.noise ?? 0) * rand() + 120,
    });
  }
  return points;
}

describe('normalizeTrace', () => {
  it('maps a waveform into roughly [-1, 1] regardless of offset and scale', () => {
    const norm = normalizeTrace(trace(12, 20));
    const values = norm.map((p) => p.v);
    expect(Math.max(...values)).toBeLessThanOrEqual(1.5);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1.5);
    expect(Math.max(...values)).toBeGreaterThan(0.8);
  });

  it('returns zeros for a flat trace instead of dividing by zero', () => {
    const flat = Array.from({ length: 50 }, (_, i) => ({ t: i * 33, v: 5 }));
    expect(normalizeTrace(flat).every((p) => p.v === 0)).toBe(true);
  });
});

describe('detectBreaths', () => {
  it('counts one peak per breath at 12 breaths/min', () => {
    const peaks = detectBreaths(trace(12, 30));
    // 30 s at 12/min = 6 breaths; the first may be lost while the detector arms.
    expect(peaks.length).toBeGreaterThanOrEqual(5);
    expect(peaks.length).toBeLessThanOrEqual(6);
  });

  it('is robust to slow drift and noise', () => {
    const peaks = detectBreaths(trace(8, 45, { drift: 0.4, noise: 0.8 }));
    expect(peaks.length).toBeGreaterThanOrEqual(5);
    expect(peaks.length).toBeLessThanOrEqual(6);
  });
});

describe('instantBreathingRate', () => {
  it.each([6, 10, 15, 22])('recovers %i breaths/min within 1 breath/min', (bpm) => {
    const rate = instantBreathingRate(trace(bpm, 40, { noise: 0.4 }));
    expect(rate).not.toBeNull();
    expect(Math.abs((rate as number) - bpm)).toBeLessThan(1);
  });

  it('returns null when there is not enough signal', () => {
    expect(instantBreathingRate(trace(12, 3))).toBeNull();
  });
});

describe('rhythmMatch', () => {
  const guide = (bpm: number) => (tMs: number) => Math.sin(2 * Math.PI * (bpm / 60) * (tMs / 1000));

  it('scores a breath that follows the guide highly', () => {
    expect(rhythmMatch(trace(6, 30), guide(6)).score).toBeGreaterThan(0.85);
  });

  it('scores a breath at a different pace low', () => {
    expect(rhythmMatch(trace(15, 30), guide(6)).score).toBeLessThan(0.4);
  });

  it('detects an inverted trace and reports its sign', () => {
    const result = rhythmMatch(trace(6, 30, { sign: -1 }), guide(6));
    expect(result.score).toBeGreaterThan(0.85);
    expect(result.sign).toBe(-1);
  });
});
