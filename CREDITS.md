# Credits and prior work

MyZenn Sense was started on 11 November 2026 for the DEV x Presage SmartSpectra SDK Challenge. The signal engine, the three tools, the Presage integration, the Electron app and all tests were written for this entry. The challenge asks entrants to credit any non-trivial reuse of prior work, so here it is.

## Reused from MyZenn (the author's own wellness platform, myzenn.com)

| File here | Origin | Changes |
| --- | --- | --- |
| `src/myzenn/theme.css` | MyZenn design tokens (`src/styles/theme.css`) | None |
| `src/myzenn/chimesAudioEngine.ts` | MyChimes Web Audio engine | Added `playFrequency()` with a per-note voice, plus `context` / `connectExternal()` so Heartsong's breath drone shares its reverb |
| `src/myzenn/stageScenarios.ts` | MyStage rehearsal scenarios and partner prompts | Import of `ComponentType` only |
| `docs/myzenn-design-system.md` | MyZenn design system notes | Reference only |
| `public/assets/*.png` | MyZenn Sanctuary card art (MyBreath, MyChimes, MyStage) | None |
| `tailwind.config.ts` | Adapted from MyZenn's config | Trimmed; added signal colours |

The tools build on MyZenn Sanctuary ideas (box breathing, a pentatonic instrument, anxiety rehearsal). Everything that makes them respond to the body is new: the adaptive pacer, the breath detection and rhythm matching, the body-played instrument mapping, the activation and spike detection, and the breath-counted pause.

## Presage SmartSpectra SDK

- `@smartspectra/node-sdk` 3.5.0, (c) Presage Technologies, proprietary, used under the [Presage Terms of Service](https://physiology.presagetech.com/tos). It is installed from npm, never vendored into this repository.
- `electron/main.cjs` follows the integration pattern of Presage's [electron-quickstart sample](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart): the preload bridge, `bindSmartSpectraIpc`, the camera-only permission handler, and native runtime packaging.

## Open-source libraries

React, Vite, Electron, Tailwind CSS, framer-motion and clsx/tailwind-merge (MIT); lucide-react icons (ISC); DM Sans and Outfit fonts via Fontsource (SIL Open Font License). The optional AI partner calls Groq (primary) and OpenAI (fallback) with plain `fetch` against their chat-completions APIs, the same way MyZenn's relay server calls Groq. No AI SDK is bundled.
