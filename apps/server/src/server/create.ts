import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ServerEvent } from '@torta/shared';
import { openDb, type OpenDbOptions } from '../db';
import { createApp } from './app';
import { createAuthenticator, Sessions } from './auth';
import { defaultBg, type BgConfig } from './bg';
import { createNetwork } from './lan';
import { listen } from './port';
import { attachRealtime } from './ws';

export type ServerOptions = OpenDbOptions & {
  /** The first port to try. If it is taken, the next nine are tried in order. */
  port: number;
  hostname?: string;
  /**
   * Directory of the built web app. When set, it is served on every path outside
   * `/api`, with an SPA fallback to `index.html`.
   */
  staticDir?: string;
  /** Keep admin sessions in this file across restarts. Dev only. */
  sessionsFile?: string;
  version: string;
  bg?: Partial<BgConfig>;
};

export async function createServer(opts: ServerOptions) {
  const db = await openDb(opts);
  const sessions = new Sessions(opts.sessionsFile);
  let broadcast: (event: ServerEvent) => void = () => {};
  const network = createNetwork();

  const app = createApp({
    db,
    sessions,
    version: opts.version,
    broadcast: (e) => broadcast(e),
    network,
    bg: { ...defaultBg, ...opts.bg },
  });

  if (opts.staticDir) {
    const index = join(opts.staticDir, 'index.html');
    await readFile(index); // fail at startup, not on the first request
    app.use('/*', serveStatic({ root: opts.staticDir }));
    // Read per request so a rebuild of the web app is picked up without a
    // restart; a stale index would point at asset hashes that no longer exist.
    app.get('/*', async (c) => c.html(await readFile(index, 'utf8')));
  }

  const server = await listen(app, opts.port, opts.hostname);
  const port = (server.address() as AddressInfo).port;
  network.setPort(port);
  const realtime = attachRealtime(server, {
    authenticate: createAuthenticator(db, sessions),
    version: opts.version,
  });
  broadcast = realtime.broadcast;

  return {
    app,
    db,
    sessions,
    port,
    network,
    async close() {
      realtime.close();
      await new Promise<void>((r) => server.close(() => r()));
      await db.$client.close();
    },
  };
}
