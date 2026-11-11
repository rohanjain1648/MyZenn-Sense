// Launch the Electron app.
//   node scripts/launch-electron.mjs        -> loads the built app from dist/
//   node scripts/launch-electron.mjs --dev  -> starts Vite with hot reload, then Electron
//
// Clears ELECTRON_RUN_AS_NODE, which VS Code's integrated terminal exports and
// which otherwise makes Electron run as plain Node and exit immediately.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const smoke = process.argv.includes('--smoke');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (smoke) env.MYZENN_SMOKE = '1';

let server = null;
if (dev) {
  const { createServer } = await import('vite');
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts') });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
  env.MYZENN_DEV_URL = url.replace(/\/$/, '');
  console.log(`[myzenn-sense] Vite dev server at ${env.MYZENN_DEV_URL}`);
}

const electronBinary = require('electron');
const child = spawn(electronBinary, ['.'], { cwd: root, env, stdio: 'inherit' });

child.on('exit', async (code) => {
  if (server) await server.close();
  process.exit(code ?? 0);
});
