import { useEffect, useRef } from 'react';
import type { ServerEvent } from '@torta/shared';
import { getToken } from './auth';

/**
 * Opens one websocket per surface and reconnects with backoff when it drops.
 * Every connect and reconnect delivers a `hello` event, which is the caller's
 * cue to refetch whatever it shows, so events missed while offline don't
 * matter.
 */
export function useRealtime(onEvent: (event: ServerEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer = 0;
    let stopped = false;

    const connect = () => {
      const token = getToken();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const query = token ? `?token=${encodeURIComponent(token)}` : '';
      ws = new WebSocket(`${proto}://${location.host}/ws${query}`);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (m) => {
        try {
          handler.current(JSON.parse(String(m.data)) as ServerEvent);
        } catch {
          // Ignore malformed frames.
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        const delay =
          Math.min(15_000, 1000 * 2 ** attempt++) + Math.random() * 500;
        timer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      if (ws && ws.readyState !== WebSocket.CLOSED) return;
      clearTimeout(timer);
      attempt = 0;
      connect();
    };

    connect();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, []);
}
