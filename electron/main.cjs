// MyZenn Sense: Electron main process.
//
// Responsibilities
//  1. Host the React UI in one sandboxed BrowserWindow.
//  2. Wire the Presage SmartSpectra renderer bridge (bindSmartSpectraIpc).
//  3. Grant the camera ONLY to this app's own page, video only (no microphone).
//  4. Hold API keys. The renderer can ask for the Presage key (the SDK needs it
//     at construction). The optional Groq / OpenAI keys never leave this process.
//
// Integration pattern follows Presage's electron-quickstart sample
// (github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart).

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, session, ipcMain } = require('electron');

const ROOT = path.join(__dirname, '..');
const DEV_URL = process.env.MYZENN_DEV_URL || null;

// Packaged builds ship the native runtime as an unpacked extra resource
// (a .dll/.dylib/.so cannot be loaded from inside app.asar).
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH) {
  const LIB = {
    darwin: 'libsmartspectra_capi.dylib',
    win32: 'smartspectra_capi.dll',
    linux: 'libsmartspectra_capi.so',
  }[process.platform];
  if (LIB) process.env.SMARTSPECTRA_CAPI_PATH = path.join(process.resourcesPath, 'smartspectra', LIB);
}

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
const sdkVersion = require('@smartspectra/node-sdk/package.json').version;

// ---------------------------------------------------------------------------
// Keys: read from a local, git-ignored .env file (or the process environment).
// ---------------------------------------------------------------------------
const KEY_NAMES = ['PRESAGE_API_KEY', 'GROQ_API_KEY', 'GROQ_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL'];

function loadEnv() {
  const values = {};
  const candidates = [path.join(ROOT, '.env'), path.join(path.dirname(process.execPath), '.env')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (KEY_NAMES.includes(key) && value && !(key in values)) values[key] = value;
    }
  }
  for (const key of KEY_NAMES) {
    if (process.env[key]) values[key] = process.env[key];
  }
  return values;
}

const env = loadEnv();

// ---------------------------------------------------------------------------
// Optional AI partner for MyStage Pulse: Groq first, OpenAI as fallback
// (see llm.cjs). Runs here, not in the page, so keys are never exposed to web
// content. Only conversation text and a one-word body state ("settled" /
// "tense") are sent. Never video, never raw vitals.
// ---------------------------------------------------------------------------
const { createLlm } = require('./llm.cjs');
const llm = createLlm({ env });

const isString = (v, max) => typeof v === 'string' && v.length <= max;

/** Renderer turns ({ role: 'user' | 'partner' }) -> provider-neutral chat turns. */
function sanitizeTurns(turns) {
  if (!Array.isArray(turns)) return [];
  return turns
    .slice(-16)
    .filter((t) => t && (t.role === 'user' || t.role === 'partner') && isString(t.text, 2000))
    .map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', text: t.text }));
}

function registerIpc() {
  ipcMain.handle('sense:config', () => ({
    hasPresageKey: Boolean(env.PRESAGE_API_KEY),
    aiProviders: llm.providers,
    platform: process.platform,
    sdkVersion,
    appVersion: app.getVersion(),
  }));

  ipcMain.handle('sense:presage-key', () => env.PRESAGE_API_KEY || null);

  // Device Readiness: SmartSpectra checkDeviceReadiness() checks whether this
  // camera and computer can sustain the requested signals, without starting a
  // measurement. The check exists only on the main-process SDK, which opens the
  // camera natively. The UI runs it only after consent and while no session
  // is running, and shows the camera as on while it runs.
  let readinessBusy = false;
  ipcMain.handle('sense:readiness', async (_event, req) => {
    if (!env.PRESAGE_API_KEY) return { verdict: 'blocked', reason: 'Add PRESAGE_API_KEY to the .env file, then restart the app.' };
    if (readinessBusy) return { verdict: 'inconclusive', reason: 'A setup check is already running.' };
    readinessBusy = true;
    const { SmartSpectraSDK, CameraSelection } = require('@smartspectra/node-sdk');
    const requestedMetrics = [0, 1, 2]; // chest, abdomen, breathing rate
    if (req && req.cardio) requestedMetrics.push(15, 17); // pulse rate, HRV
    if (req && req.face) requestedMetrics.push(12, 13, 14); // blinking, talking, expressions
    if (req && req.eda) requestedMetrics.push(10); // EDA proxy
    let sdk = null;
    try {
      sdk = new SmartSpectraSDK({ apiKey: env.PRESAGE_API_KEY, requestedMetrics, enableTelemetry: false });
      // The renderer knows the chosen camera by its browser label; the SDK has
      // its own camera ids, so match on the name. Fall back to the default.
      let selection = CameraSelection.default;
      const label = req && isString(req.cameraLabel, 300) ? req.cameraLabel.trim().toLowerCase() : '';
      if (label) {
        try {
          const match = SmartSpectraSDK.availableCameras().find((c) => {
            const name = (c.name || '').trim().toLowerCase();
            return name && (name === label || label.includes(name) || name.includes(label));
          });
          if (match) selection = CameraSelection.byId(match.id);
        } catch {
          /* camera discovery unsupported: use the default camera */
        }
      }
      sdk.useCamera(selection);
      const result = await Promise.race([
        sdk.checkDeviceReadiness(),
        new Promise((resolve) =>
          setTimeout(() => resolve({ verdict: 'inconclusive', reason: 'The check took too long. Try again.' }), 90_000),
        ),
      ]);
      return { verdict: String(result.verdict), reason: String(result.reason || '') };
    } catch (err) {
      return { verdict: 'inconclusive', reason: (err && err.message) || 'The check could not run.' };
    } finally {
      readinessBusy = false;
      if (sdk) {
        try {
          await sdk.destroy();
        } catch {
          /* already released */
        }
      }
    }
  });

  ipcMain.handle('stage:reply', async (_event, req) => {
    if (!req || !isString(req.system, 4000)) throw new Error('Invalid request');
    const bodyState = req.bodyState === 'tense' ? 'tense' : 'settled';
    const system =
      `${req.system}\n\nYou are a rehearsal partner inside a wellness practice app. ` +
      `Stay in character, reply in 1-3 short sentences, no stage directions longer than a few words. ` +
      `The user currently seems ${bodyState}. If they seem tense, keep the same character but slow ` +
      `the pace slightly and give them room. Never give medical, diagnostic or therapeutic advice.`;
    return llm.generate({ system, turns: sanitizeTurns(req.turns) });
  });

  ipcMain.handle('stage:debrief', async (_event, req) => {
    if (!req || !isString(req.scenario, 200)) throw new Error('Invalid request');
    const transcript = sanitizeTurns(req.turns)
      .map((t) => `${t.role === 'user' ? 'Me' : 'Partner'}: ${t.text}`)
      .join('\n');
    const moments = isString(req.moments, 2000) ? req.moments : '';
    const system =
      'You are a warm communication coach in a wellness practice app (not a therapist, not medical). ' +
      'Give 3 short, specific, encouraging tips (one line each) on how the user communicated, ' +
      'referring to their actual words. Do not diagnose or mention health conditions.';
    const prompt = `Scenario: ${req.scenario}\nMoments the user paused to breathe: ${moments || 'none'}\n\nConversation:\n${transcript}`;
    return llm.generate({ system, turns: [{ role: 'user', text: prompt }], maxTokens: 300 });
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function isAppOrigin(url) {
  if (!url) return false;
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0b1016',
    autoHideMenuBar: true,
    title: 'MyZenn Sense',
    webPreferences: {
      // Presage's preload exposes the narrow SDK bridge the renderer SDK uses.
      preload: require.resolve('@smartspectra/node-sdk/preload'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  bindSmartSpectraIpc(win);

  // Never open popups or navigate away: remote content must not inherit the camera grant.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppOrigin(url)) event.preventDefault();
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    if (process.env.MYZENN_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }

  // `npm run smoke`: check the wiring without a camera or credits, then quit.
  if (process.env.MYZENN_SMOKE === '1') {
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.log('[smoke] renderer error:', details.message);
    });
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const result = await win.webContents.executeJavaScript('window.__senseSmoke ? window.__senseSmoke() : { error: "smoke hook missing" }');
        console.log('[smoke] ' + JSON.stringify(result));
        app.exit(result && result.presageBridge && result.rendered && result.sdkClass === 'function' ? 0 : 1);
      } catch (err) {
        console.log('[smoke] failed: ' + (err && err.message));
        app.exit(1);
      }
    });
  }
}

app.whenReady().then(() => {
  // Second preload: MyZenn Sense's own small API (config, AI partner).
  session.defaultSession.registerPreloadScript({
    type: 'frame',
    filePath: path.join(__dirname, 'app-preload.cjs'),
  });

  // Camera only, video only, only for our own page. Everything else is denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    const mediaTypes = (details && details.mediaTypes) || [];
    const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    callback(permission === 'media' && cameraOnly && isAppOrigin(url));
  });

  // Permission *checks* (no camera is opened): lets the camera picker see real
  // camera names via enumerateDevices(). Video only, our own page only.
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (permission !== 'media') return false;
    if (details && details.mediaType && details.mediaType !== 'video') return false;
    const origin = requestingOrigin || (wc && wc.getURL()) || '';
    return isAppOrigin(origin);
  });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
