// `pnpm dev`: the whole development setup in one process tree. Builds the web
// app into apps/web/dist and rebuilds it on every save, then starts the server
// on :7070, which serves that build to this laptop and every tablet, the same
// way the desktop app does. Pages reload themselves after a rebuild.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');

// React's development build, so errors in the browser are readable.
process.env.NODE_ENV ??= 'development';

const vitePath = createRequire(join(web, 'package.json')).resolve('vite');
const { build } = await import(pathToFileURL(vitePath).href);

const watcher = await build({
  root: web,
  mode: 'development',
  logLevel: 'warn',
  build: { watch: {} },
});

let server;
watcher.on('event', async (event) => {
  event.result?.close?.();
  if (event.code === 'ERROR') console.error(event.error);
  if (event.code !== 'END') return;
  if (server) {
    console.log('web · rebuilt');
    return;
  }
  // First build done: dist exists, so the server can start serving it.
  await import(pathToFileURL(join(root, 'scripts/notices.mjs')).href);
  server = spawn(
    'pnpm',
    ['--filter', '@torta/server', 'exec', 'tsx', 'watch', 'src/dev.ts'],
    { cwd: root, stdio: 'inherit' }
  );
  server.on('exit', (code) => stop(code ?? 0));
});

async function stop(code) {
  await watcher.close();
  process.exit(code);
}
process.on('SIGINT', () => {
  server?.kill('SIGINT');
  stop(0);
});
