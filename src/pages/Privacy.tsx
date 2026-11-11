import { useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { deleteAllData, clearHistory, useHistory } from '@/privacy/history';
import { hasConsent, updateSettings, useSettings } from '@/privacy/settings';
import { useAppConfig } from '@/sense/session';
import { aiRoute } from '@/lib/ai';
import { CameraPicker } from '@/components/CameraPicker';

function Toggle({ label, detail, checked, onChange, disabled }: { label: string; detail: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 py-4">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{detail}</span>
      </span>
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

const SECTIONS: { title: string; body: ReactNode }[] = [
  {
    title: 'Camera consent',
    body: 'The camera turns on only after you have agreed on the consent screen and pressed Start (or Check my setup) in a tool. A "Camera on" light shows the whole time, and Stop camera (or leaving the tool) turns it off. The app asks you to be the only person in view, and the SDK stops measuring if it sees more than one face.',
  },
  {
    title: 'Where processing happens',
    body: 'Video frames are processed on this computer by the Presage SmartSpectra SDK, including the skin-response estimate (EDA proxy) MyStage Pulse uses, which never leaves this computer. Frames are never recorded, written to disk or uploaded. The SDK contacts Presage to check the API key, which identifies the app\'s developer account, not you. We start the SDK with telemetry switched off (enableTelemetry: false), so no usage summaries or setup-check reports are sent.',
  },
  {
    title: 'Presage AI check-ins (heart signals)',
    body: 'While heart signals are on, the Presage SDK automatically sends a short series of numbers (pulse rate, heart-rhythm variability and breathing rate, never video or images) to Presage\'s analytics service, where an AI model writes wellness check-ins ("LLM Insights"): when readings first settle, then about once a minute. This is built into the SDK and has no separate switch. MyZenn Sense does not show those automatic check-ins, but the camera panel counts them. If the AI reflection is on, MyBreath Live also sends one request at the end of a session: our short prompt with your starting and ending breathing pace, and Presage replies with a reflection that is shown only if it stays within wellness language. Presage\'s privacy policy governs that data. Turn heart signals off below to use breathing and face signals only.',
  },
  {
    title: 'Storage, retention and deletion',
    body: 'Live readings exist only in memory and are discarded when the session ends. If you turn on session history, only summary numbers (for example breathing 14 to 7 per minute) are kept in this app\'s local storage, capped at 50 sessions, never video or conversation text. Delete all my data removes history, settings and consent.',
  },
  {
    title: 'Sharing and AI',
    body: 'Apart from the Presage check-ins above, nothing is shared with anyone. The optional AI partner in MyStage Pulse is off by default. When you turn it on and have added a key, the conversation text you type and one word describing your state ("settled" or "tense") are sent to Groq to write the partner\'s replies. OpenAI receives the same text only if Groq cannot answer. No video, images or raw readings are ever sent.',
  },
  {
    title: 'Not a medical device',
    body: 'Readings are for general wellness and reflection. They have not been cleared by the FDA and cannot diagnose, treat or monitor any condition. The app makes no health judgements and does not make decisions for you.',
  },
];

export function Privacy() {
  const settings = useSettings();
  const history = useHistory();
  const config = useAppConfig();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const creditsUsed = Math.ceil(settings.liveSecondsUsed / 30);

  return (
    <div className="mx-auto max-w-3xl animate-fade-in-up">
      <h1 className="text-4xl font-semibold tracking-tight">Privacy &amp; settings</h1>
      <p className="mt-3 text-muted-foreground">
        {hasConsent(settings)
          ? `You agreed to camera use on ${new Date(settings.consentAcceptedAt as string).toLocaleDateString()}.`
          : 'You have not agreed to camera use yet. Tools will ask before turning the camera on.'}
      </p>

      <div className="mt-8 space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-medium">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </section>
        ))}
      </div>

      <h2 className="mt-12 text-lg font-medium">Your choices</h2>
      <div className="mt-2 divide-y divide-white/5 rounded-2xl border border-white/10 px-5">
        <Toggle
          label="Heart signals (pulse and heart rhythm)"
          detail="On: tools use your pulse and HRV, and the Presage SDK sends pulse, HRV and breathing-rate numbers to Presage for its AI check-ins. Off: breathing and face signals only, and heart features rest."
          checked={settings.heartSignals}
          onChange={(v) => updateSettings({ heartSignals: v })}
        />
        <Toggle
          label="Presage AI reflection after MyBreath Live"
          detail="Asks Presage LLM Insights for a two-sentence reflection when you finish (our prompt plus your start and end breathing pace). The camera stays on up to 25 seconds for the reply. Needs heart signals."
          checked={settings.presageReflection}
          disabled={!settings.heartSignals}
          onChange={(v) => updateSettings({ presageReflection: v })}
        />
        <CameraPicker />
        <Toggle
          label="Keep session history on this device"
          detail="Summary numbers only. Off by default."
          checked={settings.saveHistory}
          onChange={(v) => updateSettings({ saveHistory: v })}
        />
        <Toggle
          label="AI rehearsal partner"
          detail={
            config?.aiProviders?.length
              ? `Sends your typed replies and a one-word state to ${aiRoute(config.aiProviders)}.`
              : 'Add GROQ_API_KEY (and optionally OPENAI_API_KEY as a fallback) to .env to enable. Without it, a built-in scripted partner is used.'
          }
          checked={settings.aiPartner}
          disabled={!config?.aiProviders?.length}
          onChange={(v) => updateSettings({ aiPartner: v })}
        />
        <Toggle
          label="Show my camera self-view"
          detail="Hiding it does not stop measuring. Use Stop camera for that."
          checked={settings.showPreview}
          onChange={(v) => updateSettings({ showPreview: v })}
        />
        <Toggle
          label="Practice mode (simulated signals)"
          detail="No camera at all. Signals are simulated and clearly labelled."
          checked={settings.simulate}
          onChange={(v) => updateSettings({ simulate: v })}
        />
        <label className="flex items-start justify-between gap-6 py-4">
          <span>
            <span className="block font-medium">Auto-pause live sessions after</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Saves Presage credits. About {creditsUsed} credit{creditsUsed === 1 ? '' : 's'} used on this device so far (1 credit is 30
              seconds of measuring).
            </span>
          </span>
          <select
            className="mt-1 rounded-lg border border-white/10 bg-secondary px-3 py-2 text-sm"
            value={settings.sessionCapMin}
            onChange={(e) => updateSettings({ sessionCapMin: Number(e.target.value) })}
          >
            {[2, 3, 5, 8, 10].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
      </div>

      <h2 className="mt-12 text-lg font-medium">Your data</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {history.length ? `${history.length} saved session summar${history.length === 1 ? 'y' : 'ies'} on this device.` : 'No session history saved.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" disabled={!history.length} onClick={() => { clearHistory(); setDone('Session history deleted.'); }}>
          Delete session history
        </Button>
        {confirming ? (
          <>
            <Button variant="danger" onClick={() => { deleteAllData(); setConfirming(false); setDone('Everything deleted, including your consent.'); }}>
              Yes, delete everything
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Keep my data
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Withdraw consent and delete all my data
          </Button>
        )}
      </div>
      {done && (
        <p role="status" className="mt-3 text-sm text-emerald-300">
          {done}
        </p>
      )}

      {config && (
        <p className="mt-12 text-xs text-muted-foreground">
          MyZenn Sense {config.appVersion} with Presage SmartSpectra SDK {config.sdkVersion} on {config.platform}.
        </p>
      )}
    </div>
  );
}
