import { useSyncExternalStore } from 'react';

// Everything here lives in this device's local app storage only.
// Nothing is synced or uploaded. "Delete all my data" removes it.

// v2: discloses Presage LLM Insights (pulse / HRV / breathing-rate numbers the
// SDK sends to Presage while heart signals are on). Bumping the version asks
// everyone who agreed to v1 to read and agree again.
export const CONSENT_VERSION = 2;

export interface Settings {
  consentAcceptedAt: string | null;
  consentVersion: number;
  /** Keep session summaries (numbers only, never video) on this device. Off by default. */
  saveHistory: boolean;
  /**
   * Measure pulse and HRV. While on, the Presage SDK also sends pulse / HRV /
   * breathing-rate numbers (never video) to Presage for its LLM Insights.
   * Off = breathing and face signals only.
   */
  heartSignals: boolean;
  /**
   * After MyBreath Live, ask Presage LLM Insights for a short AI reflection
   * (one extra request: our prompt plus the buffered numbers). Needs heart signals.
   */
  presageReflection: boolean;
  /** Chosen camera (browser deviceId) and its label; null = system default. */
  cameraId: string | null;
  cameraLabel: string | null;
  /** Use the optional AI partner in MyStage Pulse (Groq, OpenAI fallback). Off by default. */
  aiPartner: boolean;
  /** Use simulated signals instead of the camera (practice mode). */
  simulate: boolean;
  /** Auto-pause live camera sessions after N minutes to save Presage credits. */
  sessionCapMin: number;
  /** Show the mirrored self-view while measuring. */
  showPreview: boolean;
  /** MyBreath Live says "breathe in" / "breathe out" with an offline system voice. */
  voiceGuide: boolean;
  /** Seconds of live Presage measurement used on this device (credit estimate). */
  liveSecondsUsed: number;
}

const KEY = 'myzenn-sense.settings';

const DEFAULTS: Settings = {
  consentAcceptedAt: null,
  consentVersion: CONSENT_VERSION,
  saveHistory: false,
  heartSignals: true,
  presageReflection: true,
  cameraId: null,
  cameraLabel: null,
  aiPartner: false,
  simulate: false,
  sessionCapMin: 5,
  showPreview: true,
  voiceGuide: true,
  liveSecondsUsed: 0,
};

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = typeof localStorage === 'undefined' ? { ...DEFAULTS } : read();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: settings still apply for this run */
  }
  for (const fn of listeners) fn();
}

export function resetSettings() {
  current = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}

export function hasConsent(s: Settings = current): boolean {
  return !!s.consentAcceptedAt && s.consentVersion === CONSENT_VERSION;
}
