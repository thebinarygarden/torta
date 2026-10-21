import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { openDb, schema } from '../src/db';
import { migrationsFolder } from './helpers';

const dir = await mkdtemp(join(tmpdir(), 'torta-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

test('0001 numbers existing items and keeps their last count', async () => {
  // A database as the first release left it: only the init migration.
  const before = join(dir, 'drizzle');
  await mkdir(join(before, 'meta'), { recursive: true });
  await copyFile(
    join(migrationsFolder, '0000_init.sql'),
    join(before, '0000_init.sql')
  );
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8')
  );
  journal.entries = journal.entries.slice(0, 1);
  await writeFile(join(before, 'meta/_journal.json'), JSON.stringify(journal));

  const dataDir = join(dir, 'db');
  const old = await openDb({ dataDir, migrationsFolder: before });
  await old.execute(sql`
    insert into inventory_items (name, kind, pack_size, pack_cost_cents, on_hand, counted_at)
    values ('beef', 'weight', 5000, 4000, 2500, '2026-10-01T15:00:00Z')
  `);
  await old.$client.close();

  const db = await openDb({ dataDir, migrationsFolder });
  const [item] = await db.select().from(schema.inventoryItems);
  const entries = await db.select().from(schema.inventoryEntries);
  await db.$client.close();
  expect(item).toMatchObject({ name: 'beef', code: 1 });
  expect(entries).toEqual([
    expect.objectContaining({
      inventoryItemId: item!.id,
      kind: 'counted',
      qty: 2500,
      costCents: 0,
      businessDate: '2026-10-01',
    }),
  ]);
});
