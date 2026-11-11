import type { TracePoint } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Scale a trace into roughly [-1, 1] using robust (5th-95th percentile) bounds,
 * so one twitch does not flatten the whole waveform.
 */
export function normalizeTrace(points: TracePoint[]): TracePoint[] {
  if (points.length < 2) return points.map((p) => ({ t: p.t, v: 0 }));
  const sorted = points.map((p) => p.v).sort((a, b) => a - b);
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  const span = hi - lo;
  if (!(span > 1e-9)) return points.map((p) => ({ t: p.t, v: 0 }));
  const mid = (hi + lo) / 2;
  return points.map((p) => ({ t: p.t, v: clamp(((p.v - mid) / span) * 2, -1.5, 1.5) }));
}

/** Simple moving average over a time window (ms). */
export function smoothTrace(points: TracePoint[], windowMs: number): TracePoint[] {
  const out: TracePoint[] = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].v;
    while (points[i].t - points[start].t > windowMs) {
      sum -= points[start].v;
      start++;
    }
    out.push({ t: points[i].t, v: sum / (i - start + 1) });
  }
  return out;
}

/**
 * Detect breath cycles in a chest-movement trace.
 *
 * Normalizes and lightly smooths the trace, then uses hysteresis on the
 * zero line: a breath "peak" is recorded each time the signal rises above
 * +threshold after having been below -threshold. Returns peak times (ms).
 * Robust to slow drift and the unknown sign/scale of the SDK trace.
 */
export function detectBreaths(points: TracePoint[], threshold = 0.25): number[] {
  if (points.length < 10) return [];
  const smooth = smoothTrace(normalizeTrace(detrend(points, 8000)), 350);
  const peaks: number[] = [];
  let armed = smooth[0].v < 0;
  let peakT = -1;
  let peakV = -Infinity;
  for (const p of smooth) {
    if (armed) {
      if (p.v > threshold) {
        armed = false;
        peakT = p.t;
        peakV = p.v;
      }
    } else {
      if (p.v > peakV) {
        peakV = p.v;
        peakT = p.t;
      }
      if (p.v < -threshold) {
        peaks.push(peakT);
        armed = true;
        peakV = -Infinity;
      }
    }
  }
  return peaks;
}

/** Remove slow baseline drift by subtracting a long moving average. */
export function detrend(points: TracePoint[], windowMs: number): TracePoint[] {
  const base = smoothTrace(points, windowMs);
  return points.map((p, i) => ({ t: p.t, v: p.v - base[i].v }));
}

/**
 * Instantaneous breathing rate (breaths/min) from the last few detected
 * breaths in the chest trace. Reacts in seconds, where the SDK's own
 * breathing rate is a 30-second average.
 */
export function instantBreathingRate(points: TracePoint[], breathsToUse = 3): number | null {
  const peaks = detectBreaths(points);
  if (peaks.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  const recent = intervals.slice(-breathsToUse);
  const med = median(recent);
  if (!(med > 1200) || med > 20_000) return null; // outside 3-50 breaths/min
  return 60_000 / med;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-12 ? num / den : 0;
}

/**
 * How well the measured chest movement follows a target breathing pattern.
 * Tries small time lags (people follow a guide slightly late) and both signs
 * (the SDK trace polarity is not guaranteed). Returns 0..1 and the sign that
 * matched best, so visuals can draw the user's breath the right way up.
 */
export function rhythmMatch(
  points: TracePoint[],
  target: (tMs: number) => number,
  maxLagMs = 1500,
  stepMs = 250,
): { score: number; sign: 1 | -1 } {
  if (points.length < 20) return { score: 0, sign: 1 };
  const norm = smoothTrace(normalizeTrace(detrend(points, 8000)), 300);
  const measured = norm.map((p) => p.v);
  let best = 0;
  let bestSign: 1 | -1 = 1;
  for (let lag = 0; lag <= maxLagMs; lag += stepMs) {
    const guide = norm.map((p) => target(p.t - lag));
    const r = pearson(measured, guide);
    if (Math.abs(r) > Math.abs(best)) {
      best = r;
      bestSign = r >= 0 ? 1 : -1;
    }
  }
  return { score: clamp(Math.abs(best), 0, 1), sign: bestSign };
}
