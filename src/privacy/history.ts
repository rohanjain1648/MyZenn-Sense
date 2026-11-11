import { useSyncExternalStore } from 'react';
import { getSettings, resetSettings } from './settings';

// Optional, opt-in session history. Stores summary numbers only (never video,
// never images, never conversation text), on this device only.

export type ToolId = 'breath' | 'heartsong' | 'stage';

export interface SessionSummary {
  id: string;
  tool: ToolId;
  at: string;
  durationSec: number;
  source: 'presage' | 'simulated';
  /** Small set of numbers, e.g. { breathingBefore: 14.2, breathingAfter: 7.1 } */
  numbers: Record<string, number | null>;
}

const KEY = 'myzenn-sense.history';
const MAX_ENTRIES = 50;

function read(): SessionSummary[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as SessionSummary[];
  } catch {
    return [];
  }
}

let current: SessionSummary[] = typeof localStorage === 'undefined' ? [] : read();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** Saves only when the user has turned history on. Returns whether it was saved. */
export function recordSession(summary: Omit<SessionSummary, 'id' | 'at'>): boolean {
  if (!getSettings().saveHistory) return false;
  const entry: SessionSummary = { ...summary, id: crypto.randomUUID(), at: new Date().toISOString() };
  current = [entry, ...current].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  emit();
  return true;
}

export function clearHistory() {
  current = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** Removes every piece of data MyZenn Sense stores, including consent. */
export function deleteAllData() {
  clearHistory();
  resetSettings();
}

export function useHistory(): SessionSummary[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
