import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraRail } from '@/components/CameraRail';
import { Button } from '@/components/Button';
import { SessionNotices } from '@/components/Notice';
import { PathChart } from '@/components/PathChart';
import { StartGate } from '@/components/StartGate';
import { recordSession } from '@/privacy/history';
import { getSettings } from '@/privacy/settings';
import { reflectionPrompt } from '@/sense/insight';
import { engine, requestReflection, simulator, stopSession, useSenseState, type ReflectionOutcome } from '@/sense/session';
import { instantBreathingRate, mean, rhythmMatch } from '@/sense/signalMath';
import type { HrvReading, TracePoint } from '@/sense/types';
import { BreathCanvas } from './BreathCanvas';
import { createPacer, updatePacer, type PacerState } from './pacer';

type Stage = 'intro' | 'tuning' | 'guiding' | 'done';

interface Baseline {
  breathing: number;
  pulse: number | null;
  rmssd: number | null;
}

interface Summary {
  minutes: number;
  breathingBefore: number;
  breathingAfter: number | null;
  pulseBefore: number | null;
  pulseAfter: number | null;
  rmssdBefore: number | null;
  rmssdAfter: number | null;
  sdnnBefore: number | null;
  sdnnAfter: number | null;
  baevskyBefore: number | null;
  baevskyAfter: number | null;
  syncAverage: number | null;
  reachedTarget: boolean;
  paceSteps: TracePoint[];
  measured: TracePoint[];
  source: 'presage' | 'simulated';
}

const ARRIVED_HOLD_MS = 45_000;
/** How long the camera may stay on after Finish while Presage writes the reflection. */
const REFLECTION_WAIT_MS = 25_000;

type Reflection = ReflectionOutcome | { status: 'waiting' } | { status: 'skipped' } | null;

function lastWindowMean(points: TracePoint[], windowMs: number): number | null {
  if (!points.length) return null;
  const end = points[points.length - 1].t;
  const values = points.filter((p) => p.t >= end - windowMs).map((p) => p.v);
  return values.length ? mean(values) : null;
}

export function BreathLive() {
  const s = useSenseState();
  const [stage, setStage] = useState<Stage>('intro');
  const [pacer, setPacer] = useState<PacerState | null>(null);
  const [inhaling, setInhaling] = useState(true);
  const [measuredPace, setMeasuredPace] = useState<number | null>(null);
  const [sync, setSync] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reflection, setReflection] = useState<Reflection>(null);
  const skippedRef = useRef(false);

  const pacerRef = useRef<PacerState | null>(null);
  const phaseRef = useRef(0);
  const guideHistory = useRef<TracePoint[]>([]);
  const signRef = useRef<1 | -1>(1);
  const baselineRef = useRef<Baseline | null>(null);
  const measuredLog = useRef<TracePoint[]>([]);
  const syncLog = useRef<number[]>([]);
  // First and latest stable HRV readings (RMSSD, SDNN, Baevsky), compared
  // only with the user's own start, as Presage's HRV model card advises.
  const firstHrv = useRef<HrvReading | null>(null);
  const lastHrv = useRef<HrvReading | null>(null);
  const guideStartedAt = useRef(0);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const live = s.phase === 'running' || s.phase === 'starting';

  const finishingRef = useRef(false);

  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const baseline = baselineRef.current;
    const p = pacerRef.current;
    simulator()?.setFollowTarget(null);
    const source = engine.getState().source ?? 'simulated';
    if (!baseline || !p) {
      if (engine.getState().phase !== 'idle') await stopSession();
      setStage('intro');
      return;
    }
    const history = engine.getHistory();
    const rmssdSeries = history.rmssd;
    const result: Summary = {
      minutes: (engine.nowMs() - guideStartedAt.current) / 60_000,
      breathingBefore: baseline.breathing,
      breathingAfter: lastWindowMean(measuredLog.current, 30_000),
      pulseBefore: baseline.pulse,
      pulseAfter: lastWindowMean(history.pulse, 30_000),
      rmssdBefore: baseline.rmssd ?? rmssdSeries[0]?.v ?? null,
      rmssdAfter: rmssdSeries.length > 1 ? rmssdSeries[rmssdSeries.length - 1].v : null,
      sdnnBefore: firstHrv.current?.sdnn ?? null,
      sdnnAfter: lastHrv.current && lastHrv.current !== firstHrv.current ? lastHrv.current.sdnn : null,
      baevskyBefore: firstHrv.current?.baevsky ?? null,
      baevskyAfter: lastHrv.current && lastHrv.current !== firstHrv.current ? lastHrv.current.baevsky : null,
      syncAverage: syncLog.current.length ? mean(syncLog.current) : null,
      reachedTarget: p.status === 'arrived',
      paceSteps: p.steps.map((step) => ({ t: step.t, v: step.pace })),
      measured: measuredLog.current,
      source,
    };
    setSummary(result);
    setStage('done');
    recordSession({
      tool: 'breath',
      durationSec: Math.round(result.minutes * 60),
      source,
      numbers: {
        breathingBefore: result.breathingBefore,
        breathingAfter: result.breathingAfter,
        pulseBefore: result.pulseBefore,
        pulseAfter: result.pulseAfter,
        rmssdBefore: result.rmssdBefore,
        rmssdAfter: result.rmssdAfter,
      },
    });

    // Presage AI reflection: one on-demand LLM Insight, requested while the
    // session is still running (the SDK needs it), then the camera turns off.
    const state = engine.getState();
    skippedRef.current = false;
    if (getSettings().presageReflection && state.capabilities.cardio && state.phase === 'running') {
      setReflection({ status: 'waiting' });
      const outcome = await requestReflection(
        reflectionPrompt({ minutes: result.minutes, breathingBefore: result.breathingBefore, breathingAfter: result.breathingAfter }),
        REFLECTION_WAIT_MS,
      );
      setReflection(skippedRef.current ? { status: 'skipped' } : outcome);
    } else {
      setReflection(null);
    }
    if (engine.getState().phase !== 'idle') await stopSession();
  }, []);

  const skipReflection = useCallback(() => {
    skippedRef.current = true;
    void stopSession();
  }, []);

  // Tuning in: wait for a trustworthy breathing rate, then start leading.
  useEffect(() => {
    if (stage !== 'tuning' || !live) return;
    const br = s.breathingRate;
    const ready = br && (br.stable || (s.elapsedMs > 35_000 && br.confidence > 0));
    if (!ready) return;
    const now = engine.nowMs();
    baselineRef.current = {
      breathing: br.value,
      pulse: s.pulse?.stable ? s.pulse.value : null,
      rmssd: s.hrv?.stable ? s.hrv.rmssd : null,
    };
    const p = createPacer(instantBreathingRate(engine.getChest(20_000)) ?? br.value, now);
    pacerRef.current = p;
    setPacer(p);
    phaseRef.current = 0;
    guideHistory.current = [];
    measuredLog.current = [];
    syncLog.current = [];
    firstHrv.current = s.hrv?.stable ? s.hrv : null;
    lastHrv.current = firstHrv.current;
    guideStartedAt.current = now;
    simulator()?.setFollowTarget(() => pacerRef.current?.pace ?? null);
    finishingRef.current = false;
    setStage('guiding');
  }, [stage, live, s.breathingRate, s.pulse, s.hrv, s.elapsedMs]);

  // Guiding: update the pacer every second, the rhythm match every two.
  useEffect(() => {
    if (stage !== 'guiding') return;
    let tick = 0;
    const handle = setInterval(() => {
      const current = pacerRef.current;
      if (!current) return;
      const now = engine.nowMs();
      const state = engine.getState();
      const chest = engine.getChest(20_000);
      // Breathing cannot be measured while talking (SDK talking detection),
      // so the guide simply holds its step until the user is quiet again.
      const measured = state.talking
        ? null
        : (instantBreathingRate(chest) ?? (state.breathingRate?.stable ? state.breathingRate.value : null));
      if (measured !== null) measuredLog.current.push({ t: now, v: measured });
      setMeasuredPace(measured);
      if (state.hrv?.stable) {
        firstHrv.current ??= state.hrv;
        lastHrv.current = state.hrv;
      }
      const next = updatePacer(current, measured, now);
      pacerRef.current = next;
      setPacer(next);

      const baseline = baselineRef.current;
      if (baseline && baseline.pulse === null && state.pulse?.stable) baseline.pulse = state.pulse.value;
      if (baseline && baseline.rmssd === null && state.hrv?.stable) baseline.rmssd = state.hrv.rmssd;

      if (++tick % 2 === 0 && guideHistory.current.length > 60) {
        const history = guideHistory.current;
        const target = (t: number) => {
          let lo = 0;
          let hi = history.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (history[mid].t < t) lo = mid + 1;
            else hi = mid;
          }
          return history[lo].v;
        };
        const recent = engine.getChest(15_000).filter((pt) => pt.t >= history[0].t);
        const result = rhythmMatch(recent, target);
        if (recent.length > 150) {
          signRef.current = result.sign;
          setSync(result.score);
          syncLog.current.push(result.score);
        }
      }

      if (next.status === 'arrived' && next.arrivedAt !== null && now - next.arrivedAt > ARRIVED_HOLD_MS) {
        void finish();
      }
    }, 1000);
    return () => clearInterval(handle);
  }, [stage, finish]);

  // Camera stopped from the rail (or auto-paused): wrap up gracefully.
  useEffect(() => {
    if (s.phase !== 'idle' && s.phase !== 'error') return;
    if (stageRef.current === 'guiding') void finish();
    else if (stageRef.current === 'tuning') setStage('intro');
  }, [s.phase, finish]);

  // Leaving the screen releases the camera.
  useEffect(
    () => () => {
      simulator()?.setFollowTarget(null);
      void stopSession();
    },
    [],
  );

  if (stage === 'done' && summary) {
    return (
      <BreathSummary
        summary={summary}
        reflection={reflection}
        onSkipReflection={skipReflection}
        onAgain={() => {
          setReflection(null);
          setStage('intro');
        }}
      />
    );
  }

  if (stage === 'intro') {
    return (
      <div className="flex flex-col gap-6">
        <SessionNotices error={s.error} stopReason={s.stopReason} />
        <StartGate
          title="MyBreath Live"
          cardio
          face
          startLabel="Start breathing"
          onStarted={() => setStage('tuning')}
          intro={
            <>
              <p>A breathing guide that starts at your pace, not a stopwatch's.</p>
              <p>
                For the first half minute it just listens. Then the circle breathes with you and, each time your breathing keeps
                up, it slows a little, step by step, towards about six breaths a minute. The dotted ring is your own chest
                moving. Try to keep it with the circle.
              </p>
            </>
          }
        />
      </div>
    );
  }

  const paceLabel = pacer ? pacer.pace.toFixed(pacer.pace % 1 ? 2 : 0).replace(/0$/, '') : null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <section className="relative flex min-h-[520px] flex-1 flex-col items-center justify-between rounded-3xl border border-white/5 bg-black/20 p-6">
        <div className="w-full">
          <SessionNotices error={s.error} stopReason={null} />
        </div>
        <div className="absolute inset-0">
          <BreathCanvas
            mode={stage === 'guiding' ? 'guide' : 'listen'}
            getPace={() => pacerRef.current?.pace ?? null}
            phaseRef={phaseRef}
            guideHistory={guideHistory}
            signRef={signRef}
            onPhaseChange={setInhaling}
          />
        </div>
        <div className="pointer-events-none relative mt-auto mb-auto text-center" aria-live="polite">
          {stage === 'tuning' ? (
            <>
              <p className="font-display text-3xl font-light">Breathe naturally</p>
              <p className="mt-2 text-sm text-muted-foreground">Listening to your rhythm first.</p>
            </>
          ) : (
            <p className="font-display text-4xl font-light tracking-wide">{inhaling ? 'Breathe in' : 'Breathe out'}</p>
          )}
        </div>
        {stage === 'guiding' && pacer && (
          <div className="relative flex w-full flex-wrap items-end justify-between gap-4">
            <dl className="flex gap-8">
              <div>
                <dt className="text-xs text-muted-foreground">Guide</dt>
                <dd className="font-display text-2xl text-breath tabular">
                  {paceLabel}
                  <span className="ml-1 text-xs text-muted-foreground">/ min</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">You</dt>
                <dd className="font-display text-2xl tabular">
                  {measuredPace ? measuredPace.toFixed(1) : '...'}
                  <span className="ml-1 text-xs text-muted-foreground">/ min</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">In rhythm</dt>
                <dd className="font-display text-2xl tabular">{sync === null ? '...' : `${Math.round(sync * 100)}%`}</dd>
              </div>
            </dl>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {pacer.status === 'arrived'
                  ? 'You are there. Stay with it.'
                  : pacer.status === 'easing'
                    ? 'Easing back a little.'
                    : 'Slows down when you keep up.'}
              </span>
              <Button variant="quiet" size="sm" onClick={() => void finish()}>
                Finish
              </Button>
            </div>
          </div>
        )}
      </section>
      <CameraRail />
    </div>
  );
}

function Row({ label, before, after, unit, digits = 0, color }: { label: string; before: number | null; after: number | null; unit: string; digits?: number; color: string }) {
  if (before === null && after === null) return null;
  const fmt = (v: number | null) => (v === null ? '...' : v.toFixed(digits));
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-display text-2xl tabular ${color}`}>
        {fmt(before)} <span className="text-muted-foreground">to</span> {fmt(after)}
        <span className="ml-1.5 text-sm text-muted-foreground">{unit}</span>
      </span>
    </div>
  );
}

function ReflectionCard({ reflection, onSkip }: { reflection: Reflection; onSkip: () => void }) {
  if (!reflection) return null;
  if (reflection.status === 'waiting') {
    return (
      <div role="status" className="mt-8 rounded-2xl border border-white/10 px-5 py-4">
        <p className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
          Presage is writing a short reflection on your session. The camera stays on until it arrives (up to 25 seconds).
        </p>
        <Button variant="quiet" size="sm" className="mt-3" onClick={onSkip}>
          Skip and turn the camera off
        </Button>
      </div>
    );
  }
  if (reflection.status === 'ok') {
    return (
      <figure className="mt-8 rounded-2xl border border-breath/25 bg-breath/5 px-5 py-4">
        <blockquote className="font-display text-lg font-light leading-relaxed">{reflection.text}</blockquote>
        <figcaption className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {reflection.simulated
            ? 'Practice mode sample. In a live session this reflection is written by an AI model through Presage LLM Insights.'
            : 'Written by an AI model through Presage LLM Insights, from your pulse, heart-rhythm and breathing-rate numbers. General wellness only, not medical advice, and AI can be wrong.'}
        </figcaption>
      </figure>
    );
  }
  const quiet: Record<string, string> = {
    filtered: "Presage's reflection drifted into medical language, so it isn't shown. This is a wellness tool.",
    skipped: 'Reflection skipped. The camera is off.',
    timeout: 'Presage did not reply in time, so there is no reflection this session.',
    unavailable: 'No reflection this session: the camera stopped before Presage could reply.',
    error: 'Presage could not write a reflection this session.',
  };
  return <p className="mt-8 text-xs text-muted-foreground">{quiet[reflection.status]}</p>;
}

function BreathSummary({
  summary,
  reflection,
  onSkipReflection,
  onAgain,
}: {
  summary: Summary;
  reflection: Reflection;
  onSkipReflection: () => void;
  onAgain: () => void;
}) {
  const t0 = summary.paceSteps[0]?.t ?? 0;
  const shift = (pts: TracePoint[]) => pts.map((p) => ({ t: p.t - t0, v: p.v }));
  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in-up">
      <h1 className="text-3xl font-semibold tracking-tight">
        {summary.reachedTarget ? 'You found your slow rhythm' : 'Nice work slowing down'}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {summary.minutes.toFixed(1)} minutes of guided breathing
        {summary.source === 'simulated' ? ' (practice mode, simulated signals)' : ''}.
      </p>

      <div className="mt-8 divide-y divide-white/5 rounded-2xl border border-white/10 px-5">
        <Row label="Breathing pace" before={summary.breathingBefore} after={summary.breathingAfter} unit="/ min" digits={1} color="text-breath" />
        <Row label="Heart rate" before={summary.pulseBefore} after={summary.pulseAfter} unit="bpm" color="text-heart" />
        <Row label="Heart rhythm variability (RMSSD)" before={summary.rmssdBefore} after={summary.rmssdAfter} unit="ms" color="text-heart" />
        <Row label="Heart rhythm spread (SDNN)" before={summary.sdnnBefore} after={summary.sdnnAfter} unit="ms" color="text-heart" />
        <Row label="Baevsky index (lower than your start = more settled)" before={summary.baevskyBefore} after={summary.baevskyAfter} unit="" color="text-heart" />
        {summary.syncAverage !== null && (
          <div className="flex items-baseline justify-between gap-6 py-3">
            <span className="text-muted-foreground">Breathing in rhythm with the guide</span>
            <span className="font-display text-2xl tabular">{Math.round(summary.syncAverage * 100)}%</span>
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">How the guide followed and led you</h2>
        <PathChart
          unit="breaths / min"
          series={[
            { label: 'Guide', points: shift(summary.paceSteps), color: 'hsl(172 70% 52%)', step: true },
            { label: 'You', points: shift(summary.measured), color: 'rgba(255,255,255,0.7)', dashed: true },
          ]}
        />
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        A wellness reflection, not a medical measurement. Readings come from your camera via the Presage SmartSpectra SDK, and
        video never leaves this computer.
      </p>
      <ReflectionCard reflection={reflection} onSkip={onSkipReflection} />
      <div className="mt-6 flex gap-3">
        <Button onClick={onAgain}>Breathe again</Button>
        <Button variant="quiet" onClick={() => (window.location.hash = '')}>
          Back to Sanctuary
        </Button>
      </div>
    </div>
  );
}
