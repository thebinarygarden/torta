import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { passwordInput, settingsPatch, type Settings } from '@torta/shared';
import { schema } from '../../db';
import { hashPassword, verifyPassword } from '../auth';
import { json, requireAdmin, type AppDeps, type AppEnv } from '../context';
import { isIsoDate, localDate } from '../dates';
import { salesSummary } from '../sales';

export function settingsRoutes({ db }: AppDeps) {
  const app = new Hono<AppEnv>().use('/admin/*', requireAdmin);

  const publicSettings = (
    row: typeof schema.settings.$inferSelect
  ): Settings => ({
    restaurantName: row.restaurantName,
    taxRateBps: row.taxRateBps,
    taxEnabled: row.taxEnabled,
    currency: row.currency,
    weightUnit: row.weightUnit,
    liquidUnit: row.liquidUnit,
  });

  app.get('/admin/settings', async (c) => {
    const [row] = await db.select().from(schema.settings).limit(1);
    if (!row) return c.json({ error: 'needs_setup' }, 409);
    return c.json(publicSettings(row));
  });

  app.patch('/admin/settings', json(settingsPatch), async (c) => {
    const [row] = await db
      .update(schema.settings)
      .set({ ...c.req.valid('json'), updatedAt: new Date() })
      .where(eq(schema.settings.id, 1))
      .returning();
    if (!row) return c.json({ error: 'needs_setup' }, 409);
    return c.json(publicSettings(row));
  });

  app.post('/admin/password', json(passwordInput), async (c) => {
    const { current, next } = c.req.valid('json');
    const [row] = await db.select().from(schema.settings).limit(1);
    if (!row) return c.json({ error: 'needs_setup' }, 409);
    if (!(await verifyPassword(current, row.adminPasswordHash))) {
      return c.json({ error: 'bad_password' }, 401);
    }
    await db
      .update(schema.settings)
      .set({
        adminPasswordHash: await hashPassword(next),
        updatedAt: new Date(),
      })
      .where(eq(schema.settings.id, 1));
    return c.json({ ok: true });
  });

  app.get('/admin/sales', async (c) => {
    const today = localDate();
    const from = c.req.query('from') ?? today;
    const to = c.req.query('to') ?? from;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      return c.json({ error: 'invalid_input', message: 'from/to' }, 400);
    }
    return c.json(await salesSummary(db, from, to));
  });

  return app;
}
