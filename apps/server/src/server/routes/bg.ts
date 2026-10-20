import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '../../db';
import { authorizeUrl, exchangeCode, newState, pkcePair } from '../bg';
import { requireAdmin, type AppDeps, type AppEnv } from '../context';

const PENDING_TTL_MS = 10 * 60_000;

export function bgRoutes({ db, bg, network }: AppDeps) {
  const app = new Hono<AppEnv>();
  const pending = new Map<string, { verifier: string; expiresAt: number }>();
  const redirectUri = () =>
    `http://127.0.0.1:${network.describe().port}/api/bg/callback`;

  const status = async () => {
    const [row] = await db.select().from(schema.settings).limit(1);
    return {
      linked: !!row?.bgUserId,
      userId: row?.bgUserId ?? null,
      email: row?.bgEmail ?? null,
      linkedAt: row?.bgLinkedAt?.toISOString() ?? null,
    };
  };

  const admin = new Hono<AppEnv>().use('/*', requireAdmin);

  admin.get('/bg', async (c) => c.json(await status()));

  admin.post('/bg/link/start', (c) => {
    for (const [k, v] of pending)
      if (v.expiresAt < Date.now()) pending.delete(k);
    const state = newState();
    const { verifier, challenge } = pkcePair();
    pending.set(state, { verifier, expiresAt: Date.now() + PENDING_TTL_MS });
    return c.json({
      url: authorizeUrl(bg, { redirectUri: redirectUri(), state, challenge }),
    });
  });

  admin.delete('/bg/link', async (c) => {
    await db
      .update(schema.settings)
      .set({
        bgUserId: null,
        bgEmail: null,
        bgLinkedAt: null,
      })
      .where(eq(schema.settings.id, 1));
    return c.json(await status());
  });

  app.route('/admin', admin);

  // The system browser lands here after signing in to Binary Garden. It carries
  // no torta session, so the single-use `state` value is the proof that the
  // owner started this link.
  app.get('/bg/callback', async (c) => {
    const { code, state, error } = c.req.query();
    const entry = state ? pending.get(state) : undefined;
    if (state) pending.delete(state);
    if (error) return c.html(page(`binary garden said: ${error}`), 400);
    if (!code || !entry || entry.expiresAt < Date.now()) {
      return c.html(page('that link expired. start again from torta.'), 400);
    }
    try {
      const account = await exchangeCode(bg, {
        code,
        redirectUri: redirectUri(),
        verifier: entry.verifier,
      });
      await db
        .update(schema.settings)
        .set({
          bgUserId: account.userId,
          bgEmail: account.email,
          bgLinkedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.settings.id, 1));
      return c.html(
        page(
          `linked as ${account.email ?? account.userId}. you can close this tab.`
        )
      );
    } catch (err) {
      return c.html(page(`could not link: ${(err as Error).message}`), 502);
    }
  });

  return app;
}

const page = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>torta</title>` +
  `<body style="margin:0;min-height:100dvh;display:grid;place-items:center;font:15px/1.5 system-ui;background:#101211;color:#f3f4f2">` +
  `<p>${message.replace(/</g, '&lt;')}</p></body>`;
