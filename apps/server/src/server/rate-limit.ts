import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './context';

/**
 * A small fixed-window rate limiter keyed by client IP. It is only used on
 * login and pairing, the two endpoints where guessing a password or a 6-digit
 * code is worth slowing down. Counts live in memory and reset on restart.
 */
export function rateLimit(max: number, windowMs = 60_000) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = clientIp(c.env) ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
    } else if (entry.count >= max) {
      return c.json({ error: 'too_many_attempts' }, 429);
    } else {
      entry.count += 1;
    }
    await next();
  });
}

function clientIp(env: unknown): string | undefined {
  const incoming = (
    env as { incoming?: { socket?: { remoteAddress?: string } } }
  )?.incoming;
  return incoming?.socket?.remoteAddress;
}
