import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerEvent } from '@torta/shared';
import { openDb } from '../src/db';
import { createApp } from '../src/server/app';
import { Sessions } from '../src/server/auth';
import { defaultBg } from '../src/server/bg';
import { createNetwork } from '../src/server/lan';

export const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle'
);

export async function makeApp(
  bgFetch: typeof fetch = () => Promise.reject(new Error('offline'))
) {
  const db = await openDb({ migrationsFolder });
  const sessions = new Sessions();
  const events: ServerEvent[] = [];
  const network = createNetwork();
  network.setPort(7070);
  const app = createApp({
    db,
    sessions,
    version: 'test',
    broadcast: (e) => events.push(e),
    network,
    bg: {
      ...defaultBg,
      url: 'https://bg.test',
      clientId: 'torta-test',
      fetch: bgFetch,
    },
  });
  return { app, db, sessions, events, close: () => db.$client.close() };
}

type App = Awaited<ReturnType<typeof makeApp>>['app'];

export async function setup(app: App, password = 'correct horse') {
  const res = await app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restaurantName: 'la torta', password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { res, cookie };
}

export function client(app: App, cookie: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: {
        cookie,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    put: (p: string, b: unknown) => call('PUT', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    delete: (p: string) => call('DELETE', p),
  };
}

/** A small menu: tacos with a required protein and optional extras. */
export async function seedMenu(api: ReturnType<typeof client>) {
  const cat = (await api.post('/admin/categories', { name: 'tacos' })).body;
  const taco = (
    await api.post('/admin/items', {
      categoryId: cat.id,
      name: 'taco',
      priceCents: 350,
    })
  ).body;
  const protein = (
    await api.post(`/admin/items/${taco.id}/modifier-groups`, {
      name: 'protein',
      minSelect: 1,
      maxSelect: 1,
    })
  ).body;
  const asada = (
    await api.post(`/admin/modifier-groups/${protein.id}/modifiers`, {
      name: 'asada',
    })
  ).body;
  const extras = (
    await api.post(`/admin/items/${taco.id}/modifier-groups`, {
      name: 'extras',
      minSelect: 0,
      maxSelect: 2,
    })
  ).body;
  const guac = (
    await api.post(`/admin/modifier-groups/${extras.id}/modifiers`, {
      name: 'guac',
      priceCents: 100,
    })
  ).body;
  const agua = (
    await api.post('/admin/items', {
      categoryId: cat.id,
      name: 'agua fresca',
      priceCents: 300,
    })
  ).body;
  return { cat, taco, protein, asada, extras, guac, agua };
}
