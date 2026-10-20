import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { loginInput } from '@torta/shared';
import { schema } from '../../db';
import { ADMIN_COOKIE, verifyPassword } from '../auth';
import { json, requireAuth, type AppDeps, type AppEnv } from '../context';
import { rateLimit } from '../rate-limit';

export function sessionRoutes({ db, sessions }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.post('/admin/login', rateLimit(5), json(loginInput), async (c) => {
    const [cfg] = await db.select().from(schema.settings).limit(1);
    if (!cfg) return c.json({ error: 'needs_setup' }, 409);
    const ok = await verifyPassword(
      c.req.valid('json').password,
      cfg.adminPasswordHash
    );
    if (!ok) return c.json({ error: 'bad_password' }, 401);
    setCookie(c, ADMIN_COOKIE, sessions.create(), {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
    return c.json({ ok: true });
  });

  app.post('/admin/logout', async (c) => {
    sessions.delete(getCookie(c, ADMIN_COOKIE));
    deleteCookie(c, ADMIN_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', requireAuth, (c) => c.json(c.get('principal')));

  return app;
}
