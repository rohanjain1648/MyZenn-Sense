import { useRef, useState, type ReactNode } from 'react';
import { Camera, Gauge } from 'lucide-react';
import type { ReadinessResult } from '@/env';
import { cn } from '@/lib/cn';
import { hasConsent, useSettings } from '@/privacy/settings';
import { checkReadiness, plannedSource, startSession, useAppConfig } from '@/sense/session';
import { Button } from './Button';
import { CameraPicker } from './CameraPicker';
import { ConsentScreen } from './ConsentScreen';
import { Notice } from './Notice';

interface StartGateProps {
  title: string;
  intro: ReactNode;
  /** Which signal groups this tool asks the SDK for. */
  cardio: boolean;
  face: boolean;
  /** EDA proxy (skin-response estimate). */
  eda?: boolean;
  startLabel?: string;
  /** Runs synchronously inside the click (e.g. to unlock audio). */
  onBeforeStart?: () => void;
  onStarted?: () => void;
  children?: ReactNode;
}

const VERDICT_TEXT: Record<ReadinessResult['verdict'], { title: string; tone: string }> = {
  ready: { title: 'Your setup is ready.', tone: 'text-emerald-300' },
  limited: { title: 'Your computer may struggle to keep up.', tone: 'text-amber-200' },
  blocked: { title: 'Something is blocking the camera check.', tone: 'text-amber-200' },
  inconclusive: { title: "The check couldn't finish.", tone: 'text-muted-foreground' },
};

type Pending = 'start' | 'check' | null;

/** The intro panel every tool shows before the camera starts. Handles consent. */
export function StartGate({ title, intro, cardio, face, eda = false, startLabel = 'Start camera', onBeforeStart, onStarted, children }: StartGateProps) {
  useSettings();
  const config = useAppConfig();
  const [askConsent, setAskConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const pending = useRef<Pending>(null);
  const planned = plannedSource(config);

  // Read the live settings, not a render's copy: these also run right after
  // the consent screen saves the user's agreement.
  const begin = async () => {
    if (!hasConsent()) {
      pending.current = 'start';
      setAskConsent(true);
      return;
    }
    onBeforeStart?.();
    setStarting(true);
    try {
      await startSession({ cardio, face, eda });
      onStarted?.();
    } finally {
      setStarting(false);
    }
  };

  const check = async () => {
    if (!hasConsent()) {
      pending.current = 'check';
      setAskConsent(true);
      return;
    }
    setChecking(true);
    setReadiness(null);
    try {
      setReadiness(await checkReadiness({ cardio, face, eda }));
    } finally {
      setChecking(false);
    }
  };

  if (askConsent) {
    return (
      <ConsentScreen
        onAccepted={() => {
          setAskConsent(false);
          const next = pending.current;
          pending.current = null;
          if (next === 'check') void check();
          else void begin();
        }}
        onCancel={() => setAskConsent(false)}
      />
    );
  }

  const verdict = readiness ? VERDICT_TEXT[readiness.verdict] ?? VERDICT_TEXT.inconclusive : null;

  return (
    <div className="max-w-xl animate-fade-in-up">
      <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-4 space-y-3 leading-relaxed text-muted-foreground">{intro}</div>
      {children}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => void begin()} disabled={starting || checking || config === undefined}>
          <Camera className="h-4 w-4" aria-hidden />
          {starting ? 'Starting...' : planned.kind === 'simulated' ? `${startLabel} (practice)` : startLabel}
        </Button>
        {planned.kind === 'presage' && (
          <Button variant="outline" size="lg" onClick={() => void check()} disabled={starting || checking}>
            <Gauge className="h-4 w-4" aria-hidden />
            {checking ? 'Checking...' : 'Check my setup'}
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Sit still in soft, even light, with your face and chest in view.</p>
      {planned.kind === 'presage' && <CameraPicker compact />}

      {checking && (
        <p role="status" className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
          Camera on: checking whether this camera and computer can keep up. No measurement is taken.
        </p>
      )}
      {readiness && verdict && (
        <div role="status" className="mt-5 rounded-xl border border-white/10 px-4 py-3 text-sm leading-relaxed">
          <p className={cn('font-medium', verdict.tone)}>{verdict.title}</p>
          {readiness.reason && <p className="mt-1 text-muted-foreground">{readiness.reason}</p>}
        </div>
      )}
      {planned.reason && <Notice className="mt-6">{planned.reason}</Notice>}
    </div>
  );
}
