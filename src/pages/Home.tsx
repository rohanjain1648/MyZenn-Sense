import { Lock } from 'lucide-react';
import { useSettings } from '@/privacy/settings';
import { plannedSource, useAppConfig } from '@/sense/session';
import { Notice } from '@/components/Notice';

interface Tool {
  route: string;
  title: string;
  line: string;
  signals: { label: string; color: string }[];
  image: string;
}

const TOOLS: Tool[] = [
  {
    route: '#/breath',
    title: 'MyBreath Live',
    line: 'A breathing guide that starts at your pace, then slows only as fast as you can follow.',
    signals: [
      { label: 'breathing', color: 'bg-breath' },
      { label: 'chest movement', color: 'bg-breath' },
      { label: 'heart rate', color: 'bg-heart' },
      { label: 'HRV', color: 'bg-heart' },
    ],
    image: './assets/mybreath.png',
  },
  {
    route: '#/heartsong',
    title: 'Heartsong',
    line: 'An instrument your body plays. Your heartbeat keeps time, your breath swells the sound, your blinks ring bells.',
    signals: [
      { label: 'heart rate', color: 'bg-heart' },
      { label: 'breath', color: 'bg-breath' },
      { label: 'blinks', color: 'bg-bell' },
      { label: 'smiles', color: 'bg-smile' },
    ],
    image: './assets/mychimes.png',
  },
  {
    route: '#/stage',
    title: 'MyStage Pulse',
    line: 'Rehearse a hard conversation. When your heart races, your partner pauses so you can take three breaths first.',
    signals: [
      { label: 'heart rate', color: 'bg-heart' },
      { label: 'breathing', color: 'bg-breath' },
      { label: 'expression', color: 'bg-smile' },
    ],
    image: './assets/mystage.png',
  },
];

export function Home() {
  const config = useAppConfig();
  useSettings();
  const planned = plannedSource(config);

  return (
    <div className="animate-fade-in-up">
      <header className="max-w-2xl">
        <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">Sanctuary tools that listen to your body.</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          Your camera reads your breathing, heartbeat and expression, quietly and on this computer, so each tool can respond to
          how you actually are right now.
        </p>
      </header>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {TOOLS.map((tool) => (
          <a
            key={tool.route}
            href={tool.route}
            className="group flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-card/60 transition-colors hover:border-primary/40"
          >
            <div className="aspect-[16/10] overflow-hidden bg-black/30">
              <img src={tool.image} alt="" className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h2 className="text-xl font-semibold">{tool.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{tool.line}</p>
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Signals used">
                {tool.signals.map((sig) => (
                  <li key={sig.label} className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${sig.color}`} aria-hidden />
                    {sig.label}
                  </li>
                ))}
              </ul>
            </div>
          </a>
        ))}
      </div>

      <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-start">
        <p className="flex max-w-2xl gap-3 text-sm leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>
            No video is recorded, saved or uploaded, and the app keeps no readings after you stop. With heart signals on, the
            Presage SDK shares pulse, HRV and breathing-rate numbers with Presage's AI check-ins. It's a wellness practice, not a
            medical device.{' '}
            <a href="#/privacy" className="text-primary underline-offset-4 hover:underline">
              How your data is handled
            </a>
          </span>
        </p>
      </div>
      {planned.reason && <Notice className="mt-6 max-w-2xl">{planned.reason}</Notice>}
    </div>
  );
}
