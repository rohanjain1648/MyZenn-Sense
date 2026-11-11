import { describe, expect, it } from 'vitest';
import { SpikeDetector, activationScore, edaBaseline, edaRise } from './activation';

describe('EDA proxy (skin response)', () => {
  const settled = [4.0, 4.02, 3.98, 4.01, 3.99, 4.0, 4.03, 3.97];

  it('needs a few settled samples before it has a baseline', () => {
    expect(edaBaseline([4, 4.1])).toBeNull();
    expect(edaBaseline(settled)?.mean).toBeCloseTo(4, 2);
  });

  it('ignores wobbles within the settled range', () => {
    expect(edaRise(edaBaseline(settled), [4.01, 3.99, 4.02])).toBe(0);
  });

  it('rises as skin response climbs above the user baseline', () => {
    const base = edaBaseline(settled);
    const small = edaRise(base, [4.1, 4.12, 4.11]) as number;
    const large = edaRise(base, [4.6, 4.7, 4.65]) as number;
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(1);
  });

  it('is null without a baseline or recent samples', () => {
    expect(edaRise(null, [5, 5, 5])).toBeNull();
    expect(edaRise(edaBaseline(settled), [5])).toBeNull();
  });

  it('adds to activation when present, without changing scores when absent', () => {
    const base = { pulse: 70, breathing: 12 };
    const input = { pulse: 80, breathing: 13, tenseExpression: 10 };
    const without = activationScore(base, input);
    expect(activationScore(base, { ...input, edaRise: null })).toBe(without);
    expect(activationScore(base, { ...input, edaRise: 1 })).toBeGreaterThan(without);
  });
});

const baseline = { pulse: 70, breathing: 12 };

describe('activationScore', () => {
  it('is 0 at baseline', () => {
    expect(activationScore(baseline, { pulse: 70, breathing: 12, tenseExpression: 5 })).toBe(0);
  });

  it('rises with heart rate above the personal baseline', () => {
    const mild = activationScore(baseline, { pulse: 79, breathing: 12, tenseExpression: 5 });
    const high = activationScore(baseline, { pulse: 90, breathing: 17, tenseExpression: 40 });
    expect(mild).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(mild);
    expect(high).toBeLessThanOrEqual(100);
  });

  it('works on breathing and expression alone when pulse is unavailable', () => {
    const score = activationScore({ pulse: null, breathing: 12 }, { pulse: null, breathing: 19, tenseExpression: 60 });
    expect(score).toBeGreaterThan(80);
  });

  it('never goes below 0 when the user is calmer than baseline', () => {
    expect(activationScore(baseline, { pulse: 60, breathing: 8, tenseExpression: 0 })).toBe(0);
  });

  it('returns 0 with no usable signals', () => {
    expect(activationScore({ pulse: null, breathing: null }, { pulse: null, breathing: null, tenseExpression: null })).toBe(0);
  });
});

describe('SpikeDetector', () => {
  it('fires only after the score stays high for the sustain window', () => {
    const d = new SpikeDetector();
    expect(d.update(70, 0)).toBeNull();
    expect(d.update(70, 3000)).toBeNull();
    expect(d.update(70, 6000)).toBe('spike');
    expect(d.active).toBe(true);
  });

  it('ignores a brief jump', () => {
    const d = new SpikeDetector();
    d.update(80, 0);
    d.update(40, 2000);
    expect(d.update(80, 7000)).toBeNull();
  });

  it('reports recovery once the score falls back', () => {
    const d = new SpikeDetector();
    d.update(70, 0);
    d.update(70, 6000);
    expect(d.update(50, 10_000)).toBeNull();
    expect(d.update(30, 20_000)).toBe('recovered');
    expect(d.active).toBe(false);
  });

  it('waits for the cooldown before pausing the conversation again', () => {
    const d = new SpikeDetector();
    d.update(70, 0);
    d.update(70, 6000);
    d.update(20, 10_000);
    d.update(70, 12_000);
    expect(d.update(70, 30_000)).toBeNull();
    expect(d.update(70, 52_000)).toBe('spike');
  });
});
