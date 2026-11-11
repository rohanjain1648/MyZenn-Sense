import { describe, expect, it } from 'vitest';
import { MAJOR_PENTATONIC, MINOR_PENTATONIC, beatIntervalMs, brightKey, calmness, degreeToFreq, nextDegree } from './mapping';

describe('degreeToFreq', () => {
  it('maps degree 0 to the root (C3) and wraps an octave every five degrees', () => {
    expect(degreeToFreq(0, MAJOR_PENTATONIC)).toBeCloseTo(130.81, 1);
    expect(degreeToFreq(5, MAJOR_PENTATONIC)).toBeCloseTo(261.63, 1);
    expect(degreeToFreq(-5, MAJOR_PENTATONIC)).toBeCloseTo(65.41, 1);
  });

  it('uses a darker third in the minor scale', () => {
    expect(degreeToFreq(1, MINOR_PENTATONIC)).toBeCloseTo(155.56, 1); // E flat
    expect(degreeToFreq(2, MAJOR_PENTATONIC)).toBeCloseTo(164.81, 1); // E
  });
});

describe('beatIntervalMs', () => {
  it('follows the heart rate', () => {
    expect(beatIntervalMs(60)).toBe(1000);
    expect(beatIntervalMs(75)).toBe(800);
  });

  it('plays fast pulses in half time and clamps extremes', () => {
    expect(beatIntervalMs(120)).toBe(1000);
    expect(beatIntervalMs(10)).toBe(1500);
  });
});

describe('calmness', () => {
  it('is 0 at a quick pace, 1 at a slow pace, and 0 without data', () => {
    expect(calmness(18)).toBe(0);
    expect(calmness(6)).toBe(1);
    expect(calmness(11)).toBeCloseTo(0.5);
    expect(calmness(null)).toBe(0);
  });
});

describe('brightKey', () => {
  it('brightens on a clear smile and holds through small dips', () => {
    expect(brightKey(50, false)).toBe(true);
    expect(brightKey(35, false)).toBe(false);
    expect(brightKey(35, true)).toBe(true);
    expect(brightKey(20, true)).toBe(false);
  });
});

describe('nextDegree', () => {
  it('moves by small steps and stays within range', () => {
    let degree = 4;
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const next = nextDegree(degree, random);
      expect(Math.abs(next - degree)).toBeLessThanOrEqual(2);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(9);
      degree = next;
    }
  });
});
