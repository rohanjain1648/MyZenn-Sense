# Consent and data handling

MyZenn Sense reads body signals from your camera. This page explains how it asks for consent, and what happens to the data.

## Camera consent

- **Nothing happens on launch.** The camera stays off until you have read and accepted a plain-language consent screen. It lists what the app does and what it never does, and you confirm you are the only person in view.
- **The camera turns on only when you press a tool's Start button**, or **Check my setup** (a camera and performance check that takes no measurement). It turns off when you press **Stop camera**, leave the tool, finish the session or close the app.
- **You can always see when it's measuring.** A red "Camera on" indicator and a session timer show the whole time. The mirrored self-view is on by default and can be hidden. Hiding it does not secretly keep measuring: the indicator stays.
- **One person only.** If the SDK sees more than one face, it reports `MULTIPLE_FACES_FOUND`. The app then asks others to step out of view, and no measurement is produced.
- **No background or covert use.** Electron grants camera access only to the app's own page, video only (no microphone). Pop-ups and navigation to any other page are blocked.
- **You can withdraw consent at any time** in Privacy & settings, with *Withdraw consent and delete all my data*.

## Processing

- Video frames are processed **on this computer** by the Presage SmartSpectra SDK (`@smartspectra/node-sdk` 3.5.0). **Video and images never leave the computer.**
- The SDK contacts Presage to authenticate the API key and validate the subscription. Those requests identify the app's developer account, not you.
- **SDK telemetry is switched off.** We construct every SDK instance (sessions and Check my setup) with `enableTelemetry: false`, so it sends no session summaries and no setup-check (device readiness) reports.

### Presage LLM Insights (while heart signals are on)

The SmartSpectra SDK has a built-in feature called LLM Insights. Presage's documentation says that **while a session with cardio metrics is running, the SDK automatically sends** a buffered series of derived numbers (pulse rate, heart-rate variability and breathing rate), plus a fixed prompt and request metadata, to Presage's analytics gateway. There, a large language model writes a wellness "check-in". This happens when pulse, breathing and HRV first become stable, then about every 60 seconds. **Raw video and facial imagery are never transmitted.**

- The SDK has **no setting to turn this off** while cardio metrics are on. It is separate from telemetry.
- MyZenn Sense **does not display** these automatic check-ins. The camera panel counts the check-ins the SDK receives, so the data flow is visible.
- **One on-demand reflection (MyBreath Live, optional, on by default with heart signals).** When you finish a session, the app sends one request to LLM Insights. That request is our short prompt plus your starting and ending breathing pace (e.g. "easing from about 14 to 7 breaths per minute"), together with the SDK's buffered numbers. The camera stays on, with the indicator showing, for up to 25 seconds while Presage replies, and you can skip at any time. The reply is shown only if it stays within wellness language: any reply mentioning diagnoses, treatments, conditions or medical advice is hidden. Turn it off with **Presage AI reflection** in Privacy & settings.
- **Your choice:** turn off **Heart signals** in Privacy & settings. Tools then request breathing and face signals only, with no pulse or HRV, and heart-based features rest.
- Storage, retention and deletion of that data on Presage's side are governed by [Presage's privacy policy](https://presagetech.com/legal/privacy-policy). The SDK docs set no fixed retention period.
- Consent version 2 added this disclosure, so anyone who agreed to the earlier version is asked again.

## Storage, retention and deletion

| Data | Stored? | Where | How long |
| --- | --- | --- | --- |
| Video frames and images | Never | None | None |
| Live readings (breathing, pulse, HRV, expression, blinks, talking, skin-response estimate) | In memory only in this app | App memory | Discarded when the session ends |
| Skin-response estimate (EDA proxy, MyStage Pulse only) | Never leaves this computer (not part of LLM Insights) | App memory | Discarded when the session ends |
| Chosen camera (device id and name) | Yes, if you pick one | This app's local storage | Until you change it or delete all data |
| Pulse, HRV and breathing-rate series (heart signals on) | Sent by the Presage SDK for LLM Insights | Presage | Per Presage's privacy policy |
| Session summaries (numbers only, e.g. "breathing 14 to 7 per minute") | **Only if you turn on history** (off by default) | This app's local storage on this device | Up to 50 sessions, until you delete them |
| Rehearsal conversation text | Never stored | App memory | Discarded when you leave the debrief |
| Settings and consent date | Yes | This app's local storage | Until you delete them |
| Live-minutes counter (to estimate Presage credits) | Yes | This app's local storage | Until you delete it |

**Deletion:** *Delete session history* removes summaries. *Withdraw consent and delete all my data* removes everything the app has stored, including your consent.

## Sharing

Apart from the Presage LLM Insights flow above, and the optional AI partner below, nothing is shared with anyone. There are no analytics, no accounts and no cloud sync.

## Optional AI service

MyStage Pulse has an **optional** AI rehearsal partner. It is **off by default**, and works only after you add a key and turn it on in Privacy & settings.

- **Primary provider: Groq** (`GROQ_API_KEY`). It writes the partner's replies and the end-of-rehearsal coaching notes.
- **Fallback provider: OpenAI** (`OPENAI_API_KEY`). It is used only when Groq cannot answer (an outage, a rate limit or a key problem). The rehearsal screen tells you when the fallback has replied.

When it is on:

- what is sent is the text you type in the rehearsal, the scenario's role prompt, and one word describing your current state (`settled` or `tense`)
- never sent: video, images, raw readings, or any identifier
- the call is made from the desktop app's main process, so keys are never exposed to web content
- Groq's API terms apply to that text, and OpenAI's API terms apply when the fallback is used

Without it, a built-in scripted partner is used and the app contacts no AI service of its own. (The Presage SDK's built-in LLM Insights, described under Processing, depend only on the Heart signals setting.)

## Not a medical device

This is a wellness practice tool. Readings are for general wellness and reflection only. They have not been cleared by the FDA and cannot diagnose, treat or monitor any condition. MyZenn Sense makes no health judgements and no medical decisions. "Body activation" in MyStage Pulse compares you only with your own resting rhythm from the same session. It is not a measure of anxiety or of any condition.
