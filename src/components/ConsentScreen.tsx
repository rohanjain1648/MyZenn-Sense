import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { CONSENT_VERSION, updateSettings } from '@/privacy/settings';
import { Button } from './Button';

const DOES = [
  'Uses your camera only while a tool is open and you have pressed its Start button (or Check my setup).',
  'Reads breathing, heart rate, heart rhythm, blinks, talking, facial expression and (in MyStage Pulse) a skin-response estimate from the video, on this computer.',
  'Shows a red "Camera on" light whenever it is measuring. Stop camera turns it off instantly.',
  'With heart signals on, the Presage SDK also sends pulse, heart-rhythm and breathing-rate numbers (never video) to Presage, whose AI writes wellness check-ins. This is built into the SDK. MyBreath Live can also ask Presage for one short AI reflection when you finish. You can turn either off in Privacy & settings.',
];

const DOES_NOT = [
  'Record, save or upload video or images.',
  'Keep your readings. They stay in this app\'s memory and are gone when you stop.',
  'Diagnose, treat or monitor any health condition. This is a wellness practice tool.',
  'Watch anyone in the background, or measure anyone who has not agreed.',
];

export function ConsentScreen({ onAccepted, onCancel }: { onAccepted: () => void; onCancel?: () => void }) {
  const [agreed, setAgreed] = useState(false);

  const accept = () => {
    updateSettings({ consentAcceptedAt: new Date().toISOString(), consentVersion: CONSENT_VERSION });
    onAccepted();
  };

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in-up py-6">
      <h1 className="text-3xl font-semibold tracking-tight">Before we use your camera</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        MyZenn Sense reads gentle body signals from your camera so its breathing, music and rehearsal tools can respond to you.
        Here is exactly what that means.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="text-base font-medium text-breath">What it does</h2>
          <ul className="mt-3 space-y-3">
            {DOES.map((line) => (
              <li key={line} className="flex gap-3 text-sm leading-relaxed">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-breath" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="text-base font-medium text-heart">What it never does</h2>
          <ul className="mt-3 space-y-3">
            {DOES_NOT.map((line) => (
              <li key={line} className="flex gap-3 text-sm leading-relaxed">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-heart" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-8 rounded-xl border border-white/10 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        Readings are for general wellness only. They are not medical measurements and have not been cleared by the FDA. If you
        feel unwell, stop and breathe normally. Saving session history and the AI rehearsal partner are both off until you turn
        them on in Privacy &amp; settings, where you can also withdraw consent and delete everything.
      </p>

      <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
        />
        I'm the only person in view, and I agree to MyZenn Sense using my camera as described above.
      </label>

      <div className="mt-6 flex gap-3">
        <Button disabled={!agreed} onClick={accept}>
          Agree and continue
        </Button>
        {onCancel && (
          <Button variant="quiet" onClick={onCancel}>
            Not now
          </Button>
        )}
      </div>
    </div>
  );
}
