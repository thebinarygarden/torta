import { Hono } from 'hono';
import type { UpdatesInfo } from '@torta/shared';
import { requireAdmin, type AppDeps, type AppEnv } from '../context';

export function updateRoutes({ updater }: AppDeps) {
  const app = new Hono<AppEnv>()
    .use('/admin/updates', requireAdmin)
    .use('/admin/updates/*', requireAdmin);

  app.get('/admin/updates', async (c) =>
    c.json<UpdatesInfo>(
      updater
        ? {
            available: true,
            backupAt: await updater.backupAt(),
            ...updater.status(),
          }
        : { available: false }
    )
  );

  app.post('/admin/updates/check', (c) => {
    if (!updater) return c.json({ error: 'not_found' }, 404);
    updater.check();
    return c.json({ ok: true });
  });

  app.post('/admin/updates/install', (c) => {
    if (!updater) return c.json({ error: 'not_found' }, 404);
    // Answer before quitting, so the page doesn't see a dropped request.
    setTimeout(updater.install, 100);
    return c.json({ ok: true });
  });

  app.post('/admin/updates/show-backup', (c) => {
    if (!updater) return c.json({ error: 'not_found' }, 404);
    updater.showBackup();
    return c.json({ ok: true });
  });

  return app;
}
