import type { UpdateStatus } from '@torta/shared';
import { afterAll, expect, test } from 'vitest';
import type { Updater } from '../src/server/context';
import { client, makeApp, setup } from './helpers';

const calls: string[] = [];
const status: UpdateStatus = { state: 'ready', version: '9.9.9' };
const fake: Updater = {
  status: () => status,
  check: () => calls.push('check'),
  install: () => calls.push('install'),
  setAuto: (on) => calls.push(`auto ${on}`),
  backupAt: async () => '2026-10-20T12:00:00.000Z',
  showBackup: () => calls.push('show backup'),
};

const plain = await makeApp();
const desktop = await makeApp(fake);
const admin = client(desktop.app, (await setup(desktop.app)).cookie);
afterAll(async () => {
  await plain.close();
  await desktop.close();
});

test('outside the desktop app there is nothing to update', async () => {
  const api = client(plain.app, (await setup(plain.app)).cookie);
  expect((await api.get('/admin/updates')).body).toEqual({ available: false });
  expect((await api.post('/admin/updates/check')).status).toBe(404);
});

test('the updater is admin only, and reports and acts through the routes', async () => {
  expect((await desktop.app.request('/api/admin/updates')).status).toBe(401);
  const res = await desktop.app.request('/api/admin/updates/install', {
    method: 'POST',
  });
  expect(res.status).toBe(401);

  const api = admin;
  expect((await api.get('/admin/updates')).body).toEqual({
    available: true,
    backupAt: '2026-10-20T12:00:00.000Z',
    state: 'ready',
    version: '9.9.9',
  });
  expect((await api.post('/admin/updates/check')).status).toBe(200);
  expect((await api.post('/admin/updates/show-backup')).status).toBe(200);
  expect((await api.post('/admin/updates/install')).status).toBe(200);
  await new Promise((r) => setTimeout(r, 150));
  expect(calls).toEqual(['check', 'show backup', 'install']);
});

test('turning auto-update off is saved and passed to the updater', async () => {
  calls.length = 0;
  const api = admin;
  expect((await api.get('/admin/settings')).body.autoUpdate).toBe(true);
  const off = await api.patch('/admin/settings', { autoUpdate: false });
  expect(off.body.autoUpdate).toBe(false);
  await api.patch('/admin/settings', { taxRateBps: 100 });
  expect(calls).toEqual(['auto false']);
});
