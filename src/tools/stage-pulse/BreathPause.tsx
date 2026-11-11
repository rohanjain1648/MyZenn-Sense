import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/Button';
import { engine } from '@/sense/session';
import { detectBreaths } from '@/sense/signalMath';

const BREATHS_NEEDED = 3;
const ALLOW_CONTINUE_AFTER_MS = 45_000;

/**
 * The partner pauses; the user takes three slow breaths. Breaths are counted
 * from the real chest-movement trace, not a timer.
 */
export function BreathPause({ onDone }: { onDone: (breaths: number) => void }) {
  const [startedAt] = useState(() => engine.nowMs());
  const [breaths, setBreaths] = useState(0);
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    const handle = setInterval(() => {
      const since = engine.nowMs() - startedAt;
      setWaited(since);
      const peaks = detectBreaths(engine.getChest(since + 8000)).filter((t) => t > startedAt + 1500);
      setBreaths(Math.min(BREATHS_NEEDED, peaks.length));
    }, 400);
    return () => clearInterval(handle);
  }, [startedAt]);

  const done = breaths >= BREATHS_NEEDED;
  const canContinue = done || waited > ALLOW_CONTINUE_AFTER_MS;

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl bg-background/90 p-8 text-center backdrop-blur-sm" role="dialog" aria-label="Breathing pause">
      <p className="text-sm text-heart">Your heart sped up, so your partner is pausing.</p>
      <h2 className="mt-2 text-3xl font-semibold">Take three slow breaths before you answer</h2>

      <motion.div
        className="my-10 h-36 w-36 rounded-full bg-breath/25 ring-1 ring-breath/50"
        animate={{ scale: [0.7, 1.15, 0.7] }}
        transition={{ duration: 10, times: [0, 0.4, 1], repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />

      <div className="flex gap-3" aria-live="polite" aria-label={`${breaths} of ${BREATHS_NEEDED} breaths`}>
        {Array.from({ length: BREATHS_NEEDED }, (_, i) => (
          <span key={i} className={`h-3 w-3 rounded-full transition-colors ${i < breaths ? 'bg-breath' : 'bg-white/15'}`} />
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {done ? 'Three breaths. Ready when you are.' : 'In for four, out for six. Breaths are counted from your chest movement.'}
      </p>

      <div className="mt-8 flex gap-3">
        <Button disabled={!canContinue} onClick={() => onDone(breaths)}>
          Back to the conversation
        </Button>
        {!canContinue && (
          <Button variant="quiet" onClick={() => onDone(breaths)}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}
