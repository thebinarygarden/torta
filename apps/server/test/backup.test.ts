import { afterAll, expect, test } from 'vitest';
import type { Backup } from '../src/server/backup';
import { client, makeApp, seedMenu, setup } from './helpers';

const source = await makeApp();
const target = await makeApp();
afterAll(async () => {
  await source.close();
  await target.close();
});

test('a backup restores menu, orders, devices and the admin password exactly', async () => {
  const { cookie } = await setup(source.app, 'original pass');
  const src = client(source.app, cookie);
  const menu = await seedMenu(src);
  await src.patch('/admin/settings', { taxRateBps: 500 });
  const order = (
    await src.post('/orders', {
      items: [{ itemId: menu.taco.id, qty: 2, modifierIds: [menu.asada.id] }],
    })
  ).body;
  await src.post(`/orders/${order.id}/status`, { status: 'completed' });

  const res = await source.app.request('/api/admin/export', {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-disposition')).toMatch(
    /torta-\d{4}-\d{2}-\d{2}\.json/
  );
  const backup = (await res.json()) as Backup;
  expect(backup.torta).toBe(1);
  expect(backup.settings).not.toHaveProperty('bgRefreshToken');

  // A fresh install with a different password restores the backup.
  const tgt = client(
    target.app,
    (await setup(target.app, 'other pass')).cookie
  );
  expect((await tgt.post('/admin/import', { torta: 2 })).status).toBe(400);
  expect((await tgt.post('/admin/import', backup)).status).toBe(200);

  const restoredMenu = (await tgt.get('/menu')).body;
  expect(restoredMenu).toEqual((await src.get('/menu')).body);
  const restoredOrders = (await tgt.get('/orders?scope=today')).body;
  expect(restoredOrders).toHaveLength(1);
  expect(restoredOrders[0]).toMatchObject({
    id: order.id,
    orderNumber: 1,
    status: 'completed',
    totalCents: order.totalCents,
  });
  expect((await tgt.get('/admin/settings')).body.taxRateBps).toBe(500);

  // The original admin password came along with the settings row.
  const login = await target.app.request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'original pass' }),
  });
  expect(login.status).toBe(200);
  expect(target.events.at(-1)).toEqual({ type: 'menu.updated' });
});
