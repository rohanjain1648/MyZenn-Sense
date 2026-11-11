import { describe, expect, it } from 'vitest';
import { DEFAULT_PACER, createPacer, guideLevel, isInhaling, updatePacer, type PacerState } from './pacer';

/** Run the pacer for `seconds` with a measured pace produced by `measure`. */
function run(state: PacerState, seconds: number, measure: (s: PacerState) => number | null, startAt = state.lastAt) {
  let s = state;
  for (let i = 1; i <= seconds; i++) s = updatePacer(s, measure(s), startAt + i * 1000);
  return s;
}

describe('createPacer', () => {
  it('starts at the measured pace, rounded to a quarter breath', () => {
    expect(createPacer(14.13, 0).pace).toBe(14.25);
  });

  it('clamps very fast or very slow starts into a comfortable range', () => {
    expect(createPacer(28, 0).pace).toBe(DEFAULT_PACER.startMax);
    expect(createPacer(4, 0).pace).toBe(DEFAULT_PACER.startMin);
  });
});

describe('updatePacer', () => {
  it('holds the pace while the user is not keeping up', () => {
    const s = run(createPacer(14, 0), 60, () => 17);
    expect(s.pace).toBe(14);
  });

  it('holds the pace when there is no trustworthy reading', () => {
    const s = run(createPacer(14, 0), 60, () => null);
    expect(s.pace).toBe(14);
  });

  it('slows down one step once the user keeps up for long enough', () => {
    const s = run(createPacer(14, 0), 20, (st) => st.pace + 0.3);
    expect(s.pace).toBeLessThan(14);
    expect(s.pace).toBeGreaterThanOrEqual(14 - DEFAULT_PACER.maxStep);
    expect(s.steps).toHaveLength(2);
  });

  it('takes bigger steps far from the target and smaller ones close to it', () => {
    const far = run(createPacer(16, 0), 20, (st) => st.pace);
    const near = run(createPacer(7, 0), 20, (st) => st.pace);
    expect(16 - far.pace).toBeGreaterThan(7 - near.pace);
  });

  it('leads a user who follows all the way down to the target, then arrives', () => {
    const s = run(createPacer(15, 0), 400, (st) => st.pace + 0.2);
    expect(s.pace).toBe(DEFAULT_PACER.target);
    expect(s.status).toBe('arrived');
    expect(s.arrivedAt).not.toBeNull();
  });

  it('never goes below the target', () => {
    const s = run(createPacer(8, 0), 300, () => 5);
    expect(s.pace).toBeGreaterThanOrEqual(DEFAULT_PACER.target);
  });

  it('eases back when the user struggles at a slower pace', () => {
    const led = run(createPacer(14, 0), 20, (st) => st.pace);
    expect(led.pace).toBeLessThan(14);
    const eased = run(led, 30, (st) => st.pace + 4);
    expect(eased.status).toBe('easing');
    expect(eased.pace).toBeGreaterThan(led.pace);
    expect(eased.pace).toBeLessThanOrEqual(eased.startPace);
  });
});

describe('guide shape', () => {
  it('rises from -1 to 1 during the inhale and falls back during the exhale', () => {
    expect(guideLevel(0)).toBeCloseTo(-1);
    expect(guideLevel(0.4)).toBeCloseTo(1);
    expect(guideLevel(0.999)).toBeCloseTo(-1, 1);
    expect(isInhaling(0.2)).toBe(true);
    expect(isInhaling(0.7)).toBe(false);
  });
});
