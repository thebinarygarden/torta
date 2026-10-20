import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { schema } from '../../db';
import { newToken, sha256 } from '../auth';
import { json, requireAdmin, type AppDeps, type AppEnv } from '../context';
import { rateLimit } from '../rate-limit';

export const PAIRING_TTL_MS = 5 * 60_000;

const pairInput = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(40),
});

const chooseInput = z.object({ ip: z.ipv4() });

export function deviceRoutes({ db, network }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.post('/pair', rateLimit(10), json(pairInput), async (c) => {
    const { code, name } = c.req.valid('json');
    const [pending] = await db
      .select()
      .from(schema.pairingCodes)
      .where(
        and(
          eq(schema.pairingCodes.code, code),
          isNull(schema.pairingCodes.usedAt),
          gt(schema.pairingCodes.expiresAt, new Date())
        )
      )
      .limit(1);
    if (!pending) return c.json({ error: 'bad_code' }, 401);

    const token = newToken();
    const device = await db.transaction(async (tx) => {
      const [d] = await tx
        .insert(schema.devices)
        .values({ name, tokenHash: sha256(token) })
        .returning();
      await tx
        .update(schema.pairingCodes)
        .set({ usedAt: new Date(), deviceId: d!.id })
        .where(eq(schema.pairingCodes.id, pending.id));
      return d!;
    });
    return c.json({ token, device: { id: device.id, name: device.name } }, 201);
  });

  const admin = new Hono<AppEnv>().use(requireAdmin);

  admin.post('/pairing', async (c) => {
    // Only one pairing code is live at a time, so expire any that are still open.
    await db
      .update(schema.pairingCodes)
      .set({ expiresAt: new Date() })
      .where(
        and(
          isNull(schema.pairingCodes.usedAt),
          gt(schema.pairingCodes.expiresAt, new Date())
        )
      );
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    await db.insert(schema.pairingCodes).values({ code, expiresAt });
    const net = network.describe();
    return c.json({
      code,
      expiresAt: expiresAt.toISOString(),
      url: net.url ? `${net.url}/pair?code=${code}` : null,
    });
  });

  admin.get('/devices', async (c) => {
    const rows = await db
      .select()
      .from(schema.devices)
      .where(isNull(schema.devices.revokedAt))
      .orderBy(desc(schema.devices.createdAt));
    return c.json(
      rows.map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      }))
    );
  });

  admin.delete('/devices/:id', async (c) => {
    const rows = await db
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.devices.id, c.req.param('id')),
          isNull(schema.devices.revokedAt)
        )
      )
      .returning();
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  admin.get('/network', (c) => c.json(network.describe()));
  admin.post('/network', json(chooseInput), (c) => {
    network.choose(c.req.valid('json').ip);
    return c.json(network.describe());
  });

  app.route('/admin', admin);
  return app;
}
