// Normalized signal model shared by every tool. Both signal sources (the live
// Presage SmartSpectra SDK and the offline simulator) are converted into these
// shapes, so tools never touch SDK protobufs directly.

export type SourceKind = 'presage' | 'simulated';
export type Phase = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

/** A rate-style reading (breaths/min or beats/min) with SDK quality flags. */
export interface Reading {
  value: number;
  /** 0-100, as reported by the SDK. */
  confidence: number;
  /** SDK's own "meets accuracy standard" flag (breathing >= 45, pulse >= 40). */
  stable: boolean;
  /** Milliseconds since the session started. */
  t: number;
}

export interface HrvReading {
  rmssd: number;
  sdnn: number;
  meanNn: number;
  baevsky: number;
  confidence: number;
  stable: boolean;
  t: number;
}

export const EXPRESSION_KEYS = ['angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'] as const;
export type ExpressionKey = (typeof EXPRESSION_KEYS)[number];

export interface ExpressionReading {
  /** 0-100 per expression. */
  scores: Record<ExpressionKey, number>;
  top: ExpressionKey;
  stable: boolean;
  t: number;
}

export interface TracePoint {
  /** ms since session start */
  t: number;
  v: number;
}

export type GuidanceSeverity = 'ok' | 'tuning' | 'fix';

export interface Guidance {
  code: number;
  message: string;
  severity: GuidanceSeverity;
}

export interface SenseError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface Capabilities {
  cardio: boolean;
  face: boolean;
  /** EDA proxy (skin-response estimate). Requested only by MyStage Pulse. */
  eda: boolean;
}

/** Optional signal groups a key may not be provisioned for. */
export type OptionalSignal = 'cardio' | 'eda';

export interface SenseState {
  phase: Phase;
  source: SourceKind | null;
  /** Epoch ms when the camera session started. */
  startedAt: number | null;
  elapsedMs: number;
  guidance: Guidance | null;
  breathingRate: Reading | null;
  pulse: Reading | null;
  hrv: HrvReading | null;
  expression: ExpressionReading | null;
  talking: boolean;
  blinkCount: number;
  error: SenseError | null;
  /** What this session actually delivers (cardio may be unavailable on some keys). */
  capabilities: Capabilities;
  /** Signal groups that were requested but the API key is not provisioned for. */
  deniedSignals: OptionalSignal[];
  /** Set when the session was stopped automatically (e.g. credit-saving cap). */
  stopReason: string | null;
  /**
   * Presage LLM Insight responses received this session. The SDK sends
   * pulse / HRV / breathing-rate numbers to Presage automatically while heart
   * signals are on; we count the replies so it is visible, never hidden.
   */
  insightsReceived: number;
}

// ---------------------------------------------------------------------------
// Raw packets that sources push into the engine. Timestamps are epoch
// microseconds, exactly as the SDK reports them.
// ---------------------------------------------------------------------------
export interface RawMeasurement {
  tUs: number;
  value: number;
  confidence?: number;
  stable?: boolean;
}

export interface RawHrv {
  tUs: number;
  rmssd: number;
  sdnn: number;
  meanNn: number;
  baevsky: number;
  confidence: number;
  stable: boolean;
}

export interface RawDetection {
  tUs: number;
  detected: boolean;
}

export interface RawExpression {
  tUs: number;
  stable: boolean;
  scores: Partial<Record<ExpressionKey, number>>;
}

export interface MetricsPacket {
  breathingRate?: RawMeasurement[];
  chest?: RawMeasurement[];
  abdomen?: RawMeasurement[];
  pulse?: RawMeasurement[];
  hrv?: RawHrv[];
  expression?: RawExpression[];
  blinking?: RawDetection[];
  talking?: RawDetection[];
  /** EDA proxy trace (arbitrary units, relative changes only). */
  eda?: RawMeasurement[];
}

export interface SourceSink {
  phase(phase: Phase): void;
  guidance(code: number, hint?: string): void;
  metrics(packet: MetricsPacket): void;
  error(error: SenseError): void;
  stream(stream: MediaStream | null): void;
  capabilities(caps: Capabilities): void;
  denied(signal: OptionalSignal): void;
  /** A Presage LLM Insight arrived (auto-fired or on-demand); `buf` is the serialized Insight. */
  insight(requestId: number, buf: Uint8Array): void;
}

export interface StartOptions {
  cardio: boolean;
  face: boolean;
  eda: boolean;
  /** Browser camera deviceId to use; null = system default camera. */
  cameraId?: string | null;
}

export interface SignalSource {
  readonly kind: SourceKind;
  start(sink: SourceSink, options: StartOptions): Promise<void>;
  stop(): Promise<void>;
  /** On-demand Presage LLM Insight; resolves with the request id. Needs a running session. */
  requestInsight?(prompt: string): Promise<number>;
}
