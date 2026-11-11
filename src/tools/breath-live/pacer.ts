// Adaptive breathing pacer: "follows you, then leads you".
//
// The guide starts at the user's measured breathing pace and only slows down
// once their measured breathing has kept up with the current step. If they
// struggle for a while, it eases back. It never goes below the target
// (~6 breaths/min, a slow, comfortable pace often used in paced breathing).

export interface PacerConfig {
  /** Slowest pace the guide will lead to (breaths/min). */
  target: number;
  /** Measured pace within this many breaths/min of the guide counts as "keeping up". */
  tolerance: number;
  /** Minimum time on a step before the guide may slow down again. */
  holdMs: number;
  /** How long the user must keep up within a step before it slows down. */
  matchNeededMs: number;
  /** Measured pace this far above the guide counts as struggling. */
  easeMargin: number;
  /** Struggling this long makes the guide ease back one small step. */
  easeAfterMs: number;
  minStep: number;
  maxStep: number;
  /** Each step closes this fraction of the remaining gap to the target. */
  stepFraction: number;
  startMin: number;
  startMax: number;
}

export const DEFAULT_PACER: PacerConfig = {
  target: 6,
  tolerance: 1.25,
  holdMs: 18_000,
  matchNeededMs: 9_000,
  easeMargin: 2.5,
  easeAfterMs: 24_000,
  minStep: 0.5,
  maxStep: 1.5,
  stepFraction: 0.35,
  startMin: 7,
  startMax: 20,
};

export type PacerStatus = 'leading' | 'easing' | 'arrived';

export interface PacerState {
  pace: number;
  startPace: number;
  stepStartedAt: number;
  matchedMs: number;
  strugglingMs: number;
  lastAt: number;
  status: PacerStatus;
  arrivedAt: number | null;
  /** Pace changes over time, for the summary chart. */
  steps: { t: number; pace: number }[];
}

const roundQuarter = (v: number) => Math.round(v * 4) / 4;

export function createPacer(measured: number, now: number, cfg: PacerConfig = DEFAULT_PACER): PacerState {
  const pace = roundQuarter(Math.min(cfg.startMax, Math.max(cfg.startMin, measured)));
  return {
    pace,
    startPace: pace,
    stepStartedAt: now,
    matchedMs: 0,
    strugglingMs: 0,
    lastAt: now,
    status: pace <= cfg.target ? 'arrived' : 'leading',
    arrivedAt: pace <= cfg.target ? now : null,
    steps: [{ t: now, pace }],
  };
}

/**
 * Advance the pacer. Call about once a second with the latest measured pace
 * (or null when there is no trustworthy reading, which simply holds the step).
 */
export function updatePacer(s: PacerState, measured: number | null, now: number, cfg: PacerConfig = DEFAULT_PACER): PacerState {
  const dt = Math.max(0, now - s.lastAt);
  let { pace, stepStartedAt, matchedMs, strugglingMs, status, arrivedAt, steps } = s;

  if (measured !== null && Number.isFinite(measured)) {
    const diff = measured - pace;
    matchedMs = Math.abs(diff) <= cfg.tolerance ? matchedMs + dt : Math.max(0, matchedMs - dt / 2);
    strugglingMs = diff > cfg.easeMargin ? strugglingMs + dt : Math.max(0, strugglingMs - dt);
  }

  const onStepFor = now - stepStartedAt;

  if (pace > cfg.target && onStepFor >= cfg.holdMs && matchedMs >= cfg.matchNeededMs) {
    const step = Math.min(cfg.maxStep, Math.max(cfg.minStep, (pace - cfg.target) * cfg.stepFraction));
    pace = Math.max(cfg.target, roundQuarter(pace - step));
    stepStartedAt = now;
    matchedMs = 0;
    strugglingMs = 0;
    status = 'leading';
    steps = [...steps, { t: now, pace }];
  } else if (strugglingMs >= cfg.easeAfterMs && pace < s.startPace) {
    pace = Math.min(s.startPace, roundQuarter(pace + cfg.minStep));
    stepStartedAt = now;
    matchedMs = 0;
    strugglingMs = 0;
    status = 'easing';
    arrivedAt = null;
    steps = [...steps, { t: now, pace }];
  }

  if (pace <= cfg.target && arrivedAt === null && matchedMs >= cfg.matchNeededMs) {
    status = 'arrived';
    arrivedAt = now;
  }

  return { ...s, pace, stepStartedAt, matchedMs, strugglingMs, status, arrivedAt, steps, lastAt: now };
}

/** Guide shape: 40% inhale, 60% exhale (a longer out-breath is calming). Returns -1..1. */
export const INHALE_FRACTION = 0.4;

export function guideLevel(cyclePhase: number): number {
  const f = cyclePhase - Math.floor(cyclePhase);
  if (f < INHALE_FRACTION) return -Math.cos((Math.PI * f) / INHALE_FRACTION);
  return Math.cos((Math.PI * (f - INHALE_FRACTION)) / (1 - INHALE_FRACTION));
}

export function isInhaling(cyclePhase: number): boolean {
  const f = cyclePhase - Math.floor(cyclePhase);
  return f < INHALE_FRACTION;
}
