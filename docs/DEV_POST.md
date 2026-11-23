---
title: MyZenn Sense: a breathing guide that starts at your pace, and two more tools that listen to your body
published: false
tags: devchallenge, presagechallenge, wellness, electron
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04)*

## What I Built

**MyZenn Sense** is a desktop app (Electron + React + TypeScript) with three calm, short practices. Each one reacts to your body, read through an ordinary webcam by the Presage SmartSpectra SDK. They extend the Sanctuary tools of [MyZenn](https://myzenn.com), my wellness platform.

| Tool | What it does |
| --- | --- |
| **MyBreath Live** | Most breathing apps hand you a fixed 4-7-8 timer. This one **starts at the pace you are actually breathing**. It then slows down one small step at a time, but only once your chest shows you have kept up. If you struggle, it eases back. It talks you through each breath ("breathe in", "breathe out") and draws a dotted ring of your real chest movement against the guide, so you can see whether you are in rhythm. |
| **Heartsong** | An instrument your body plays. Your heartbeat sets the tempo, each breath adds a note and swells a drone, blinks ring small bells, and a smile shifts the key from minor to major. As you settle into slow breathing, the music resolves. |
| **MyStage Pulse** | Rehearse a hard conversation (7 scenarios, 3 difficulty levels), such as asking for a raise or setting a boundary. When your heart races, your partner pauses and waits for you to take three breaths, counted from your chest movement. Afterwards you see how quickly you settled. |

It is a wellness practice, not a medical device. It makes no diagnosis and no health judgement, and it compares you only with your own start.

## Demo

{% embed YOUR_VIDEO_URL %}

The video shows the consent screen, a live MyBreath Live session (breathing rate, pulse, HRV and expression updating from the camera, the guide slowing step by step, the voice cues), Heartsong reacting to breath and blinks, and a MyStage Pulse pause triggered by a heart-rate rise.

## Code

{% github rohanjain1648/MyZenn-Sense %}

Setup (Windows 10/11 x64, Apple Silicon macOS or Linux x64/arm64, Node.js 22.12+, a webcam and a free Presage API key):

```bash
git clone https://github.com/rohanjain1648/MyZenn-Sense.git
cd MyZenn-Sense
npm install          # also fetches the SmartSpectra native runtime
cp .env.example .env # then add PRESAGE_API_KEY=...
npm run app          # builds and opens the desktop app
```

No login is needed. Without a key, **practice mode** in Privacy & settings runs every tool on clearly labelled simulated signals, so you can try the flow without a camera or credits. `npm test` runs the unit tests (signal maths, pacer, Heartsong mapping, activation detector), and `npm run smoke` checks the SDK wiring without opening the camera.

## How It Responds to Human Signals

**Signals used, all live from the SDK:** breathing rate and the chest breathing trace, pulse rate, HRV (RMSSD, SDNN, Baevsky index), blinking, expressions, talking detection, and the EDA proxy in MyStage Pulse.

**Integration.** The app uses the SDK's Electron pattern. The main process calls `bindSmartSpectraIpc(win)` and loads Presage's preload, and the renderer creates `SmartSpectraSDK` with only the metrics each tool needs and `enableTelemetry: false` (`src/sense/sources/presage.ts`). Metrics arrive as protobuf and are decoded with the SDK's `decodeMetrics`, then normalized into one `SenseEngine` that every tool reads.

```
Camera ─► SmartSpectra SDK (on-device)
            │ breathing rate + chest trace, pulse, HRV, blinks, expressions, talking
            │ validationStatus (framing and lighting)
            ▼
        SenseEngine ── warm-up aware, keeps a 60 s chest trace
     ┌──────┼───────────────────┐
 MyBreath Live   Heartsong        MyStage Pulse
 adaptive pacer  body → music     activation vs your own baseline
```

What makes it feel responsive rather than laggy:

- **Individual breaths, not only averages.** The SDK's breathing rate is a 30-second average, so the app also finds single breaths in the chest trace. The pacer, Heartsong's notes and the three-breath pause react within seconds. Readings pass through a short median filter, so one jolt (reaching for the mouse) cannot spike the guide.
- **"In rhythm" score.** The app cross-correlates your chest movement with the guide over small time lags and both polarities, and shows how closely you are following.
- **The pacer follows, then leads.** Each step holds until your measured pace has matched it for a while, eases back if you fall behind, and never goes below about six breaths a minute.
- **Talking pauses breathing decisions.** Breathing can't be measured while you speak, so the SDK's talking signal makes the pacer hold its step and makes MyStage Pulse score from heart rate and expression only.
- **Plain-language guidance.** Every SDK validation code becomes a calm sentence, such as "A little dark. Face a window or a soft lamp."
- **Honest warm-up.** Each reading shows as "tuning in" until its SDK window fills (pulse about 12 s, breathing 30 s, HRV 60 s), instead of showing an early, wrong number.
- **Device Readiness.** "Check my setup" runs `checkDeviceReadiness()` from the main process and shows Presage's verdict before you spend a measurement.
- **Graceful degradation.** If a key is not provisioned for pulse, HRV or EDA, the session restarts without just that signal and tells you.
- **Presage AI reflection.** When MyBreath Live ends, the app calls `requestInsight()` once, matches the reply by request id and decodes the `Insight` protobuf itself. It shows the reply only if it passes a wellness-language filter, so any diagnosis, treatment or condition talk is hidden.

## Prize Categories

**Best Thoughtful Real-World Use.**

Slow breathing is one of the simplest ways to settle, but fixed-timer breathing apps ask a stressed person to jump straight to a slow pace, and many give up. MyBreath Live meets people where they are: it starts at their real pace and only asks for a little slower once their body has kept up. MyStage Pulse targets a moment where people need this most, right before a hard conversation, and teaches the pause in practice rather than in theory.

Usability choices for that audience: no account and no login; spoken cues so you can close your eyes; large calm text; plain-language camera guidance; a visible camera indicator at all times; a practice mode for people without a camera; and an automatic pause after five minutes so a forgotten session can't run on.

## Consent and Data Handling

- **Explicit consent first.** Nothing happens on launch. The camera stays off until you read and accept a plain-language consent screen, which lists what the app does and never does and asks you to confirm you are the only person in view.
- **Camera on only when you press Start** (or "Check my setup"). It turns off on Stop camera, Finish, leaving the tool or closing the app. A red "Camera on" indicator and a timer show the whole time. Hiding the self-view never hides the indicator.
- **No covert use.** Electron grants camera access only to the app's own page, video only, with no microphone. Pop-ups and navigation away are blocked. If the SDK sees more than one face, the app asks others to step out and produces no measurement.
- **On-device processing.** Video frames are processed on your computer by the SDK. **Video and images never leave the computer.** The SDK contacts Presage only to authenticate the API key.
- **SDK telemetry is off.** Every SDK instance is created with `enableTelemetry: false`.
- **Presage LLM Insights disclosure.** While heart signals are on, the SDK automatically sends derived numbers (pulse, HRV and breathing-rate series, never video) to Presage's LLM Insights about once a minute. The SDK has no switch for this, so the app discloses it on the consent screen, counts each check-in live in the camera panel, and lets you turn **Heart signals** off (breathing and face signals only). The optional end-of-session reflection sends one extra request (a short prompt plus your start and end breathing pace) and can be switched off. Presage's privacy policy governs that data on their side.
- **Storage, retention and deletion.** Live readings stay in memory and are discarded when the session ends. Session history is **off by default**; if you turn it on, it keeps summary numbers only, on this device, up to 50 sessions. "Withdraw consent and delete all my data" removes everything the app stored, including your consent.
- **Optional AI service.** MyStage Pulse's AI rehearsal partner is off by default and needs your own key. When on, it sends only the text you type, the scenario prompt and one word (`settled` or `tense`) to Groq, falling back to OpenAI only if Groq fails. It never sends video, readings or identifiers. Without a key, a built-in scripted partner is used.
- **Not medical.** No diagnosis, treatment claims or medical decisions. "Body activation" compares you only with your own resting rhythm in the same session.

Full details: [PRIVACY.md](https://github.com/rohanjain1648/MyZenn-Sense/blob/main/PRIVACY.md).

## Agent Session

I built MyZenn Sense with Claude Code.

{% agent_session YOUR_SESSION_URL %}
