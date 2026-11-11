import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { Home } from '@/pages/Home';
import { Privacy } from '@/pages/Privacy';
import { BreathLive } from '@/tools/breath-live/BreathLive';
import { Heartsong } from '@/tools/heartsong/Heartsong';
import { StagePulse } from '@/tools/stage-pulse/StagePulse';
import { useSenseState } from '@/sense/session';
import { cn } from '@/lib/cn';

type Route = 'home' | 'breath' | 'heartsong' | 'stage' | 'privacy';

function routeFromHash(): Route {
  const r = window.location.hash.replace(/^#\/?/, '');
  return (['breath', 'heartsong', 'stage', 'privacy'] as const).includes(r as never) ? (r as Route) : 'home';
}

const NAV: { route: Route; label: string }[] = [
  { route: 'breath', label: 'MyBreath Live' },
  { route: 'heartsong', label: 'Heartsong' },
  { route: 'stage', label: 'MyStage Pulse' },
];

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const s = useSenseState();
  const live = s.phase === 'running' || s.phase === 'starting';

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
          <a href="#/" className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold">MyZenn</span>
            <span className="font-display text-lg font-light text-primary">Sense</span>
          </a>
          <nav className="flex gap-1" aria-label="Tools">
            {NAV.map((n) => (
              <a
                key={n.route}
                href={`#/${n.route}`}
                aria-current={route === n.route ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  route === n.route ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            {live && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <span className={cn('h-2 w-2 rounded-full', s.source === 'simulated' ? 'bg-amber-300' : 'animate-pulse bg-red-500')} />
                {s.source === 'simulated' ? 'Simulated signals' : 'Camera on'}
              </span>
            )}
            <a
              href="#/privacy"
              className={cn('flex items-center gap-1.5 text-sm', route === 'privacy' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <Shield className="h-4 w-4" aria-hidden />
              Privacy &amp; settings
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">
        {route === 'home' && <Home />}
        {route === 'breath' && <BreathLive />}
        {route === 'heartsong' && <Heartsong />}
        {route === 'stage' && <StagePulse />}
        {route === 'privacy' && <Privacy />}
      </main>

      <footer className="mx-auto w-full max-w-7xl px-6 pb-6 text-xs text-muted-foreground/70">
        Wellness practice, not a medical device. Camera signals by the Presage SmartSpectra SDK, processed on this computer.
      </footer>
    </div>
  );
}
