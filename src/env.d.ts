/// <reference types="vite/client" />
import type { AiProvider } from './lib/ai';

export interface SenseConfig {
  hasPresageKey: boolean;
  /** AI providers with a key configured, in the order they are tried (Groq first, OpenAI fallback). */
  aiProviders: AiProvider[];
  platform: string;
  sdkVersion: string;
  appVersion: string;
}

export interface StageTurn {
  role: 'user' | 'partner';
  text: string;
}

export interface AiReply {
  text: string;
  provider: AiProvider;
  model: string;
  /** True when the primary provider failed and the fallback answered. */
  fellBack: boolean;
}

export interface ReadinessResult {
  verdict: 'ready' | 'limited' | 'blocked' | 'inconclusive';
  reason: string;
}

export interface MyZennSenseBridge {
  isElectron: true;
  getConfig(): Promise<SenseConfig>;
  getPresageKey(): Promise<string | null>;
  checkReadiness(request: { cardio: boolean; face: boolean; eda: boolean; cameraLabel: string | null }): Promise<ReadinessResult>;
  stageReply(request: { system: string; turns: StageTurn[]; bodyState: 'settled' | 'tense' }): Promise<AiReply>;
  stageDebrief(request: { scenario: string; turns: StageTurn[]; moments: string }): Promise<AiReply>;
}

declare global {
  interface Window {
    /** Present only inside the Electron app (see electron/app-preload.cjs). */
    myzennSense?: MyZennSenseBridge;
    /** Presage SmartSpectra preload bridge, present only inside Electron. */
    __smartspectraBridge?: unknown;
  }
}
