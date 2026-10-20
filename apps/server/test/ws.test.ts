import { afterAll, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from '../src/server/create';
import { migrationsFolder } from './helpers';

const server = await createServer({
  migrationsFolder,
  port: 0,
  hostname: '127.0.0.1',
  version: 'test',
});
const base = `http://127.0.0.1:${server.port}`;
afterAll(() => server.close());

type Message = { type: string; [k: string]: unknown };

/** Buffers every message so none are lost between awaits. */
function listen(ws: WebSocket) {
  const queue: Message[] = [];
  const waiting: ((m: Message) => void)[] = [];
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString()) as Message;
    const w = waiting.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return () =>
    new Promise<Message>((resolve) => {
      const m = queue.shift();
      if (m) resolve(m);
      else waiting.push(resolve);
    });
}

async function post(path: string, cookie: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { id: string } };
}

test('anonymous upgrades are refused', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const err = await new Promise<Error>((r) => ws.once('error', r));
  expect(err.message).toMatch(/401/);
});

test('an admin socket receives hello and order events', async () => {
  const setup = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restaurantName: 'ws', password: 'correct horse' }),
  });
  const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
    headers: { cookie },
  });
  const next = listen(ws);
  expect((await next()).type).toBe('hello');

  const cat = await post('/api/admin/categories', cookie, { name: 'drinks' });
  expect((await next()).type).toBe('menu.updated');

  const item = await post('/api/admin/items', cookie, {
    categoryId: cat.body.id,
    name: 'agua',
    priceCents: 300,
  });
  expect((await next()).type).toBe('menu.updated');

  const created = await post('/api/orders', cookie, {
    items: [{ itemId: item.body.id, qty: 1 }],
  });
  expect(created.status).toBe(201);
  const event = await next();
  expect(event.type).toBe('order.created');
  expect((event.order as { orderNumber: number }).orderNumber).toBe(1);
  ws.close();
});
