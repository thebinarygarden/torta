// Replaces a torta database with a fresh one holding only the menu in
// `menu.ts`. First-run setup still asks for the restaurant name and password.
//
//   tsx src/seed/index.ts .data  the `pnpm dev` database
//
// Run from apps/server, with torta stopped.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, schema } from '../db';
import { menu } from './menu';

// PGlite has no lock, so deleting the folder under a running server would
// corrupt it. Both the dev server and the desktop app answer on 7070–7079.
async function tortaRunning() {
  for (let port = 7070; port <= 7079; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return port;
    } catch {
      // Nothing there.
    }
  }
  return null;
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: tsx src/seed/index.ts <data dir>');
  process.exit(1);
}
const dataDir = resolve(arg);

const port = await tortaRunning();
if (port) {
  console.error(
    `torta is running on :${port}. Stop pnpm dev or quit the desktop app first.`
  );
  process.exit(1);
}

rmSync(dataDir, { recursive: true, force: true });
const db = await openDb({ dataDir, migrationsFolder: resolve('drizzle') });

// An insert returns exactly the rows it wrote.
const idOf = ([row]: { id: string }[]) => {
  if (!row) throw new Error('insert returned no row');
  return row.id;
};

await db.transaction(async (tx) => {
  for (const [c, category] of menu.entries()) {
    const categoryId = await tx
      .insert(schema.categories)
      .values({ name: category.name, sortOrder: c })
      .returning({ id: schema.categories.id })
      .then(idOf);

    for (const [i, item] of category.items.entries()) {
      const itemId = await tx
        .insert(schema.items)
        .values({
          categoryId,
          name: item.name,
          priceCents: item.priceCents,
          sortOrder: i,
        })
        .returning({ id: schema.items.id })
        .then(idOf);

      for (const [g, group] of item.groups.entries()) {
        const groupId = await tx
          .insert(schema.modifierGroups)
          .values({
            itemId,
            name: group.name,
            minSelect: group.min,
            maxSelect: 1,
            sortOrder: g,
          })
          .returning({ id: schema.modifierGroups.id })
          .then(idOf);
        await tx.insert(schema.modifiers).values(
          group.options.map((o, m) => ({
            groupId,
            name: o.name,
            priceCents: o.priceCents,
            sortOrder: m,
          }))
        );
      }

      if (item.ingredients?.length) {
        await tx.insert(schema.ingredients).values(
          item.ingredients.map((ing, n) => ({
            itemId,
            name: ing.name,
            allowNone: true,
            allowSide: ing.side ?? false,
            allowExtra: ing.extra ?? true,
            extraPriceCents: 0,
            sortOrder: n,
          }))
        );
      }
    }
  }
});

await db.$client.close();
const items = menu.reduce((n, c) => n + c.items.length, 0);
console.log(`torta · seeded ${items} items into ${dataDir}`);
