import type { ZodType } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createMiddleware } from 'hono/factory';
import type { ServerEvent, UpdateStatus } from '@torta/shared';
import type { Db } from '../db';
import type { Principal, Sessions } from './auth';
import type { NetworkInfo } from './lan';

export type AppEnv = {
  Variables: { principal: Principal | null };
};

/** The desktop app's updater. Absent in development and tests. */
export type Updater = {
  status: () => UpdateStatus;
  /** Looks for a new version and downloads it if there is one. */
  check: () => void;
  /** Quits, installs the downloaded version and reopens. */
  install: () => void;
  setAuto: (on: boolean) => void;
  /** When the data was last copied aside before an update, if ever. */
  backupAt: () => Promise<string | null>;
  /** Opens that copy's folder on the laptop. */
  showBackup: () => void;
};

export type AppDeps = {
  db: Db;
  sessions: Sessions;
  version: string;
  broadcast: (event: ServerEvent) => void;
  network: NetworkInfo;
  updater?: Updater;
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
