import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SenseConfig } from '../env';
import { getSettings, updateSettings } from '../privacy/settings';
import { SenseEngine } from './engine';
import { decodeInsight, wellnessOnly } from './insight';
import { PresageSource, presageAvailable } from './sources/presage';
import { SimulatedSource, type SimulatorControls } from './sources/simulated';
import type { SenseState, SourceKind } from './types';

/** The one engine shared by every tool. */
export const engine = new SenseEngine();

// Count live Presage seconds on this device so the user can see roughly how
// many credits they have used (1 credit = 30 s on the free tier).
engine.onSessionEnd(({ source, elapsedMs }) => {
  if (source !== 'presage') return;
  updateSettings({ liveSecondsUsed: getSettings().liveSecondsUsed + Math.round(elapsedMs / 1000) });
});

let configPromise: Promise<SenseConfig | null> | null = null;

export function loadConfig(): Promise<SenseConfig | null> {
  if (!configPromise) {
    configPromise = window.myzennSense ? window.myzennSense.getConfig().catch(() => null) : Promise.resolve(null);
  }
  return configPromise;
}

export function useAppConfig(): SenseConfig | null | undefined {
  const [config, setConfig] = useState<SenseConfig | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadConfig().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

export function useSenseState(): SenseState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

/** Which source a new session will use, and why. */
export function plannedSource(config: SenseConfig | null | undefined): { kind: SourceKind; reason: string | null } {
  if (getSettings().simulate) return { kind: 'simulated', reason: 'Practice mode is on in Privacy & settings.' };
  if (!presageAvailable()) {
    return { kind: 'simulated', reason: 'Live camera signals run in the desktop app (npm run app). This is practice mode.' };
  }
  if (!config?.hasPresageKey) {
    return { kind: 'simulated', reason: 'Add PRESAGE_API_KEY to the .env file for live camera signals. This is practice mode.' };
  }
  return { kind: 'presage', reason: null };
}

export interface ToolSignals {
  cardio: boolean;
  face: boolean;
  /** EDA proxy (skin-response estimate). Only MyStage Pulse asks for it. */
  eda?: boolean;
}

export async function startSession(options: ToolSignals) {
  const config = await loadConfig();
  const { kind } = plannedSource(config);
  const settings = getSettings();
  const source = kind === 'presage' ? new PresageSource() : new SimulatedSource();
  const capMs = kind === 'presage' ? settings.sessionCapMin * 60_000 : null;
  await engine.start(source, {
    // The user can switch heart signals off; tools then run on breathing and face only.
    cardio: options.cardio && settings.heartSignals,
    face: options.face,
    eda: !!options.eda,
    cameraId: settings.cameraId,
    capMs,
  });
}

/**
 * Device Readiness (SmartSpectra checkDeviceReadiness): checks camera and
 * computer performance for the requested signals without starting a
 * measurement. Desktop app only. Opens the camera briefly from the main process.
 */
export async function checkReadiness(options: ToolSignals) {
  if (!window.myzennSense) return null;
  const settings = getSettings();
  return window.myzennSense.checkReadiness({
    cardio: options.cardio && settings.heartSignals,
    face: options.face,
    eda: !!options.eda,
    cameraLabel: settings.cameraLabel,
  });
}

export type ReflectionOutcome =
  | { status: 'ok'; text: string; simulated: boolean }
  | { status: 'filtered' }
  | { status: 'error'; message: string }
  | { status: 'timeout' }
  | { status: 'unavailable' };

/**
 * Ask Presage LLM Insights for one on-demand reflection while the session is
 * still running, and wait for the reply that matches our request id. Replies
 * that drift into medical territory are not shown (wellnessOnly).
 */
export function requestReflection(prompt: string, timeoutMs = 25_000): Promise<ReflectionOutcome> {
  return new Promise((resolve) => {
    const early = new Map<number, Uint8Array>();
    let wanted: number | null = null;
    let done = false;

    const end = (outcome: ReflectionOutcome) => {
      if (done) return;
      done = true;
      offInsight();
      offEnd();
      clearTimeout(timer);
      resolve(outcome);
    };

    const handle = (buf: Uint8Array) => {
      try {
        const insight = decodeInsight(buf);
        if (insight.error) return end({ status: 'error', message: insight.error });
        const text = wellnessOnly(insight.analysis);
        end(text ? { status: 'ok', text, simulated: engine.getState().source === 'simulated' } : { status: 'filtered' });
      } catch {
        end({ status: 'error', message: 'The reply could not be read.' });
      }
    };

    const offInsight = engine.onInsight((id, buf) => {
      if (wanted === null) early.set(id, buf);
      else if (id === wanted) handle(buf);
    });
    const offEnd = engine.onSessionEnd(() => end({ status: 'unavailable' }));
    const timer = setTimeout(() => end({ status: 'timeout' }), timeoutMs);

    engine
      .requestInsight(prompt)
      .then((id) => {
        if (id === null) return end({ status: 'unavailable' });
        wanted = id;
        const arrived = early.get(id);
        if (arrived) handle(arrived);
      })
      .catch((err: unknown) => end({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
  });
}

export function stopSession(reason?: string) {
  return engine.stop(reason);
}

/** Simulator controls when the current session is simulated (used for practice and testing). */
export function simulator(): SimulatorControls | null {
  const source = engine.getSource();
  return source instanceof SimulatedSource ? source : null;
}

// Release the camera if the window closes mid-session.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void engine.stop();
  });
}
