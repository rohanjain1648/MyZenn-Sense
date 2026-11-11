import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { StageTurn } from '@/env';
import { Button } from '@/components/Button';
import { CameraRail } from '@/components/CameraRail';
import { Notice, SessionNotices } from '@/components/Notice';
import { PathChart } from '@/components/PathChart';
import { StartGate } from '@/components/StartGate';
import { PROVIDER_NAME, aiRoute, type AiProvider } from '@/lib/ai';
import { cn } from '@/lib/cn';
import { stageScenarios } from '@/myzenn/stageScenarios';
import { recordSession } from '@/privacy/history';
import { useSettings } from '@/privacy/settings';
import { engine, simulator, stopSession, useAppConfig, useSenseState } from '@/sense/session';
import { instantBreathingRate, mean } from '@/sense/signalMath';
import type { TracePoint } from '@/sense/types';
import { SpikeDetector, activationScore, edaBaseline, edaRise, type Baseline, type EdaBaseline } from './activation';
import { BreathPause } from './BreathPause';
import { MAX_PARTNER_TURNS, QUICK_REPLIES, partnerReply, scriptedDebrief } from './partner';

type Stage = 'pick' | 'settle' | 'talk' | 'debrief';
type DifficultyId = 'easy' | 'medium' | 'hard';

interface Moment {
  spikeAt: number;
  afterLine: string;
  breaths: number;
  recoveredAt: number | null;
}

interface Debrief {
  scenario: string;
  pauses: number;
  averageRecoverySec: number | null;
  peak: number;
  userTurns: number;
  activation: TracePoint[];
  moments: Moment[];
  tips: string[] | null;
  source: 'presage' | 'simulated';
}

const SETTLE_MS = 30_000;
/** The EDA proxy's first sample takes ~35 s; wait for a few seconds of it, but never past this. */
const SETTLE_MAX_MS = 50_000;

/** Current breathing pace, or null while the SDK detects talking (breathing can't be measured then). */
function currentBreathing(): number | null {
  const st = engine.getState();
  if (st.talking) return null;
  return instantBreathingRate(engine.getChest(20_000)) ?? (st.breathingRate?.stable ? st.breathingRate.value : null);
}

function ActivationMeter({ value, baseline, withSkin }: { value: number; baseline: Baseline; withSkin: boolean }) {
  const label = value < 35 ? 'Settled' : value < 60 ? 'Rising' : 'Racing';
  return (
    <div className="rounded-2xl border border-white/10 px-4 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Body activation</span>
        <span className={cn('font-display text-lg', value < 35 ? 'text-breath' : value < 60 ? 'text-bell' : 'text-heart')}>{label}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Body activation">
        <div
          className={cn('h-full rounded-full transition-all duration-700', value < 35 ? 'bg-breath' : value < 60 ? 'bg-bell' : 'bg-heart')}
          style={{ width: `${Math.max(4, value)}%` }}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Compared with your own resting rhythm
        {baseline.pulse !== null ? ` (${baseline.pulse.toFixed(0)} bpm` : ' ('}
        {baseline.breathing !== null ? `${baseline.pulse !== null ? ', ' : ''}${baseline.breathing.toFixed(0)} breaths / min)` : ')'}
        {withSkin ? ', including your skin response' : ''}.
      </p>
    </div>
  );
}

export function StagePulse() {
  const s = useSenseState();
  const settings = useSettings();
  const config = useAppConfig();
  const [stage, setStage] = useState<Stage>('pick');
  const [scenarioId, setScenarioId] = useState(stageScenarios[0].id);
  const [difficultyId, setDifficultyId] = useState<DifficultyId>('medium');
  const scenario = stageScenarios.find((x) => x.id === scenarioId) ?? stageScenarios[0];
  const difficulty = scenario.difficulties.find((d) => d.id === difficultyId) ?? scenario.difficulties[0];
  const aiProviders = config?.aiProviders ?? [];
  const useAi = settings.aiPartner && aiProviders.length > 0;
  const [lastProvider, setLastProvider] = useState<AiProvider | null>(null);

  const [turns, setTurns] = useState<StageTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [activation, setActivation] = useState(0);
  const [settleLeft, setSettleLeft] = useState(SETTLE_MS);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);

  const turnsRef = useRef<StageTurn[]>([]);
  turnsRef.current = turns;
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const baselineRef = useRef<Baseline>({ pulse: null, breathing: null });
  const edaBaseRef = useRef<EdaBaseline | null>(null);
  const [waitingForSkin, setWaitingForSkin] = useState(false);
  const detectorRef = useRef(new SpikeDetector());
  const activationLog = useRef<TracePoint[]>([]);
  const moments = useRef<Moment[]>([]);
  const settleStart = useRef(0);
  const endingRef = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, waiting]);

  const beginTalk = useCallback(() => {
    const st = engine.getState();
    const recentPulse = engine.getHistory().pulse.slice(-15).map((p) => p.v);
    baselineRef.current = {
      pulse: recentPulse.length ? mean(recentPulse) : st.pulse?.stable ? st.pulse.value : null,
      breathing: currentBreathing(),
    };
    // Settled skin-response level (EDA proxy), when the key provides it.
    edaBaseRef.current = edaBaseline(engine.getEda(10_000).map((p) => p.v));
    detectorRef.current = new SpikeDetector();
    activationLog.current = [];
    moments.current = [];
    endingRef.current = false;
    setTurns([{ role: 'partner', text: difficulty.openerPrompt }]);
    setFinished(false);
    setPaused(false);
    setAiNote(null);
    setStage('talk');
  }, [difficulty]);

  // Settle: learn the resting rhythm for ~30 s before the conversation.
  useEffect(() => {
    if (stage !== 'settle') return;
    const handle = setInterval(() => {
      const elapsed = engine.nowMs() - settleStart.current;
      setSettleLeft(Math.max(0, SETTLE_MS - elapsed));
      const st = engine.getState();
      const ready = st.pulse?.stable || st.breathingRate?.stable;
      // With EDA on, also wait for a few seconds of skin-response samples.
      const skinReady = !st.capabilities.eda || engine.getEda(10_000).length >= 5 || elapsed >= SETTLE_MAX_MS;
      setWaitingForSkin(elapsed >= SETTLE_MS && !skinReady);
      if (elapsed >= SETTLE_MS && ready && skinReady) beginTalk();
    }, 500);
    return () => clearInterval(handle);
  }, [stage, beginTalk]);

  // Talk: score activation every second and pause the partner on a sustained rise.
  useEffect(() => {
    if (stage !== 'talk') return;
    const handle = setInterval(() => {
      const st = engine.getState();
      const now = engine.nowMs();
      const tense = st.expression ? st.expression.scores.fear + st.expression.scores.sad + st.expression.scores.angry : null;
      const score = activationScore(baselineRef.current, {
        pulse: st.pulse?.stable ? st.pulse.value : null,
        breathing: currentBreathing(),
        tenseExpression: tense,
        edaRise: edaRise(edaBaseRef.current, engine.getEda(6000).map((p) => p.v)),
      });
      setActivation(score);
      activationLog.current.push({ t: now, v: score });
      const event = detectorRef.current.update(score, now);
      if (event === 'spike' && !pausedRef.current) {
        const lastPartner = [...turnsRef.current].reverse().find((t) => t.role === 'partner');
        moments.current.push({ spikeAt: now, afterLine: lastPartner?.text ?? '', breaths: 0, recoveredAt: null });
        setPaused(true);
      } else if (event === 'recovered') {
        const open = [...moments.current].reverse().find((m) => m.recoveredAt === null);
        if (open) open.recoveredAt = now;
      }
    }, 1000);
    return () => clearInterval(handle);
  }, [stage]);

  const endRehearsal = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    const source = engine.getState().source ?? 'simulated';
    if (engine.getState().phase !== 'idle') await stopSession();
    const recoveries = moments.current.filter((m) => m.recoveredAt !== null).map((m) => ((m.recoveredAt as number) - m.spikeAt) / 1000);
    const userTurns = turnsRef.current.filter((t) => t.role === 'user').length;
    const data: Debrief = {
      scenario: `${scenario.title} (${difficulty.label})`,
      pauses: moments.current.length,
      averageRecoverySec: recoveries.length ? mean(recoveries) : null,
      peak: activationLog.current.reduce((m, p) => Math.max(m, p.v), 0),
      userTurns,
      activation: activationLog.current,
      moments: moments.current,
      tips: useAi ? null : scriptedDebrief({ pauses: moments.current.length, averageRecoverySec: recoveries.length ? mean(recoveries) : null, turns: userTurns }),
      source,
    };
    setDebrief(data);
    setStage('debrief');
    recordSession({
      tool: 'stage',
      durationSec: Math.round((activationLog.current.at(-1)?.t ?? 0) / 1000 - (activationLog.current[0]?.t ?? 0) / 1000),
      source,
      numbers: { pauses: data.pauses, averageRecoverySec: data.averageRecoverySec, peakActivation: data.peak, replies: userTurns },
    });
    if (useAi && window.myzennSense) {
      try {
        const { text } = await window.myzennSense.stageDebrief({
          scenario: data.scenario,
          turns: turnsRef.current,
          moments: data.moments.map((m) => `after "${m.afterLine.slice(0, 120)}"`).join('; '),
        });
        const tips = text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 4);
        setDebrief((d) => (d ? { ...d, tips } : d));
      } catch {
        setDebrief((d) =>
          d ? { ...d, tips: scriptedDebrief({ pauses: d.pauses, averageRecoverySec: d.averageRecoverySec, turns: d.userTurns }) } : d,
        );
      }
    }
  }, [scenario, difficulty, useAi]);

  // Camera stopped from the rail or auto-paused.
  useEffect(() => {
    if (s.phase !== 'idle' && s.phase !== 'error') return;
    if (stageRef.current === 'talk') void endRehearsal();
    else if (stageRef.current === 'settle') setStage('pick');
  }, [s.phase, endRehearsal]);

  useEffect(() => () => void stopSession(), []);

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || waiting || pausedRef.current || finished) return;
    const next: StageTurn[] = [...turnsRef.current, { role: 'user', text: clean }];
    setTurns(next);
    setDraft('');
    setWaiting(true);
    const reply = await partnerReply({ scenario, difficulty, turns: next, bodyState: activation >= 45 ? 'tense' : 'settled', useAi });
    if (reply.aiFailed) setAiNote('The AI partner could not be reached, so the built-in partner answered instead.');
    else if (reply.fellBack && reply.provider) setAiNote(`Groq did not answer, so ${PROVIDER_NAME[reply.provider]} (the fallback) replied.`);
    if (reply.provider) setLastProvider(reply.provider);
    const withReply: StageTurn[] = [...next, { role: 'partner', text: reply.text }];
    setTurns(withReply);
    setWaiting(false);
    // Practice mode: make the simulated body react to a tougher partner.
    simulator()?.stressor(difficulty.id === 'hard' ? 0.7 : difficulty.id === 'medium' ? 0.45 : 0.2);
    if (withReply.filter((t) => t.role === 'partner').length > MAX_PARTNER_TURNS) setFinished(true);
  };

  // ---- screens -------------------------------------------------------------
  if (stage === 'debrief' && debrief) {
    return <StageDebrief data={debrief} onAgain={() => setStage('pick')} />;
  }

  if (stage === 'pick') {
    return (
      <div className="flex flex-col gap-6">
        <SessionNotices error={s.error} stopReason={s.stopReason} />
        <StartGate
          title="MyStage Pulse"
          cardio
          face
          eda
          startLabel="Start rehearsal"
          onStarted={() => {
            settleStart.current = engine.nowMs();
            setSettleLeft(SETTLE_MS);
            setStage('settle');
          }}
          intro={
            <p>
              Rehearse a conversation that makes you nervous. Your camera notices when your heart starts racing, and your partner
              pauses so you can take three breaths before you answer. Afterwards you'll see how quickly you came back down.
            </p>
          }
        >
          <fieldset className="mt-8">
            <legend className="text-sm font-medium">Choose a scenario</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {stageScenarios.map((sc) => {
                const Icon = sc.icon;
                const selected = sc.id === scenarioId;
                return (
                  <button
                    key={sc.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setScenarioId(sc.id)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                      selected ? 'border-primary/60 bg-primary/10' : 'border-white/10 hover:border-white/25',
                    )}
                  >
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', sc.textColor)} />
                    <span>
                      <span className="block text-sm font-medium">{sc.title}</span>
                      <span className="block text-xs text-muted-foreground">{sc.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="mt-6">
            <legend className="text-sm font-medium">How tough should your partner be?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {scenario.difficulties.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={d.id === difficultyId}
                  onClick={() => setDifficultyId(d.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    d.id === difficultyId ? 'border-primary/60 bg-primary/10' : 'border-white/10 text-muted-foreground hover:border-white/25',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{difficulty.description}</p>
          </fieldset>
          <p className="mt-6 text-xs text-muted-foreground">
            {useAi
              ? `AI partner is on: your typed replies and a one-word state ("settled" or "tense") go to ${aiRoute(aiProviders)}.`
              : 'Built-in partner: works offline, no AI service is contacted. You can turn on an AI partner in Privacy & settings.'}
          </p>
        </StartGate>
      </div>
    );
  }

  if (stage === 'settle') {
    const seconds = Math.ceil(settleLeft / 1000);
    return (
      <div className="flex flex-col gap-6 lg:flex-row">
        <section className="flex min-h-[520px] flex-1 flex-col items-center justify-center rounded-3xl border border-white/5 bg-black/20 p-10 text-center">
          <p className="text-sm text-muted-foreground">{scenario.title}</p>
          <h2 className="mt-2 text-3xl font-semibold">Settle in first</h2>
          <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">
            Sit comfortably and breathe normally. We're learning your resting rhythm so the rehearsal can compare against you, not
            against anyone else.
          </p>
          <p className="mt-8 font-display text-6xl font-light tabular text-breath" aria-live="polite">
            {seconds > 0 ? seconds : '...'}
          </p>
          {seconds === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {waitingForSkin ? 'Waiting for your skin response to settle (it starts after about 35 seconds).' : 'Waiting for a steady reading.'}
            </p>
          )}
        </section>
        <CameraRail />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <section className="relative flex min-h-[560px] flex-1 flex-col rounded-3xl border border-white/5 bg-black/20">
        <header className="flex items-center justify-between gap-4 border-b border-white/5 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{scenario.title}</h2>
            <p className="text-xs text-muted-foreground">
              {difficulty.label} partner
              {useAi ? `, AI (${lastProvider ? PROVIDER_NAME[lastProvider] : PROVIDER_NAME[aiProviders[0]]})` : ', built-in'}
            </p>
          </div>
          <Button variant="quiet" size="sm" onClick={() => void endRehearsal()}>
            End rehearsal
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6" style={{ maxHeight: 460 }}>
          {aiNote && <Notice>{aiNote}</Notice>}
          <SessionNotices error={s.error} stopReason={null} />
          {turns.map((t, i) => (
            <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
              <p
                className={cn(
                  'max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                  t.role === 'user' ? 'rounded-br-md bg-primary/15 text-foreground' : 'glass rounded-bl-md',
                )}
              >
                {t.text}
              </p>
            </div>
          ))}
          {waiting && <p className="text-sm text-muted-foreground">Your partner is replying...</p>}
          {finished && (
            <div className="flex flex-col items-start gap-3 pt-2">
              <p className="text-sm text-muted-foreground">That's the end of this rehearsal.</p>
              <Button onClick={() => void endRehearsal()}>See how it went</Button>
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        {!finished && (
          <div className="border-t border-white/5 px-6 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={waiting || paused}
                  onClick={() => void send(q)}
                  className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <label htmlFor="stage-reply" className="sr-only">
                Your reply
              </label>
              <input
                id="stage-reply"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={waiting || paused}
                placeholder="Type what you would say..."
                autoComplete="off"
                className="h-11 flex-1 rounded-xl border border-white/10 bg-secondary px-4 text-sm outline-none focus:border-primary/50"
              />
              <Button type="submit" disabled={waiting || paused || !draft.trim()} aria-label="Send reply">
                <Send className="h-4 w-4" aria-hidden />
              </Button>
            </form>
          </div>
        )}

        {paused && (
          <BreathPause
            onDone={(breaths) => {
              const open = moments.current[moments.current.length - 1];
              if (open) open.breaths = breaths;
              setPaused(false);
            }}
          />
        )}
      </section>
      <CameraRail>
        <ActivationMeter value={activation} baseline={baselineRef.current} withSkin={edaBaseRef.current !== null} />
        {s.source === 'simulated' && (
          <Button variant="quiet" size="sm" onClick={() => simulator()?.stressor(0.8)}>
            Simulate a racing heart
          </Button>
        )}
      </CameraRail>
    </div>
  );
}

function StageDebrief({ data, onAgain }: { data: Debrief; onAgain: () => void }) {
  const t0 = data.activation[0]?.t ?? 0;
  return (
    <div className="mx-auto max-w-2xl animate-fade-in-up">
      <h1 className="text-3xl font-semibold tracking-tight">How your body handled it</h1>
      <p className="mt-2 text-muted-foreground">
        {data.scenario}
        {data.source === 'simulated' ? ', practice mode with simulated signals' : ''}.
      </p>

      <dl className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <div className="bg-background px-5 py-4">
          <dt className="text-xs text-muted-foreground">Breathing pauses</dt>
          <dd className="mt-1 font-display text-3xl tabular text-breath">{data.pauses}</dd>
        </div>
        <div className="bg-background px-5 py-4">
          <dt className="text-xs text-muted-foreground">Time to settle again</dt>
          <dd className="mt-1 font-display text-3xl tabular">
            {data.averageRecoverySec === null ? 'n/a' : `${Math.round(data.averageRecoverySec)} s`}
          </dd>
        </div>
        <div className="bg-background px-5 py-4">
          <dt className="text-xs text-muted-foreground">Highest activation</dt>
          <dd className="mt-1 font-display text-3xl tabular text-heart">{data.peak}</dd>
        </div>
      </dl>

      {data.activation.length > 2 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Body activation through the conversation</h2>
          <PathChart series={[{ label: 'Activation', points: data.activation.map((p) => ({ t: p.t - t0, v: p.v })), color: 'hsl(351 92% 72%)' }]} />
        </div>
      )}

      {data.moments.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-muted-foreground">When your partner paused</h2>
          <ul className="mt-3 space-y-3">
            {data.moments.map((m, i) => (
              <li key={i} className="text-sm leading-relaxed">
                After "{m.afterLine.length > 140 ? `${m.afterLine.slice(0, 140)}...` : m.afterLine}"
                <span className="block text-xs text-muted-foreground">
                  {m.breaths} breath{m.breaths === 1 ? '' : 's'} counted
                  {m.recoveredAt !== null ? `, settled again after ${Math.round((m.recoveredAt - m.spikeAt) / 1000)} s` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">Notes for next time</h2>
        {data.tips === null ? (
          <p className="mt-3 text-sm text-muted-foreground">Writing your notes...</p>
        ) : (
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {data.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        Activation compares your heart rate, breathing and expression with your own resting rhythm from the start of this
        session. It is a reflection tool, not a measure of anxiety or of any health condition.
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={onAgain}>Rehearse again</Button>
        <Button variant="quiet" onClick={() => (window.location.hash = '')}>
          Back to Sanctuary
        </Button>
      </div>
    </div>
  );
}
