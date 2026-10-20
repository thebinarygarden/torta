import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server/create';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
const dataDir = resolve(here, '../.data');
const firstPort = Number(process.env.PORT ?? 7070);

// Started by `pnpm dev` (scripts/dev.mjs), which builds apps/web/dist first.
const { port, network } = await createServer({
  dataDir,
  migrationsFolder: resolve(here, '../drizzle'),
  staticDir: resolve(here, '../../web/dist'),
  // Admin sessions survive the restart tsx does on every save.
  sessionsFile: resolve(dataDir, 'sessions.json'),
  port: firstPort,
  hostname: '0.0.0.0',
  version: pkg.version,
});

console.log(`torta · this laptop  http://localhost:${port}/admin`);
console.log(
  `torta · tablets      ${network.describe().url ?? 'no wifi address found'}  (admin → add device → scan)`
);
if (port !== firstPort) {
  console.warn(
    `torta · port ${firstPort} is busy (the desktop app?), using ${port}. tablets paired on ${firstPort} must pair again.`
  );
}
