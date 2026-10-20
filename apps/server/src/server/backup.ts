import { z } from 'zod';
import type { Db } from '../db';
import { schema } from '../db';
import { ApiError } from './errors';

/**
 * The whole database as one JSON document. The laptop holds the only copy of
 * the business's data, so this export is the backup. IDs are kept so that a
 * restore is exact. The sealed Binary Garden refresh token is left out because
 * it can only be unsealed on the machine that sealed it.
 */
const row = z.record(z.string(), z.unknown());
const rows = z.array(row);

export const backupSchema = z.object({
  torta: z.literal(1),
  exportedAt: z.string(),
  settings: row.nullable(),
  categories: rows,
  items: rows,
  modifierGroups: rows,
  modifiers: rows,
  devices: rows,
  orders: rows,
  orderItems: rows,
  inventoryItems: rows,
  ingredients: rows,
});
export type Backup = z.infer<typeof backupSchema>;

export async function exportAll(db: Db): Promise<Backup> {
  const [settings] = await db.select().from(schema.settings).limit(1);
  const [
    categories,
    items,
    modifierGroups,
    modifiers,
    devices,
    orders,
    orderItems,
    inventoryItems,
    ingredients,
  ] = await Promise.all([
    db.select().from(schema.categories),
    db.select().from(schema.items),
    db.select().from(schema.modifierGroups),
    db.select().from(schema.modifiers),
    db.select().from(schema.devices),
    db.select().from(schema.orders),
    db.select().from(schema.orderItems),
    db.select().from(schema.inventoryItems),
    db.select().from(schema.ingredients),
  ]);
  return {
    torta: 1,
    exportedAt: new Date().toISOString(),
    settings: settings ? { ...settings, bgRefreshToken: null } : null,
    categories,
    items,
    modifierGroups,
    modifiers,
    devices,
    orders,
    orderItems,
    inventoryItems,
    ingredients,
  };
}

/**
 * JSON turned every timestamp into a string. Drizzle expects `Date` objects for
 * timestamp columns, so convert them back before inserting.
 */
function revive<T extends Record<string, unknown>>(r: T): T {
  const out: Record<string, unknown> = { ...r };
  for (const [k, v] of Object.entries(out)) {
    if (k.endsWith('At') && typeof v === 'string') out[k] = new Date(v);
  }
  return out as T;
}

export async function importAll(db: Db, input: unknown): Promise<void> {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'bad_backup');
  const b = parsed.data;

  await db.transaction(async (tx) => {
    // Delete child tables before their parents so no foreign key is violated.
    await tx.delete(schema.orderItems);
    await tx.delete(schema.orders);
    await tx.delete(schema.pairingCodes);
    await tx.delete(schema.devices);
    await tx.delete(schema.ingredients);
    await tx.delete(schema.inventoryItems);
    await tx.delete(schema.modifiers);
    await tx.delete(schema.modifierGroups);
    await tx.delete(schema.items);
    await tx.delete(schema.categories);
    await tx.delete(schema.settings);

    if (b.settings) {
      await tx
        .insert(schema.settings)
        .values(revive(b.settings) as typeof schema.settings.$inferInsert);
    }
    const as = <T>(data: Record<string, unknown>[]) => data.map(revive) as T[];
    if (b.categories.length) {
      await tx
        .insert(schema.categories)
        .values(as<typeof schema.categories.$inferInsert>(b.categories));
    }
    if (b.items.length) {
      await tx
        .insert(schema.items)
        .values(as<typeof schema.items.$inferInsert>(b.items));
    }
    if (b.modifierGroups.length) {
      await tx
        .insert(schema.modifierGroups)
        .values(
          as<typeof schema.modifierGroups.$inferInsert>(b.modifierGroups)
        );
    }
    if (b.modifiers.length) {
      await tx
        .insert(schema.modifiers)
        .values(as<typeof schema.modifiers.$inferInsert>(b.modifiers));
    }
    if (b.inventoryItems.length) {
      await tx
        .insert(schema.inventoryItems)
        .values(
          as<typeof schema.inventoryItems.$inferInsert>(b.inventoryItems)
        );
    }
    if (b.ingredients.length) {
      await tx
        .insert(schema.ingredients)
        .values(as<typeof schema.ingredients.$inferInsert>(b.ingredients));
    }
    if (b.devices.length) {
      await tx
        .insert(schema.devices)
        .values(as<typeof schema.devices.$inferInsert>(b.devices));
    }
    if (b.orders.length) {
      await tx
        .insert(schema.orders)
        .values(as<typeof schema.orders.$inferInsert>(b.orders));
    }
    if (b.orderItems.length) {
      await tx
        .insert(schema.orderItems)
        .values(as<typeof schema.orderItems.$inferInsert>(b.orderItems));
    }
  });
}
