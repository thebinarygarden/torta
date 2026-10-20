// Opens a database seeded by the previous release with this release's
// migrations, the way an installed app does on its first launch after an
// update. The release workflow runs it before publishing anything.
//
//   tsx src/check-upgrade.ts <data dir>
//
// Run from apps/server.
import { resolve } from 'node:path';
import { openDb, schema } from './db';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: tsx src/check-upgrade.ts <data dir>');
  process.exit(1);
}

const db = await openDb({
  dataDir: resolve(arg),
  migrationsFolder: resolve('drizzle'),
});
await db.select().from(schema.settings);
const items = await db.select().from(schema.items);
await db.$client.close();
if (items.length === 0) throw new Error('the seeded menu did not survive');
console.log(`upgrade ok: ${items.length} menu items read back`);
