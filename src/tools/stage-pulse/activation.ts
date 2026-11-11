// Body activation for MyStage Pulse: how far the user's body has moved away
// from their own resting baseline, taken just before the rehearsal starts.
// Deliberately relative and non-clinical: it says "your body sped up compared
// to a minute ago", never anything about health.

export interface Baseline {
  pulse: number | null;
  breathing: number | null;
}

export interface ActivationInput {
  pulse: number | null;
  breathing: number | null;
  /** Sum of fear + sad + angry expression scores, 0-100. */
  tenseExpression: number | null;
  /** Skin-response rise above the settled baseline, 0-1 (see edaRise). */
  edaRise?: number | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export interface EdaBaseline {
  mean: number;
  sd: number;
}

/** Baseline of the EDA proxy while the user settles. Needs a few samples. */
export function edaBaseline(values: number[]): EdaBaseline | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 5) return null;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const variance = finite.reduce((a, b) => a + (b - mean) ** 2, 0) / finite.length;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * How far the recent EDA proxy has risen above the settled baseline, 0-1.
 * The proxy has arbitrary units, so only change relative to the user's own
 * baseline is used: measured in baseline spreads, ignoring small wobbles.
 */
export function edaRise(baseline: EdaBaseline | null, recent: number[]): number | null {
  const finite = recent.filter(Number.isFinite);
  if (!baseline || finite.length < 3) return null;
  const recentMean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const spread = Math.max(baseline.sd, Math.abs(baseline.mean) * 0.02, 1e-6);
  const z = (recentMean - baseline.mean) / spread;
  return clamp01((z - 0.5) / 3);
}

/** 0-100. Uses whichever signals are available and re-weights the rest. */
export function activationScore(baseline: Baseline, input: ActivationInput): number {
  const parts: [number, number][] = [];
  if (baseline.pulse !== null && input.pulse !== null) {
    parts.push([clamp01((input.pulse - baseline.pulse) / 18), 0.45]);
  }
  if (baseline.breathing !== null && input.breathing !== null) {
    parts.push([clamp01((input.breathing - baseline.breathing) / 7), 0.25]);
  }
  if (input.tenseExpression !== null) {
    parts.push([clamp01((input.tenseExpression - 10) / 50), 0.12]);
  }
  if (input.edaRise !== null && input.edaRise !== undefined) {
    parts.push([clamp01(input.edaRise), 0.18]);
  }
  const weight = parts.reduce((a, [, w]) => a + w, 0);
  if (weight === 0) return 0;
  return Math.round((parts.reduce((a, [v, w]) => a + v * w, 0) / weight) * 100);
}

export type ActivationEvent = 'spike' | 'recovered' | null;

export interface DetectorConfig {
  /** Score that counts as "racing". */
  threshold: number;
  /** It must stay there this long before the partner pauses. */
  sustainMs: number;
  /** Score below which the user counts as back down. */
  recoverBelow: number;
  /** Minimum time between pauses, so the conversation can flow. */
  cooldownMs: number;
}

export const DEFAULT_DETECTOR: DetectorConfig = {
  threshold: 60,
  sustainMs: 6000,
  recoverBelow: 35,
  cooldownMs: 45_000,
};

/** Turns a stream of activation scores into "spike" and "recovered" events. */
export class SpikeDetector {
  private aboveSince: number | null = null;
  private lastSpikeAt = -Infinity;
  private inSpike = false;

  constructor(private cfg: DetectorConfig = DEFAULT_DETECTOR) {}

  get active() {
    return this.inSpike;
  }

  update(score: number, now: number): ActivationEvent {
    if (this.inSpike) {
      if (score < this.cfg.recoverBelow) {
        this.inSpike = false;
        this.aboveSince = null;
        return 'recovered';
      }
      return null;
    }
    if (score >= this.cfg.threshold) {
      this.aboveSince ??= now;
      if (now - this.aboveSince >= this.cfg.sustainMs && now - this.lastSpikeAt >= this.cfg.cooldownMs) {
        this.inSpike = true;
        this.lastSpikeAt = now;
        return 'spike';
      }
    } else {
      this.aboveSince = null;
    }
    return null;
  }
}
