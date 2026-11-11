// Live signals from the Presage SmartSpectra SDK (Electron renderer SDK).
//
// The SDK computes every metric on-device; video never leaves the computer.
// It contacts Presage to authenticate the API key, and (while cardio metrics
// are active) its built-in LLM Insights send pulse / HRV / breathing-rate
// numbers to Presage. We construct it with enableTelemetry: false, so no
// session summaries or readiness reports are sent.
import type { ExpressionKey, MetricsPacket, OptionalSignal, RawExpression, SignalSource, SourceSink, StartOptions } from '../types';

// ExpressionType enum from the SmartSpectra protobuf schema.
const EXPRESSION_BY_TYPE: Record<number, ExpressionKey> = {
  1: 'angry',
  2: 'contempt',
  3: 'disgust',
  4: 'fear',
  5: 'happy',
  6: 'neutral',
  7: 'sad',
  8: 'surprise',
};

// MetricType codes. We request only what the tools use: no arterial
// pressure trace and no 478-point face mesh.
const METRIC = {
  CHEST_BREATHING: 0,
  ABDOMEN_BREATHING: 1,
  BREATHING_RATE: 2,
  EDA_TRACE: 10,
  BLINKING: 12,
  TALKING: 13,
  EXPRESSIONS: 14,
  PULSE_RATE: 15,
  HRV: 17,
} as const;

const STATUS = { 0: 'idle', 1: 'idle', 2: 'starting', 3: 'running', 4: 'stopping', 5: 'error' } as const;

const ERROR_TEXT: Record<number, string> = {
  2: 'Presage could not verify the API key. Check PRESAGE_API_KEY in your .env file.',
  3: 'The SDK could not be configured for these signals.',
  4: 'Your Presage credits are used up for this period.',
  5: 'Network problem while verifying your Presage key. Check your connection.',
  7: 'The camera is unavailable. Close other apps that use it and try again.',
  13: 'Your Presage key is not enabled for one of the requested signals.',
  14: 'The camera frame rate is too low. Add light or close other camera apps.',
};

// kConfigurationFailed / kMetricNotAuthorized: the key can't serve a requested signal.
const DENIED_CODES = new Set([3, 13]);

type AnyRecord = Record<string, any>;

function toNumber(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'bigint') return Number(ts);
  if (ts && typeof (ts as AnyRecord).toNumber === 'function') return (ts as AnyRecord).toNumber();
  return Number(ts ?? 0);
}

function measurements(list: AnyRecord[] | undefined) {
  if (!list?.length) return undefined;
  return list.map((m) => ({
    tUs: toNumber(m.timestamp),
    value: Number(m.value),
    confidence: m.confidence === undefined ? undefined : Number(m.confidence),
    stable: !!m.stable,
  }));
}

export function normalizeMetrics(metrics: AnyRecord): MetricsPacket {
  const packet: MetricsPacket = {
    breathingRate: measurements(metrics.breathing?.rate),
    chest: measurements(metrics.breathing?.upperTrace),
    abdomen: measurements(metrics.breathing?.lowerTrace),
    pulse: measurements(metrics.cardio?.pulseRate),
    eda: measurements(metrics.eda?.trace),
  };
  const hrv = metrics.cardio?.hrv as AnyRecord[] | undefined;
  if (hrv?.length) {
    packet.hrv = hrv.map((h) => ({
      tUs: toNumber(h.timestamp),
      rmssd: Number(h.rmssd),
      sdnn: Number(h.sdnn),
      meanNn: Number(h.meanNn),
      baevsky: Number(h.baevsky),
      confidence: Number(h.confidence ?? 0),
      stable: !!h.stable,
    }));
  }
  const face = metrics.face as AnyRecord | undefined;
  if (face?.expression?.length) {
    packet.expression = (face.expression as AnyRecord[]).map((e): RawExpression => {
      const scores: RawExpression['scores'] = {};
      for (const s of (e.scores ?? []) as AnyRecord[]) {
        const key = EXPRESSION_BY_TYPE[Number(s.type)];
        if (key) scores[key] = Number(s.confidence);
      }
      return { tUs: toNumber(e.timestamp), stable: !!e.stable, scores };
    });
  }
  if (face?.blinking?.length) {
    packet.blinking = (face.blinking as AnyRecord[]).map((b) => ({ tUs: toNumber(b.timestamp), detected: !!b.detected }));
  }
  if (face?.talking?.length) {
    packet.talking = (face.talking as AnyRecord[]).map((b) => ({ tUs: toNumber(b.timestamp), detected: !!b.detected }));
  }
  return packet;
}

export function presageAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.myzennSense?.isElectron && !!window.__smartspectraBridge;
}

/** Info-level notices (the session continues). Anything else is shown as a warning. */
export const INFO_NOTICE_CODES = new Set(['CARDIO_UNAVAILABLE', 'EDA_UNAVAILABLE', 'CAMERA_FALLBACK']);

const UNAVAILABLE_TEXT: Record<OptionalSignal, { code: string; message: string }> = {
  eda: {
    code: 'EDA_UNAVAILABLE',
    message: 'Skin response (EDA) is not enabled on this Presage key, so this session uses heart rate, breathing and expression.',
  },
  cardio: {
    code: 'CARDIO_UNAVAILABLE',
    message: 'Pulse and HRV are not enabled on this Presage key, so this session uses breathing and face signals only.',
  },
};

export class PresageSource implements SignalSource {
  readonly kind = 'presage' as const;
  private sdk: AnyRecord | null = null;
  /** Host-owned camera stream when the user picked a specific camera. */
  private stream: MediaStream | null = null;
  private sink: SourceSink | null = null;
  private apiKey = '';
  private options: StartOptions = { cardio: false, face: false, eda: false, cameraId: null };
  private stopped = false;
  private relaunching = false;
  private launchId = 0;

  async start(sink: SourceSink, options: StartOptions): Promise<void> {
    this.stopped = false;
    this.sink = sink;
    this.options = { ...options };
    const bridge = window.myzennSense;
    if (!bridge || !presageAvailable()) {
      throw new Error('Live signals need the MyZenn Sense desktop app (npm run app).');
    }
    const apiKey = await bridge.getPresageKey();
    if (!apiKey) {
      sink.error({ code: 'NO_KEY', message: 'Add PRESAGE_API_KEY to the .env file, then restart the app.', retryable: false });
      throw new Error('Missing Presage API key');
    }
    this.apiKey = apiKey;
    await this.run();
  }

  /**
   * Launch the SDK; if the key refuses a signal group, drop the next optional
   * group (EDA first, then cardio) and try again, telling the user what changed.
   */
  private async run(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      try {
        await this.launch();
        return;
      } catch (err) {
        await this.halt();
        if (!this.dropOptional(Number((err as AnyRecord)?.code))) throw err;
      }
    }
  }

  private dropOptional(code: number): boolean {
    const sink = this.sink;
    if (!sink || this.stopped || !DENIED_CODES.has(code)) return false;
    const drop: OptionalSignal | null = this.options.eda ? 'eda' : this.options.cardio ? 'cardio' : null;
    if (!drop) return false;
    this.options = { ...this.options, [drop]: false };
    sink.denied(drop);
    sink.capabilities({ cardio: this.options.cardio, face: this.options.face, eda: this.options.eda });
    sink.error({ ...UNAVAILABLE_TEXT[drop], retryable: false });
    return true;
  }

  private async acquireStream(): Promise<MediaStream | null> {
    const cameraId = this.options.cameraId;
    if (!cameraId) return null;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: cameraId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch (err) {
      console.warn('[sense] chosen camera unavailable, using the default camera', err);
      this.sink?.error({ code: 'CAMERA_FALLBACK', message: 'The chosen camera is not available, so the default camera is used.', retryable: false });
      this.options = { ...this.options, cameraId: null };
      return null;
    }
  }

  private async launch() {
    const sink = this.sink;
    if (!sink) return;
    const options = this.options;
    const id = ++this.launchId;
    const current = () => id === this.launchId && !this.stopped;

    const sdkModule: AnyRecord = await import('@smartspectra/node-sdk/renderer');
    const { decodeMetrics } = (await import('@smartspectra/node-sdk/messages')) as AnyRecord;

    const requested: number[] = [METRIC.CHEST_BREATHING, METRIC.ABDOMEN_BREATHING, METRIC.BREATHING_RATE];
    if (options.cardio) requested.push(METRIC.PULSE_RATE, METRIC.HRV);
    if (options.face) requested.push(METRIC.BLINKING, METRIC.TALKING, METRIC.EXPRESSIONS);
    if (options.eda) requested.push(METRIC.EDA_TRACE);

    const sdk = new sdkModule.SmartSpectraSDK({
      apiKey: this.apiKey,
      requestedMetrics: requested,
      enableAccumulatedOutput: false,
      enableTelemetry: false,
    });
    this.sdk = sdk;
    sink.capabilities({ cardio: options.cardio, face: options.face, eda: options.eda });

    sdk.on('processingStatus', (status: number) => current() && sink.phase(STATUS[status as keyof typeof STATUS] ?? 'starting'));
    sdk.on('validationStatus', (code: number, _ts: number, hint: string) => current() && sink.guidance(code, hint));
    sdk.on('metrics', (buf: Uint8Array) => {
      if (!current()) return;
      try {
        sink.metrics(normalizeMetrics(decodeMetrics(buf) as AnyRecord));
      } catch (e) {
        console.warn('[sense] could not decode metrics packet', e);
      }
    });
    sdk.on('error', (code: number, message: string, retryable: boolean) => {
      if (!current()) return;
      // A refused signal can also surface after start(); relaunch without it.
      if (DENIED_CODES.has(code) && (this.options.eda || this.options.cardio) && !this.relaunching) {
        this.relaunching = true;
        void (async () => {
          try {
            await this.halt();
            if (this.dropOptional(code)) await this.run();
          } catch (e) {
            sink.error({ code: 'START_FAILED', message: e instanceof Error ? e.message : String(e), retryable: true });
          } finally {
            this.relaunching = false;
          }
        })();
        return;
      }
      sink.error({ code: String(code), message: ERROR_TEXT[code] ?? message, retryable });
    });
    sdk.on('streamAvailable', (stream: MediaStream) => current() && sink.stream(stream));
    // Presage LLM Insights: while cardio metrics are active the SDK auto-sends
    // pulse / HRV / breathing-rate numbers to Presage and returns AI check-ins.
    // The SDK has no switch for this. Replies are counted (and an on-demand
    // reflection is matched by request id); auto check-ins are not displayed.
    sdk.on('insight', (buf: Uint8Array, requestId: number) => {
      if (!current()) return;
      console.info(`[sense] Presage insight received (request ${requestId}, ${buf?.byteLength ?? 0} bytes)`);
      sink.insight(requestId, buf);
    });

    if (!this.stream) this.stream = await this.acquireStream();
    if (this.stream) {
      sdk.useMediaStream(this.stream);
      sink.stream(this.stream);
    }

    await sdk.start();
  }

  async requestInsight(prompt: string): Promise<number> {
    if (!this.sdk) throw new Error('No running session');
    return this.sdk.requestInsight(prompt);
  }

  /** Stop and destroy the SDK instance, keeping a host-owned camera stream for a relaunch. */
  private async halt() {
    const sdk = this.sdk;
    this.sdk = null;
    this.launchId++;
    if (!sdk) return;
    try {
      await sdk.stop();
    } catch {
      /* not running */
    }
    try {
      sdk.destroy();
    } catch {
      /* already destroyed */
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.halt();
    // We opened this stream (camera picker), so we must release it.
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
