import { Hono } from 'hono';
import { exportAll, importAll } from '../backup';
import { requireAdmin, type AppDeps, type AppEnv } from '../context';
import { localDate } from '../dates';

export function backupRoutes({ db, broadcast }: AppDeps) {
  const app = new Hono<AppEnv>().use('/admin/*', requireAdmin);

  app.get('/admin/export', async (c) => {
    const backup = await exportAll(db);
    c.header('content-type', 'application/json');
    c.header(
      'content-disposition',
      `attachment; filename="torta-${localDate()}.json"`
    );
    return c.body(JSON.stringify(backup, null, 2));
  });

  app.post('/admin/import', async (c) => {
    const body = await c.req.json().catch(() => null);
    await importAll(db, body);
    broadcast({ type: 'menu.updated' });
    return c.json({ ok: true });
  });

  return app;
}
