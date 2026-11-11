// Offline signal simulator.
//
// Used for development and for "practice mode" so building and testing the
// tools never spends Presage credits. Always labelled "Simulated" in the UI.
// It mimics the SDK's real behaviour: 30 Hz chest trace, warm-up windows
// (pulse 12 s, breathing 30 s, HRV 60 s), confidence ramps, blinks, and
// physiology that responds to slow breathing and to stress.
import { ValidationCodes } from '../guidance';
import { encodeInsight } from '../insight';
import type { ExpressionKey, MetricsPacket, RawDetection, RawMeasurement, SignalSource, SourceSink, StartOptions } from '../types';

/** Practice mode never contacts Presage, so its "reflection" is a clearly labelled sample. */
const PRACTICE_REFLECTION =
  'Practice mode sample: your breathing slowed step by step and your simulated heart rhythm settled with it. ' +
  'In a live session, Presage writes this reflection from your real readings.';

/** EDA proxy appears only after ~35 s of processing on the real SDK. */
const EDA_START_MS = 36_000;

const TICK_MS = 33;
const FLUSH_MS = 200;

export interface SimulatorControls {
  /** Make the simulated person follow a breathing pace (breaths/min), e.g. a pacer. */
  setFollowTarget(fn: (() => number | null) | null): void;
  /** A sudden stressor: pulse and breathing rise, then recover. */
  stressor(strength?: number): void;
  /** A few seconds of smiling. */
  smile(durationMs?: number): void;
}

export class SimulatedSource implements SignalSource, SimulatorControls {
  readonly kind = 'simulated' as const;

  private sink: SourceSink | null = null;
  private options: StartOptions = { cardio: true, face: true, eda: false };
  private eda = 4;
  private insightId = 1000;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private flushHandle: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private lastTick = 0;
  private lastSlowEmit = 0;

  private baseRate = 13 + Math.random() * 3;
  private rate = this.baseRate;
  private phase = 0;
  private stress = 0.2;
  private pulse = 76;
  private drift = 0;
  private smileUntil = 0;
  private nextBlinkAt = 0;
  private blinkUntil = 0;
  private blinkState = false;
  private follow: (() => number | null) | null = null;

  private pendingChest: RawMeasurement[] = [];
  private pendingAbdomen: RawMeasurement[] = [];
  private pendingBlinks: RawDetection[] = [];

  setFollowTarget(fn: (() => number | null) | null) {
    this.follow = fn;
  }

  stressor(strength = 0.65) {
    this.stress = Math.min(1, this.stress + strength);
  }

  smile(durationMs = 4000) {
    this.smileUntil = Date.now() + durationMs;
  }

  async requestInsight(_prompt: string): Promise<number> {
    const requestId = ++this.insightId;
    const sink = this.sink;
    setTimeout(() => {
      if (this.sink !== sink || !sink) return;
      sink.insight(requestId, encodeInsight({ requestId, processedAt: new Date().toISOString(), analysis: PRACTICE_REFLECTION, type: 1 }));
    }, 2500);
    return requestId;
  }

  async start(sink: SourceSink, options: StartOptions): Promise<void> {
    this.sink = sink;
    this.options = options;
    this.startedAt = Date.now();
    this.lastTick = this.startedAt;
    this.lastSlowEmit = this.startedAt;
    this.nextBlinkAt = this.startedAt + 2500;
    sink.capabilities({ cardio: options.cardio, face: options.face, eda: options.eda });
    // Practice mode: talking is never simulated as true, nothing is sent anywhere.
    sink.phase('starting');
    sink.guidance(ValidationCodes.cameraTuning);
    await new Promise((r) => setTimeout(r, 500));
    if (this.sink !== sink) return;
    sink.phase('running');
    setTimeout(() => this.sink === sink && sink.guidance(ValidationCodes.faceNotCentered), 1500);
    setTimeout(() => this.sink === sink && sink.guidance(ValidationCodes.ok), 3200);
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    this.flushHandle = setInterval(() => this.flush(), FLUSH_MS);
  }

  async stop(): Promise<void> {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.flushHandle) clearInterval(this.flushHandle);
    this.tickHandle = this.flushHandle = null;
    this.sink?.phase('idle');
    this.sink = null;
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;

    // Breathing: drift around a personal baseline, or follow a pacer with lag.
    const followed = this.follow?.();
    const wander = Math.sin(now / 23_000) * 0.8;
    const target = (followed ?? this.baseRate + wander) + this.stress * 6;
    this.rate += (target - this.rate) * (dt / (followed ? 7 : 12));
    this.rate = Math.max(4.5, Math.min(30, this.rate));

    // Stress fades, faster when breathing slowly.
    const decay = this.rate < 9 ? 14 : 28;
    this.stress = Math.max(0, this.stress - (this.stress * dt) / decay);
    if (Math.random() < dt / 90) this.stress = Math.min(1, this.stress + 0.15);

    // Heart follows breathing and stress, plus respiratory sinus arrhythmia.
    this.phase += dt * (this.rate / 60);
    const pulseTarget = 70 + 0.9 * (this.rate - 12) + this.stress * 24;
    this.pulse += (pulseTarget - this.pulse) * (dt / 5);

    // Skin response (EDA proxy): a slow tonic level that rises with stress
    // within a few seconds and eases back over tens of seconds.
    const edaTarget = 4 + this.stress * 3.2 + Math.sin(now / 41_000) * 0.15;
    this.eda += (edaTarget - this.eda) * (dt / (edaTarget > this.eda ? 3 : 18));

    // Chest trace: bigger, smoother breaths when slow.
    this.drift += (Math.random() - 0.5) * dt * 0.6;
    const amplitude = 2 + Math.max(0, 14 - this.rate) * 0.18;
    const breath = Math.sin(2 * Math.PI * this.phase);
    const tUs = now * 1000;
    const noise = (Math.random() - 0.5) * 0.35;
    this.pendingChest.push({ tUs, value: 100 + amplitude * breath + this.drift + noise, stable: this.elapsed() > 30_000 });
    this.pendingAbdomen.push({ tUs, value: 80 + amplitude * 0.8 * Math.sin(2 * Math.PI * this.phase - 0.4) + noise, stable: this.elapsed() > 30_000 });

    // Blinks every 2.5-6 s, ~180 ms long.
    if (this.options.face) {
      if (!this.blinkState && now >= this.nextBlinkAt) {
        this.blinkState = true;
        this.blinkUntil = now + 180;
        this.pendingBlinks.push({ tUs, detected: true });
      } else if (this.blinkState && now >= this.blinkUntil) {
        this.blinkState = false;
        this.nextBlinkAt = now + 2500 + Math.random() * 3500;
        this.pendingBlinks.push({ tUs, detected: false });
      }
    }
  }

  private elapsed() {
    return Date.now() - this.startedAt;
  }

  private flush() {
    const sink = this.sink;
    if (!sink) return;
    const now = Date.now();
    const tUs = now * 1000;
    const elapsed = this.elapsed();
    const packet: MetricsPacket = {};

    if (this.pendingChest.length) {
      packet.chest = this.pendingChest;
      packet.abdomen = this.pendingAbdomen;
      this.pendingChest = [];
      this.pendingAbdomen = [];
    }
    if (this.pendingBlinks.length) {
      packet.blinking = this.pendingBlinks;
      this.pendingBlinks = [];
    }

    if (now - this.lastSlowEmit >= 1000) {
      this.lastSlowEmit = now;
      const ramp = (windowMs: number, max: number) => Math.min(max, (elapsed / windowMs) * max);

      if (elapsed > 4000) {
        const confidence = ramp(30_000, 78);
        packet.breathingRate = [{ tUs, value: this.rate + (Math.random() - 0.5) * 0.4, confidence, stable: confidence >= 45 }];
      }
      if (this.options.cardio && elapsed > 3000) {
        const confidence = ramp(12_000, 72);
        packet.pulse = [{ tUs, value: this.pulse + (Math.random() - 0.5) * 1.6, confidence, stable: confidence >= 40 }];
      }
      if (this.options.cardio && elapsed > 20_000) {
        const confidence = ramp(60_000, 68);
        const rmssd = Math.max(8, Math.min(95, 30 + (13 - this.rate) * 3.4 - this.stress * 16 + (Math.random() - 0.5) * 3));
        packet.hrv = [
          {
            tUs,
            rmssd,
            sdnn: rmssd * 1.25,
            meanNn: 60_000 / this.pulse,
            baevsky: Math.max(30, Math.min(650, 430 - rmssd * 4.4)),
            confidence,
            stable: confidence >= 50,
          },
        ];
      }
      if (this.options.face) {
        const smiling = now < this.smileUntil || Math.random() < 0.015;
        if (smiling && now >= this.smileUntil) this.smileUntil = now + 3500;
        const raw: Record<ExpressionKey, number> = {
          neutral: smiling ? 22 : 70,
          happy: smiling ? 70 : 6 + Math.random() * 4,
          fear: this.stress * 22,
          sad: 4 + this.stress * 6,
          surprise: 3,
          angry: 2 + this.stress * 4,
          contempt: 1.5,
          disgust: 1.5,
        };
        const total = Object.values(raw).reduce((a, b) => a + b, 0);
        const scores = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (v / total) * 100])) as Record<ExpressionKey, number>;
        packet.expression = [{ tUs, stable: elapsed > 2000, scores }];
        packet.talking = [{ tUs, detected: false }];
      }
    }

    if (this.options.eda && elapsed > EDA_START_MS) {
      packet.eda = [{ tUs, value: this.eda + (Math.random() - 0.5) * 0.04, stable: true }];
    }

    if (Object.keys(packet).length) sink.metrics(packet);
  }
}
