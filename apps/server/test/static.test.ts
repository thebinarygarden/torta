import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { createServer } from '../src/server/create';
import { migrationsFolder } from './helpers';

const staticDir = await mkdtemp(join(tmpdir(), 'torta-web-'));
await writeFile(
  join(staticDir, 'index.html'),
  '<!doctype html><title>torta</title>'
);

const server = await createServer({
  migrationsFolder,
  staticDir,
  port: 0,
  hostname: '127.0.0.1',
  version: 'test',
});
const base = `http://127.0.0.1:${server.port}`;
afterAll(async () => {
  await server.close();
  await rm(staticDir, { recursive: true, force: true });
});

test('client routes fall back to index.html', async () => {
  const res = await fetch(`${base}/pair?code=123456`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('<title>torta</title>');
});

test('unknown api paths are a json 404, not the web app', async () => {
  const res = await fetch(`${base}/api/nope`);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});
