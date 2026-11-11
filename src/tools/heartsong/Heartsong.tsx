import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { CameraRail } from '@/components/CameraRail';
import { SessionNotices } from '@/components/Notice';
import { StartGate } from '@/components/StartGate';
import { recordSession } from '@/privacy/history';
import { engine, simulator, stopSession, useSenseState } from '@/sense/session';
import { HeartsongPlayer, type NoteSource, type PlayedNote } from './player';

const COLORS: Record<NoteSource, [number, number, number]> = {
  heart: [251, 113, 133],
  breath: [45, 214, 196],
  blink: [246, 200, 110],
  smile: [252, 165, 120],
  calm: [167, 139, 250],
  key: [226, 232, 240],
};

interface Ripple {
  x: number;
  y: number;
  born: number;
  size: number;
  color: [number, number, number];
}

interface SongSummary {
  minutes: number;
  counts: Record<NoteSource, number>;
  source: 'presage' | 'simulated';
}

function HeartsongStage({ player }: { player: HeartsongPlayer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ripples: Ripple[] = [];
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    player.onNote = (note: PlayedNote) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h);
      let x = cx;
      let y = cy;
      let size = R * 0.35;
      if (note.source === 'breath' || note.source === 'key') {
        const angle = (note.degree / 10) * Math.PI * 2 - Math.PI / 2;
        x = cx + Math.cos(angle) * R * 0.27;
        y = cy + Math.sin(angle) * R * 0.27;
        size = R * 0.22;
      } else if (note.source === 'blink' || note.source === 'smile') {
        const angle = Math.random() * Math.PI * 2;
        x = cx + Math.cos(angle) * R * 0.38;
        y = cy + Math.sin(angle) * R * 0.38;
        size = R * 0.1;
      } else if (note.source === 'calm') {
        size = R * 0.6;
      }
      ripples.push({ x, y, born: performance.now(), size, color: COLORS[note.source] });
      if (ripples.length > 80) ripples.shift();
    };

    const draw = (now: number) => {
      player.update(now);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // The breath at the centre.
      const R = Math.min(w, h);
      const core = R * (0.08 + 0.07 * player.breathLevel);
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, core * 2.2);
      grad.addColorStop(0, `rgba(45,214,196,${0.35 + 0.25 * player.breathLevel})`);
      grad.addColorStop(1, 'rgba(45,214,196,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, core * 2.2, 0, Math.PI * 2);
      ctx.fill();

      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const age = (now - r.born) / 2600;
        if (age >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const [cr, cg, cb] = r.color;
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(1 - age) * 0.7})`;
        ctx.lineWidth = 2 * (1 - age) + 0.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 6 + r.size * Math.sqrt(age), 0, Math.PI * 2);
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      player.onNote = null;
    };
  }, [player]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden />;
}

function Legend({ player }: { player: HeartsongPlayer }) {
  const s = useSenseState();
  const [, force] = useState(0);
  useEffect(() => {
    const h = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(h);
  }, []);
  const rows: { color: string; text: string; count: number }[] = [
    {
      color: 'bg-heart',
      text: s.pulse ? `Heartbeat keeps time at ${s.pulse.value.toFixed(0)} bpm` : s.capabilities.cardio ? 'Heartbeat tuning in...' : 'Heartbeat not on this key',
      count: player.counts.heart,
    },
    { color: 'bg-breath', text: 'Each breath plays a note and swells the drone', count: player.counts.breath },
    { color: 'bg-bell', text: 'Blinks ring the high bells', count: player.counts.blink },
    { color: 'bg-smile', text: player.bright ? 'Smiling: the key is bright' : 'Smile to brighten the key', count: player.counts.smile },
  ];
  return (
    <ul className="space-y-2 text-sm" aria-label="What your body is playing">
      {rows.map((r) => (
        <li key={r.text.slice(0, 12)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${r.color}`} aria-hidden />
            {r.text}
          </span>
          <span className="tabular text-xs text-muted-foreground/80">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function Heartsong() {
  const s = useSenseState();
  const playerRef = useRef<HeartsongPlayer | null>(null);
  if (!playerRef.current) playerRef.current = new HeartsongPlayer();
  const player = playerRef.current;
  const [playing, setPlaying] = useState(false);
  const [summary, setSummary] = useState<SongSummary | null>(null);
  const startedAt = useRef(0);
  const playingRef = useRef(false);
  playingRef.current = playing;

  const end = async () => {
    if (!playingRef.current) return;
    playingRef.current = false;
    player.stop();
    const source = engine.getState().source ?? 'simulated';
    if (engine.getState().phase !== 'idle') await stopSession();
    const minutes = (performance.now() - startedAt.current) / 60_000;
    const counts = { ...player.counts };
    setSummary({ minutes, counts, source });
    setPlaying(false);
    recordSession({ tool: 'heartsong', durationSec: Math.round(minutes * 60), source, numbers: { ...counts } });
  };

  // Camera stopped from the rail or auto-paused.
  useEffect(() => {
    if ((s.phase === 'idle' || s.phase === 'error') && playingRef.current) void end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase]);

  // Keyboard duet.
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      if (player.key(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, player]);

  useEffect(
    () => () => {
      player.dispose();
      void stopSession();
    },
    [player],
  );

  if (!playing && summary) {
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    return (
      <div className="mx-auto max-w-2xl animate-fade-in-up">
        <h1 className="text-3xl font-semibold tracking-tight">Your body played {total} notes</h1>
        <p className="mt-2 text-muted-foreground">
          {summary.minutes.toFixed(1)} minutes of Heartsong{summary.source === 'simulated' ? ' in practice mode' : ''}. Nothing was
          recorded. The song existed only while you played it.
        </p>
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:grid-cols-3">
          {(
            [
              ['Heartbeats', summary.counts.heart, 'text-heart'],
              ['Breath notes', summary.counts.breath, 'text-breath'],
              ['Blink bells', summary.counts.blink, 'text-bell'],
              ['Smile sparkles', summary.counts.smile, 'text-smile'],
              ['Calm chords', summary.counts.calm, 'text-violet-300'],
              ['Your keys', summary.counts.key, 'text-foreground'],
            ] as const
          ).map(([label, value, color]) => (
            <div key={label} className="bg-background px-5 py-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className={`mt-1 font-display text-3xl tabular ${color}`}>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex gap-3">
          <Button onClick={() => setSummary(null)}>Play again</Button>
          <Button variant="quiet" onClick={() => (window.location.hash = '')}>
            Back to Sanctuary
          </Button>
        </div>
      </div>
    );
  }

  if (!playing) {
    return (
      <div className="flex flex-col gap-6">
        <SessionNotices error={s.error} stopReason={s.stopReason} />
        <StartGate
          title="Heartsong"
          cardio
          face
          startLabel="Start playing"
          onBeforeStart={() => player.unlock()}
          onStarted={() => {
            startedAt.current = performance.now();
            player.start();
            setPlaying(true);
          }}
          intro={
            <>
              <p>An instrument with no wrong notes, played by you without lifting a finger.</p>
              <p>
                Your heartbeat keeps the tempo. Your breathing swells a low drone and adds a note with every breath. Blinks ring
                high bells, and a smile shifts the music into a brighter key. Slow down and the song settles into a resolving
                chord. Use headphones if you can, and play along on the A to ; keys.
              </p>
            </>
          }
        />
      </div>
    );
  }

  const sim = s.source === 'simulated' ? simulator() : null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <section className="relative flex min-h-[520px] flex-1 flex-col rounded-3xl border border-white/5 bg-black/20">
        <div className="absolute inset-0">
          <HeartsongStage player={player} />
        </div>
        <div className="relative flex items-start justify-between gap-4 p-6">
          <div className="max-w-xs">
            <SessionNotices error={s.error} stopReason={null} />
          </div>
          <Button variant="quiet" size="sm" onClick={() => void end()}>
            End song
          </Button>
        </div>
        <div className="relative mt-auto p-6">
          <Legend player={player} />
          <p className="mt-4 text-xs text-muted-foreground/70">Play along: A S D F G H J K L ;</p>
        </div>
      </section>
      <CameraRail>
        {sim && (
          <div className="flex gap-2">
            <Button variant="quiet" size="sm" className="flex-1" onClick={() => sim.smile()}>
              Simulate smile
            </Button>
            <Button variant="quiet" size="sm" className="flex-1" onClick={() => sim.setFollowTarget(() => 6)}>
              Simulate calm
            </Button>
          </div>
        )}
      </CameraRail>
    </div>
  );
}
