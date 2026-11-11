import { ChimesAudioEngine } from '@/myzenn/chimesAudioEngine';
import { engine as sense } from '@/sense/session';
import { detectBreaths, detrend, instantBreathingRate, normalizeTrace } from '@/sense/signalMath';
import {
  KEY_DEGREES,
  MAJOR_PENTATONIC,
  MINOR_PENTATONIC,
  beatIntervalMs,
  brightKey,
  calmness,
  degreeToFreq,
  nextDegree,
} from './mapping';

export type NoteSource = 'heart' | 'breath' | 'blink' | 'smile' | 'calm' | 'key';

export interface PlayedNote {
  source: NoteSource;
  degree: number;
  at: number;
}

const CALM_HOLD_MS = 15_000;

/**
 * Orchestrates Heartsong's sound from live body signals:
 *  heart  -> a soft lub-dub at your pulse (the tempo)
 *  breath -> a drone that swells with your chest, and a melody note per breath
 *  blink  -> a high bell
 *  smile  -> the key brightens from minor to major pentatonic, with a sparkle
 *  calm   -> a resolving chord once your breathing settles slow
 */
export class HeartsongPlayer {
  private audio = new ChimesAudioEngine();
  private drone: { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private beatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMelodyCheck = 0;
  private lastPeakT = -Infinity;
  private lastBlinkAt = 0;
  private calmSince: number | null = null;
  private resolved = false;
  private degree = 4;
  private running = false;
  private unsubscribeBlink: (() => void) | null = null;

  bright = false;
  breathLevel = 0;
  counts: Record<NoteSource, number> = { heart: 0, breath: 0, blink: 0, smile: 0, calm: 0, key: 0 };
  onNote: ((note: PlayedNote) => void) | null = null;

  private disposeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Call inside a click so the browser allows audio. */
  unlock() {
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.disposeTimer = null;
    this.audio.init();
    this.audio.resume();
    this.audio.setVolume(0.8);
    this.audio.setReverb(true);
  }

  get scale() {
    return this.bright ? MAJOR_PENTATONIC : MINOR_PENTATONIC;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.counts = { heart: 0, breath: 0, blink: 0, smile: 0, calm: 0, key: 0 };
    this.resolved = false;
    this.calmSince = null;
    this.lastPeakT = -Infinity;
    this.startDrone();
    this.scheduleBeat(600);
    this.unsubscribeBlink = sense.onBlink(() => this.blink());
  }

  stop() {
    this.running = false;
    if (this.beatTimer) clearTimeout(this.beatTimer);
    this.beatTimer = null;
    this.unsubscribeBlink?.();
    this.unsubscribeBlink = null;
    const ctx = this.audio.context;
    if (this.drone && ctx) {
      const { oscs, gain } = this.drone;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => oscs.forEach((o) => o.stop()), 2000);
    }
    this.drone = null;
  }

  dispose() {
    this.stop();
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      if (!this.running) this.audio.dispose();
    }, 2200);
  }

  /** Play along on the keyboard. Returns true if the key is an instrument key. */
  key(key: string): boolean {
    const degree = KEY_DEGREES[key.toLowerCase()];
    if (degree === undefined) return false;
    this.play('key', degree + 5, 0.55, this.bright ? 'crystal' : 'bowl');
    return true;
  }

  /** Called every animation frame while running. */
  update(now: number) {
    if (!this.running) return;
    const ctx = this.audio.context;
    const chest = sense.getChest(12_000);

    // Breath swells the drone.
    if (chest.length > 40) {
      const norm = normalizeTrace(detrend(chest, 8000));
      const level = Math.min(1, Math.max(0, (norm[norm.length - 1].v + 1) / 2));
      this.breathLevel += (level - this.breathLevel) * 0.12;
      if (this.drone && ctx) {
        this.drone.gain.gain.setTargetAtTime(0.012 + 0.085 * this.breathLevel, ctx.currentTime, 0.08);
        this.drone.filter.frequency.setTargetAtTime(260 + 1400 * this.breathLevel, ctx.currentTime, 0.08);
      }
    }

    if (now - this.lastMelodyCheck < 250) return;
    this.lastMelodyCheck = now;
    const state = sense.getState();

    // One melody note per breath.
    const peaks = detectBreaths(sense.getChest(15_000));
    const latest = peaks[peaks.length - 1];
    if (latest !== undefined && latest > this.lastPeakT + 1500) {
      const first = this.lastPeakT === -Infinity;
      this.lastPeakT = latest;
      if (!first) {
        this.degree = nextDegree(this.degree);
        this.play('breath', this.degree + (this.bright ? 5 : 0), 0.5, this.bright ? 'crystal' : 'bowl');
      }
    }

    // Smiles brighten the key.
    const happy = state.expression?.scores.happy ?? 0;
    const nextBright = brightKey(happy, this.bright);
    if (nextBright && !this.bright) {
      this.bright = true;
      [5, 7, 9].forEach((d, i) => setTimeout(() => this.play('smile', d + 5, 0.32, 'crystal'), i * 110));
    } else if (!nextBright && this.bright) {
      this.bright = false;
    }

    // Settling into slow breathing resolves the music once.
    const rate = instantBreathingRate(chest) ?? (state.breathingRate?.stable ? state.breathingRate.value : null);
    if (calmness(rate) >= 0.85) {
      this.calmSince ??= now;
      if (!this.resolved && now - this.calmSince > CALM_HOLD_MS) {
        this.resolved = true;
        [0, 3, 5].forEach((d) => this.play('calm', d, 0.45, 'bowl'));
      }
    } else {
      this.calmSince = null;
    }
  }

  private blink() {
    const now = performance.now();
    if (!this.running || now - this.lastBlinkAt < 400) return;
    this.lastBlinkAt = now;
    this.play('blink', 10 + Math.floor(Math.random() * 5), 0.22, 'crystal');
  }

  private scheduleBeat(delay: number) {
    this.beatTimer = setTimeout(() => {
      if (!this.running) return;
      const pulse = sense.getState().pulse;
      if (pulse && pulse.confidence > 0) {
        this.play('heart', 0, 0.42, 'drum');
        setTimeout(() => this.running && this.audio.playFrequency(degreeToFreq(0, this.scale), 0.22, 'drum'), 150);
        this.scheduleBeat(beatIntervalMs(pulse.value));
      } else {
        this.scheduleBeat(1000);
      }
    }, delay);
  }

  private play(source: NoteSource, degree: number, velocity: number, voice: 'crystal' | 'bowl' | 'drum') {
    this.audio.playFrequency(degreeToFreq(degree, this.scale), velocity, voice);
    this.counts[source]++;
    this.onNote?.({ source, degree, at: performance.now() });
  }

  private startDrone() {
    this.audio.init();
    const ctx = this.audio.context;
    if (!ctx) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const oscs = [degreeToFreq(0, MINOR_PENTATONIC), degreeToFreq(3, MINOR_PENTATONIC)].map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = i === 0 ? -4 : 5;
      osc.connect(filter);
      osc.start();
      return osc;
    });
    filter.connect(gain);
    this.audio.connectExternal(gain);
    this.drone = { oscs, filter, gain };
  }
}
