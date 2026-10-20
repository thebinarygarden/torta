import type { Server } from 'node:http';
import { serve } from '@hono/node-server';

type Fetchable = { fetch: Parameters<typeof serve>[0]['fetch'] };

/**
 * Listens on `port`, or on the next nine ports in turn if it is busy. Port 0
 * asks the OS for any free port, which is what the tests use.
 */
export async function listen(
  app: Fetchable,
  port: number,
  hostname?: string
): Promise<Server> {
  const candidates =
    port === 0 ? [0] : Array.from({ length: 10 }, (_, i) => port + i);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await tryListen(app, candidate, hostname);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      lastError = err;
    }
  }
  throw lastError;
}

function tryListen(app: Fetchable, port: number, hostname?: string) {
  return new Promise<Server>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, () =>
      resolve(server as Server)
    ) as Server;
    server.once('error', reject);
  });
}
