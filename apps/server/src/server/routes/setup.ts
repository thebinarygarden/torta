import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { setupInput } from '@torta/shared';
import { schema } from '../../db';
import { ADMIN_COOKIE, hashPassword } from '../auth';
import { json, type AppDeps, type AppEnv } from '../context';

export function setupRoutes({ db, sessions, version }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/health', async (c) => {
    const [cfg] = await db.select().from(schema.settings).limit(1);
    return c.json({
      ok: true,
      version,
      restaurantName: cfg?.restaurantName ?? null,
      currency: cfg?.currency ?? 'USD',
      taxEnabled: cfg?.taxEnabled ?? false,
      weightUnit: cfg?.weightUnit ?? 'g',
      liquidUnit: cfg?.liquidUnit ?? 'ml',
    });
  });

  app.get('/setup', async (c) => {
    const [cfg] = await db.select().from(schema.settings).limit(1);
    return c.json({ needsSetup: !cfg });
  });

  app.post('/setup', json(setupInput), async (c) => {
    const [existing] = await db.select().from(schema.settings).limit(1);
    if (existing) return c.json({ error: 'already_setup' }, 409);
    const { restaurantName, password } = c.req.valid('json');
    await db.insert(schema.settings).values({
      restaurantName,
      adminPasswordHash: await hashPassword(password),
    });
    setCookie(c, ADMIN_COOKIE, sessions.create(), {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
    return c.json({ ok: true }, 201);
  });

  return app;
}
