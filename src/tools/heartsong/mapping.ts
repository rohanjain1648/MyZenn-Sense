// How Heartsong turns body signals into music. Pure functions, unit-tested.

export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
export const MINOR_PENTATONIC = [0, 3, 5, 7, 10];

/** Root of the instrument: C3. */
export const ROOT_MIDI = 48;

export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Frequency of a scale degree (any integer; wraps across octaves). */
export function degreeToFreq(degree: number, scale: number[], rootMidi = ROOT_MIDI): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const step = ((degree % n) + n) % n;
  return midiToFreq(rootMidi + octave * 12 + scale[step]);
}

/**
 * Milliseconds between heartbeat notes. Fast pulses play in half time so
 * the music never feels hurried.
 */
export function beatIntervalMs(pulseBpm: number): number {
  const bpm = Math.min(160, Math.max(40, pulseBpm));
  return (60_000 / (bpm > 100 ? bpm / 2 : bpm));
}

/** 0 when breathing fast (>= 16/min), 1 when slow (<= 6/min). */
export function calmness(breathingRate: number | null): number {
  if (breathingRate === null || !Number.isFinite(breathingRate)) return 0;
  return Math.min(1, Math.max(0, (16 - breathingRate) / 10));
}

/**
 * Smiling brightens the key. Hysteresis keeps it from flickering:
 * brighten above 45% "happy", darken again only below 25%.
 */
export function brightKey(happy: number, currentlyBright: boolean): boolean {
  if (currentlyBright) return happy >= 25;
  return happy > 45;
}

/** Gentle melodic random walk within a two-octave range. */
export function nextDegree(previous: number, random: () => number = Math.random, low = 0, high = 9): number {
  const steps = [-2, -1, -1, 1, 1, 2];
  let next = previous + steps[Math.floor(random() * steps.length)];
  if (next < low) next = low + (low - next);
  if (next > high) next = high - (next - high);
  return Math.min(high, Math.max(low, next));
}

/** Map a keyboard key to a scale degree for playing along (A S D F G H J K L ;). */
export const KEY_DEGREES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7, l: 8, ';': 9,
};
