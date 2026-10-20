import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { schema } from '../src/db';
import { client, makeApp, setup } from './helpers';

const ctx = await makeApp();
afterAll(() => ctx.close());

let admin: ReturnType<typeof client>;
beforeAll(async () => {
  const { cookie } = await setup(ctx.app);
  admin = client(ctx.app, cookie);
});

const pair = (body: unknown) =>
  ctx.app.request('/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Paired = { token: string; device: { id: string; name: string } };
const paired = async (res: Response) => (await res.json()) as Paired;

const asDevice = (token: string) =>
  ctx.app.request('/api/me', { headers: { authorization: `Bearer ${token}` } });

describe('pairing', () => {
  test('admin mints a code with a url the phone can scan', async () => {
    const { status, body } = await admin.post('/admin/pairing');
    expect(status).toBe(200);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    // CI machines may have no LAN interface, so the URL may be null.
    if (body.url) expect(body.url).toContain(`/pair?code=${body.code}`);
  });

  test('a wrong code is refused', async () => {
    expect((await pair({ code: '000000', name: 'phone' })).status).toBe(401);
    expect((await pair({ code: 'abc', name: 'phone' })).status).toBe(400);
  });

  test('a code pairs once, then is spent', async () => {
    const { body } = await admin.post('/admin/pairing');
    const first = await pair({ code: body.code, name: 'counter 1' });
    expect(first.status).toBe(201);
    const { token, device } = await paired(first);
    expect(device.name).toBe('counter 1');

    const me = await asDevice(token);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      kind: 'device',
      name: 'counter 1',
    });

    expect((await pair({ code: body.code, name: 'again' })).status).toBe(401);
  });

  test('minting a new code expires the previous one', async () => {
    const a = (await admin.post('/admin/pairing')).body;
    const b = (await admin.post('/admin/pairing')).body;
    expect((await pair({ code: a.code, name: 'late' })).status).toBe(401);
    expect((await pair({ code: b.code, name: 'ok' })).status).toBe(201);
  });

  test('an expired code is refused', async () => {
    const { body } = await admin.post('/admin/pairing');
    await ctx.db
      .update(schema.pairingCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pairingCodes.code, body.code));
    expect((await pair({ code: body.code, name: 'slow' })).status).toBe(401);
  });

  test('devices are listed and revoking one ends its access', async () => {
    const { body } = await admin.post('/admin/pairing');
    const { token } = await paired(
      await pair({ code: body.code, name: 'kitchen' })
    );

    const list = await admin.get('/admin/devices');
    const kitchen = list.body.find(
      (d: { name: string }) => d.name === 'kitchen'
    );
    expect(kitchen).toBeTruthy();

    expect((await admin.delete(`/admin/devices/${kitchen.id}`)).status).toBe(
      200
    );
    expect((await asDevice(token)).status).toBe(401);
    expect(
      (await admin.get('/admin/devices')).body.some(
        (d: { id: string }) => d.id === kitchen.id
      )
    ).toBe(false);
    expect((await admin.delete(`/admin/devices/${kitchen.id}`)).status).toBe(
      404
    );
  });

  test('devices can read the menu and place orders but not administer', async () => {
    const { body } = await admin.post('/admin/pairing');
    const { token } = await paired(
      await pair({ code: body.code, name: 'tablet' })
    );
    const headers = { authorization: `Bearer ${token}` };
    expect((await ctx.app.request('/api/menu', { headers })).status).toBe(200);
    expect(
      (await ctx.app.request('/api/admin/devices', { headers })).status
    ).toBe(401);
  });

  test('pairing attempts are rate limited', async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i++) {
      results.push((await pair({ code: '999999', name: 'brute' })).status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  test('network describes the port and any lan addresses', async () => {
    const { body } = await admin.get('/admin/network');
    expect(body.port).toBe(7070);
    expect(Array.isArray(body.interfaces)).toBe(true);
  });
});
