import { guidanceFor } from './guidance';
import type {
  Capabilities,
  ExpressionKey,
  ExpressionReading,
  MetricsPacket,
  OptionalSignal,
  Phase,
  SenseError,
  SenseState,
  SignalSource,
  SourceKind,
  StartOptions,
  TracePoint,
} from './types';
import { EXPRESSION_KEYS } from './types';

const CHEST_KEEP_MS = 60_000;
const EDA_KEEP_MS = 180_000;

/** Last `windowMs` of a time-ordered trace. */
function sliceWindow(points: TracePoint[], windowMs: number): TracePoint[] {
  if (points.length === 0) return [];
  const from = points[points.length - 1].t - windowMs;
  let i = points.length - 1;
  while (i > 0 && points[i - 1].t >= from) i--;
  return points.slice(i);
}

function appendTrimmed(points: TracePoint[], added: TracePoint[], keepMs: number) {
  points.push(...added);
  const cutoff = points[points.length - 1].t - keepMs;
  let drop = 0;
  while (drop < points.length && points[drop].t < cutoff) drop++;
  if (drop > 0) points.splice(0, drop);
}
const NOTIFY_INTERVAL_MS = 150;

export interface SessionEnd {
  source: SourceKind;
  elapsedMs: number;
}

export interface SessionHistory {
  breathingRate: TracePoint[];
  pulse: TracePoint[];
  rmssd: TracePoint[];
  happy: TracePoint[];
}

type Listener = () => void;

function initialState(): SenseState {
  return {
    phase: 'idle',
    source: null,
    startedAt: null,
    elapsedMs: 0,
    guidance: null,
    breathingRate: null,
    pulse: null,
    hrv: null,
    expression: null,
    talking: false,
    blinkCount: 0,
    error: null,
    capabilities: { cardio: false, face: false, eda: false },
    deniedSignals: [],
    stopReason: null,
    insightsReceived: 0,
  };
}

/**
 * Single source of truth for live body signals.
 *
 * Sources (Presage SDK or simulator) push raw packets in; tools read a
 * normalized state. React re-renders are throttled to ~7 Hz via subscribe();
 * animation code reads the chest trace directly every frame via getChest().
 */
export class SenseEngine {
  private state: SenseState = initialState();
  private listeners = new Set<Listener>();
  private blinkListeners = new Set<(tMs: number) => void>();
  private endListeners = new Set<(end: SessionEnd) => void>();
  private insightListeners = new Set<(requestId: number, buf: Uint8Array) => void>();
  private chest: TracePoint[] = [];
  private eda: TracePoint[] = [];
  private history: SessionHistory = { breathingRate: [], pulse: [], rmssd: [], happy: [] };
  private originUs = 0;
  private originChecked = false;
  private source: SignalSource | null = null;
  private stream: MediaStream | null = null;
  private notifyPending = false;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private capMs: number | null = null;
  private lastBlink = false;
  private generation = 0;

  // ---- reading -------------------------------------------------------------
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): SenseState => this.state;

  getStream(): MediaStream | null {
    return this.stream;
  }

  getSource(): SignalSource | null {
    return this.source;
  }

  /** Chest-movement trace for the last `windowMs` (ms since session start). */
  getChest(windowMs = 30_000): TracePoint[] {
    return sliceWindow(this.chest, windowMs);
  }

  /** EDA proxy trace (skin-response estimate) for the last `windowMs`. */
  getEda(windowMs = 30_000): TracePoint[] {
    return sliceWindow(this.eda, windowMs);
  }

  onInsight(fn: (requestId: number, buf: Uint8Array) => void): () => void {
    this.insightListeners.add(fn);
    return () => this.insightListeners.delete(fn);
  }

  /** On-demand Presage LLM Insight. Null when the source can't (practice off-line, no session). */
  async requestInsight(prompt: string): Promise<number | null> {
    const source = this.source;
    if (!source?.requestInsight || this.state.phase !== 'running') return null;
    return source.requestInsight(prompt);
  }

  getHistory(): SessionHistory {
    return this.history;
  }

  /** Current time on the session clock (same base as trace timestamps). */
  nowMs(): number {
    if (this.state.startedAt === null) return 0;
    return Date.now() - this.originUs / 1000;
  }

  onBlink(fn: (tMs: number) => void): () => void {
    this.blinkListeners.add(fn);
    return () => this.blinkListeners.delete(fn);
  }

  onSessionEnd(fn: (end: SessionEnd) => void): () => void {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  // ---- lifecycle -----------------------------------------------------------
  async start(source: SignalSource, options: StartOptions & { capMs?: number | null }): Promise<void> {
    if (this.source) await this.stop();
    const generation = ++this.generation;
    const startedAt = Date.now();
    this.chest = [];
    this.eda = [];
    this.history = { breathingRate: [], pulse: [], rmssd: [], happy: [] };
    this.originUs = startedAt * 1000;
    this.originChecked = false;
    this.lastBlink = false;
    this.capMs = options.capMs ?? null;
    this.source = source;
    this.state = {
      ...initialState(),
      phase: 'starting',
      source: source.kind,
      startedAt,
      capabilities: { cardio: options.cardio, face: options.face, eda: options.eda },
    };
    this.notify(true);

    this.tickHandle = setInterval(() => {
      if (generation !== this.generation || this.state.startedAt === null) return;
      const elapsedMs = Date.now() - this.state.startedAt;
      this.patch({ elapsedMs });
      if (this.capMs && elapsedMs >= this.capMs) {
        const minutes = Math.round(this.capMs / 60_000);
        void this.stop(`Paused after ${minutes} min to save your Presage credits. Start again whenever you like.`);
      }
    }, 500);

    try {
      await source.start(this.sinkFor(generation), {
        cardio: options.cardio,
        face: options.face,
        eda: options.eda,
        cameraId: options.cameraId ?? null,
      });
    } catch (err) {
      if (generation !== this.generation) return;
      const message = err instanceof Error ? err.message : String(err);
      this.patch({ phase: 'error', error: this.state.error ?? { code: 'START_FAILED', message, retryable: true } });
      this.cleanup();
    }
  }

  async stop(reason?: string): Promise<void> {
    const source = this.source;
    if (!source) return;
    this.generation++;
    const elapsedMs = this.state.startedAt ? Date.now() - this.state.startedAt : 0;
    this.patch({ phase: 'stopping' });
    try {
      await source.stop();
    } catch {
      /* already stopped */
    }
    this.cleanup();
    this.patch({ phase: 'idle', elapsedMs, guidance: null, stopReason: reason ?? null });
    for (const fn of this.endListeners) fn({ source: source.kind, elapsedMs });
  }

  private cleanup() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.source = null;
    this.stream = null;
  }

  // ---- ingestion -----------------------------------------------------------
  private sinkFor(generation: number) {
    const live = () => generation === this.generation;
    return {
      phase: (phase: Phase) => live() && this.patch({ phase }),
      guidance: (code: number, hint?: string) => live() && this.patch({ guidance: guidanceFor(code, hint) }),
      metrics: (packet: MetricsPacket) => live() && this.ingest(packet),
      error: (error: SenseError) => live() && this.patch({ error }),
      stream: (stream: MediaStream | null) => {
        if (!live()) return;
        this.stream = stream;
        this.notify(true);
      },
      capabilities: (caps: Capabilities) => live() && this.patch({ capabilities: caps }),
      denied: (signal: OptionalSignal) => {
        if (!live() || this.state.deniedSignals.includes(signal)) return;
        this.patch({ deniedSignals: [...this.state.deniedSignals, signal] });
      },
      insight: (requestId: number, buf: Uint8Array) => {
        if (!live()) return;
        this.patch({ insightsReceived: this.state.insightsReceived + 1 });
        for (const fn of this.insightListeners) fn(requestId, buf);
      },
    };
  }

  private rel(tUs: number): number {
    if (!this.originChecked) {
      this.originChecked = true;
      // The SDK reports epoch microseconds. If a source ever uses another
      // clock, re-anchor so its first sample lands at "now".
      const nowUs = Date.now() * 1000;
      if (Math.abs(tUs - nowUs) > 3_600_000_000) {
        const elapsedUs = (Date.now() - (this.state.startedAt ?? Date.now())) * 1000;
        this.originUs = tUs - elapsedUs;
      }
    }
    return (tUs - this.originUs) / 1000;
  }

  private ingest(packet: MetricsPacket) {
    const next: Partial<SenseState> = {};

    if (packet.chest?.length) {
      appendTrimmed(this.chest, packet.chest.map((m) => ({ t: this.rel(m.tUs), v: m.value })), CHEST_KEEP_MS);
    }

    if (packet.eda?.length) {
      const points = packet.eda.filter((m) => Number.isFinite(m.value)).map((m) => ({ t: this.rel(m.tUs), v: m.value }));
      if (points.length) appendTrimmed(this.eda, points, EDA_KEEP_MS);
    }

    const lastBr = packet.breathingRate?.at(-1);
    if (lastBr) {
      const reading = { value: lastBr.value, confidence: lastBr.confidence ?? 0, stable: !!lastBr.stable, t: this.rel(lastBr.tUs) };
      next.breathingRate = reading;
      this.pushHistory(this.history.breathingRate, reading.t, reading.value, reading.stable);
    }

    const lastPulse = packet.pulse?.at(-1);
    if (lastPulse) {
      const reading = { value: lastPulse.value, confidence: lastPulse.confidence ?? 0, stable: !!lastPulse.stable, t: this.rel(lastPulse.tUs) };
      next.pulse = reading;
      this.pushHistory(this.history.pulse, reading.t, reading.value, reading.stable);
    }

    const lastHrv = packet.hrv?.at(-1);
    if (lastHrv) {
      const t = this.rel(lastHrv.tUs);
      next.hrv = { ...lastHrv, t };
      this.pushHistory(this.history.rmssd, t, lastHrv.rmssd, lastHrv.stable);
    }

    const lastExpr = packet.expression?.at(-1);
    if (lastExpr) {
      const scores = Object.fromEntries(EXPRESSION_KEYS.map((k) => [k, lastExpr.scores[k] ?? 0])) as Record<ExpressionKey, number>;
      let top: ExpressionKey = 'neutral';
      for (const k of EXPRESSION_KEYS) if (scores[k] > scores[top]) top = k;
      const reading: ExpressionReading = { scores, top, stable: lastExpr.stable, t: this.rel(lastExpr.tUs) };
      next.expression = reading;
      this.pushHistory(this.history.happy, reading.t, scores.happy, true);
    }

    if (packet.blinking?.length) {
      let count = this.state.blinkCount;
      for (const b of packet.blinking) {
        if (b.detected && !this.lastBlink) {
          count++;
          const t = this.rel(b.tUs);
          for (const fn of this.blinkListeners) fn(t);
        }
        this.lastBlink = b.detected;
      }
      if (count !== this.state.blinkCount) next.blinkCount = count;
    }

    const lastTalk = packet.talking?.at(-1);
    if (lastTalk && lastTalk.detected !== this.state.talking) next.talking = lastTalk.detected;

    if (Object.keys(next).length) this.patch(next);
  }

  private pushHistory(series: TracePoint[], t: number, v: number, stable: boolean) {
    if (!stable || !Number.isFinite(v)) return;
    const last = series.at(-1);
    if (last && t - last.t < 1000) return;
    series.push({ t, v });
  }

  // ---- notification --------------------------------------------------------
  private patch(next: Partial<SenseState>) {
    this.state = { ...this.state, ...next };
    this.notify(next.phase !== undefined || next.error !== undefined);
  }

  private notify(immediate = false) {
    if (immediate) {
      this.notifyPending = false;
      for (const fn of this.listeners) fn();
      return;
    }
    if (this.notifyPending) return;
    this.notifyPending = true;
    setTimeout(() => {
      if (!this.notifyPending) return;
      this.notifyPending = false;
      for (const fn of this.listeners) fn();
    }, NOTIFY_INTERVAL_MS);
  }
}
