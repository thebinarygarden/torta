import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerEvent } from '@torta/shared';
import type { Credentials, Principal } from './auth';

export type Realtime = {
  broadcast: (event: ServerEvent) => void;
  close: () => void;
};

export function attachRealtime(
  server: Server,
  opts: {
    authenticate: (creds: Credentials) => Promise<Principal | null>;
    version: string;
    pingMs?: number;
  }
): Realtime {
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakSet<WebSocket>();

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    opts
      .authenticate({
        cookie: req.headers.cookie,
        token: url.searchParams.get('token') ?? undefined,
      })
      .then((principal) => {
        if (!principal) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) =>
          wss.emit('connection', ws)
        );
      })
      .catch(() => socket.destroy());
  });

  wss.on('connection', (ws: WebSocket) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    const hello: ServerEvent = {
      type: 'hello',
      serverTime: new Date().toISOString(),
      version: opts.version,
    };
    ws.send(JSON.stringify(hello));
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, opts.pingMs ?? 30_000);

  return {
    broadcast(event) {
      const data = JSON.stringify(event);
      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    },
    close() {
      clearInterval(ping);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
