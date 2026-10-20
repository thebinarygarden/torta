import { Hono } from 'hono';
import { createAuthenticator } from './auth';
import type { AppDeps, AppEnv } from './context';
import { ApiError } from './errors';
import { backupRoutes } from './routes/backup';
import { bgRoutes } from './routes/bg';
import { deviceRoutes } from './routes/devices';
import { inventoryRoutes } from './routes/inventory';
import { menuRoutes } from './routes/menu';
import { orderRoutes } from './routes/orders';
import { sessionRoutes } from './routes/session';
import { settingsRoutes } from './routes/settings';
import { setupRoutes } from './routes/setup';

export function createApp(deps: AppDeps) {
  const authenticate = createAuthenticator(deps.db, deps.sessions);
  const api = new Hono<AppEnv>();

  api.use(async (c, next) => {
    c.set(
      'principal',
      await authenticate({
        cookie: c.req.header('cookie'),
        authorization: c.req.header('authorization'),
      })
    );
    await next();
  });

  api.route('/', setupRoutes(deps));
  api.route('/', sessionRoutes(deps));
  api.route('/', menuRoutes(deps));
  api.route('/', orderRoutes(deps));
  api.route('/', settingsRoutes(deps));
  api.route('/', inventoryRoutes(deps));
  api.route('/', deviceRoutes(deps));
  api.route('/', bgRoutes(deps));
  api.route('/', backupRoutes(deps));

  api.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: 'internal' }, 500);
  });

  const app = new Hono<AppEnv>();
  app.route('/api', api);
  // A mounted sub-app's notFound never runs; without this, unmatched /api
  // paths fall through to the web app's index.html fallback in create.ts.
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  return app;
}

export type App = ReturnType<typeof createApp>;
