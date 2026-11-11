import { useEffect, useRef, type ReactNode } from 'react';
import { CameraOff, Circle, Square } from 'lucide-react';
import { cn, formatClock } from '@/lib/cn';
import { WARMUP_MS } from '@/sense/guidance';
import { engine, stopSession, useSenseState } from '@/sense/session';
import { useSettings } from '@/privacy/settings';
import { Button } from './Button';

function warmupLeft(elapsedMs: number, windowMs: number) {
  return Math.max(0, Math.ceil((windowMs - elapsedMs) / 1000));
}

interface ReadoutProps {
  label: string;
  value: string | null;
  unit?: string;
  colorClass: string;
  waitingText: string;
  unavailable?: boolean;
}

function Readout({ label, value, unit, colorClass, waitingText, unavailable }: ReadoutProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {unavailable ? (
        <span className="text-xs text-muted-foreground/70">not on this key</span>
      ) : value === null ? (
        <span className="text-xs text-muted-foreground/80">{waitingText}</span>
      ) : (
        <span className={cn('font-display text-xl tabular', colorClass)}>
          {value}
          {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * The EDA proxy has arbitrary units, so show only its direction: the last 5 s
 * against the 20 s before, measured in that window's own spread.
 */
function skinTrend(): string | null {
  const points = engine.getEda(25_000);
  if (points.length < 8) return null;
  const end = points[points.length - 1].t;
  const recent = points.filter((p) => p.t > end - 5000).map((p) => p.v);
  const before = points.filter((p) => p.t <= end - 5000).map((p) => p.v);
  if (recent.length < 2 || before.length < 4) return 'steady';
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mean = avg(before);
  const sd = Math.sqrt(avg(before.map((v) => (v - mean) ** 2)));
  const z = (avg(recent) - mean) / Math.max(sd, Math.abs(mean) * 0.01, 1e-6);
  return z > 1.5 ? 'rising' : z < -1.5 ? 'easing' : 'steady';
}

const EXPRESSION_WORD: Record<string, string> = {
  neutral: 'neutral',
  happy: 'smiling',
  surprise: 'surprised',
  sad: 'downcast',
  fear: 'tense',
  angry: 'frowning',
  contempt: 'smirking',
  disgust: 'wrinkled',
};

/** Right-hand rail: self-view, live guidance, readouts, and a clear way to stop. */
export function CameraRail({ children }: { children?: ReactNode }) {
  const s = useSenseState();
  const settings = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const live = s.phase === 'running' || s.phase === 'starting';
  const simulated = s.source === 'simulated';

  useEffect(() => {
    const video = videoRef.current;
    const stream = engine.getStream();
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) video.play().catch(() => {});
    }
  });

  const e = s.elapsedMs;
  const br = s.breathingRate;
  const pulse = s.pulse;
  const hrv = s.hrv;
  // Hide signals this tool did not ask for; say so plainly when the key lacks them.
  const cardioDenied = s.deniedSignals.includes('cardio');
  const edaDenied = s.deniedSignals.includes('eda');
  const showCardio = !live || s.capabilities.cardio || cardioDenied;
  const showFace = !live || s.capabilities.face;
  const showEda = live && (s.capabilities.eda || edaDenied);
  const skin = showEda && !edaDenied ? skinTrend() : null;

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-[300px] lg:shrink-0">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        {settings.showPreview && !simulated && live ? (
          <video ref={videoRef} className="mirror h-full w-full object-cover" autoPlay playsInline muted />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
            <CameraOff className="h-5 w-5 opacity-60" aria-hidden />
            {simulated && live
              ? 'Practice mode: simulated signals, camera off.'
              : live
                ? 'Self-view hidden. The camera is still measuring.'
                : 'Camera off.'}
          </div>
        )}
        {live && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
            <Circle className={cn('h-2 w-2', simulated ? 'fill-amber-300 text-amber-300' : 'fill-red-500 text-red-500')} aria-hidden />
            {simulated ? 'Simulated' : 'Camera on'}
            <span className="tabular text-white/70">{formatClock(e)}</span>
          </div>
        )}
        {live && s.talking && (
          <div role="status" className="absolute inset-x-3 bottom-3 rounded-xl bg-white/10 px-3 py-2 text-xs leading-snug text-white/85 backdrop-blur">
            You're talking. Breathing readings pause until you're quiet.
          </div>
        )}
        {live && !s.talking && s.guidance && (
          <div
            role="status"
            className={cn(
              'absolute inset-x-3 bottom-3 rounded-xl px-3 py-2 text-xs leading-snug backdrop-blur',
              s.guidance.severity === 'ok' && 'bg-emerald-500/15 text-emerald-200',
              s.guidance.severity === 'tuning' && 'bg-white/10 text-white/80',
              s.guidance.severity === 'fix' && 'bg-amber-500/20 text-amber-100',
            )}
          >
            {s.guidance.message}
          </div>
        )}
      </div>

      <div className="divide-y divide-white/5 rounded-2xl border border-white/10 px-4 py-1">
        <Readout
          label="Breathing"
          value={br ? br.value.toFixed(1) : null}
          unit="/ min"
          colorClass="text-breath"
          waitingText={live ? `tuning in, ${warmupLeft(e, WARMUP_MS.breathing)} s` : 'waiting'}
        />
        {showCardio && (
          <>
            <Readout
              label="Heart rate"
              value={pulse ? pulse.value.toFixed(0) : null}
              unit="bpm"
              colorClass="text-heart"
              unavailable={cardioDenied}
              waitingText={live ? `tuning in, ${warmupLeft(e, WARMUP_MS.pulse)} s` : 'waiting'}
            />
            <Readout
              label="Heart rhythm (RMSSD)"
              value={hrv && hrv.confidence > 0 ? hrv.rmssd.toFixed(0) : null}
              unit="ms"
              colorClass="text-heart"
              unavailable={cardioDenied}
              waitingText={live ? `needs 1 min, ${warmupLeft(e, WARMUP_MS.hrv)} s` : 'waiting'}
            />
          </>
        )}
        {showFace && (
          <Readout
            label="Expression"
            value={s.expression ? EXPRESSION_WORD[s.expression.top] : null}
            colorClass="text-smile text-base"
            waitingText={live ? 'reading' : 'waiting'}
          />
        )}
        {showEda && (
          <Readout
            label="Skin response (EDA)"
            value={skin}
            colorClass="text-bell text-base"
            unavailable={edaDenied}
            waitingText={`starts after ~35 s, ${warmupLeft(e, 36_000)} s`}
          />
        )}
      </div>

      {children}

      {live && (
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => void stopSession()}>
            <Square className="h-3.5 w-3.5" aria-hidden />
            Stop camera
          </Button>
          {!simulated && (
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Video stays on this computer. Auto-pauses at {settings.sessionCapMin} min to save credits.
              {s.capabilities.cardio && (
                <>
                  {' '}
                  With heart signals on, the SDK shares pulse, HRV and breathing-rate numbers with Presage's AI check-ins
                  {s.insightsReceived > 0 ? ` (${s.insightsReceived} so far)` : ''}.{' '}
                  <a href="#/privacy" className="underline underline-offset-2 hover:text-foreground">
                    Details
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
