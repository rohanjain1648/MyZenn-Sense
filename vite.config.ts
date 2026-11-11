import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';

// Content-Security-Policy for the packaged Electron page. Only applied to
// production builds: the Vite dev server needs inline scripts for HMR.
// - worker-src blob: is required by the SmartSpectra renderer SDK (frame pump).
// - media-src blob: lets the camera preview render.
// - connect-src 'self': the renderer never talks to the network. The SDK
//   authenticates from the main process; the optional AI partner also runs
//   in the main process.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
].join('; ');

function electronHtml(): Plugin {
  return {
    name: 'myzenn-electron-html',
    apply: 'build',
    transformIndexHtml(html) {
      // `crossorigin` on module scripts breaks loading from file:// in Electron.
      return html
        .replace(/ crossorigin/g, '')
        .replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), electronHtml()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', target: 'chrome120', chunkSizeWarningLimit: 1500 },
  // Worker threads instead of child processes: lighter on Windows.
  test: { environment: 'node', pool: 'threads', include: ['src/**/*.test.ts', 'electron/**/*.test.ts'] },
});
