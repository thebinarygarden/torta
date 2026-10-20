import type { ZodType } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createMiddleware } from 'hono/factory';
import type { ServerEvent } from '@torta/shared';
import type { Db } from '../db';
import type { Principal, Sessions } from './auth';
import type { BgConfig } from './bg';
import type { NetworkInfo } from './lan';
import type { Secrets } from './secrets';

export type AppEnv = {
  Variables: { principal: Principal | null };
};

export type AppDeps = {
  db: Db;
  sessions: Sessions;
  version: string;
  broadcast: (event: ServerEvent) => void;
  network: NetworkInfo;
  bg: BgConfig;
  secrets: Secrets;
};

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('principal')) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('principal')?.kind !== 'admin') {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

export const json = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'invalid_input', issues: result.error.issues },
        400
      );
    }
  });
