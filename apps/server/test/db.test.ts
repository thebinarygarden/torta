import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { openDb, schema } from '../src/db';
import { migrationsFolder } from './helpers';

const dir = await mkdtemp(join(tmpdir(), 'torta-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

test('data survives closing and reopening the database', async () => {
  const dataDir = join(dir, 'db');
  const first = await openDb({ dataDir, migrationsFolder });
  await first.insert(schema.categories).values({ name: 'drinks' });
  await first.$client.close();

  const second = await openDb({ dataDir, migrationsFolder });
  const rows = await second.select().from(schema.categories);
  await second.$client.close();
  expect(rows.map((r) => r.name)).toEqual(['drinks']);
});
