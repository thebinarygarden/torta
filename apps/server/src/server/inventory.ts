import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import type { BarcodeLookup, InventoryItem, Kind } from '@torta/shared';
import type { Db } from '../db';
import { schema } from '../db';

type InventoryRow = typeof schema.inventoryItems.$inferSelect;

/**
 * Orders whose food counts as used: completed ones, and ones the kitchen
 * cancelled after making the food.
 */
export const foodUsed = or(
  eq(schema.orders.status, 'completed'),
  and(eq(schema.orders.status, 'cancelled'), eq(schema.orders.foodMade, true))
);
const finishedAt =
  sql<Date>`coalesce(${schema.orders.completedAt}, ${schema.orders.cancelledAt})`.mapWith(
    schema.orders.completedAt
  );

export async function listInventory(db: Db): Promise<InventoryItem[]> {
  const rows = await db
    .select()
    .from(schema.inventoryItems)
    .orderBy(asc(schema.inventoryItems.name));
  if (rows.length === 0) return [];

  const oldestCount = rows.reduce(
    (min, r) => (r.countedAt < min ? r.countedAt : min),
    rows[0]!.countedAt
  );
  const lines = await db
    .select({ usage: schema.orderItems.usage, at: finishedAt })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
    .where(and(foodUsed, gt(finishedAt, oldestCount.toISOString())));

  return rows.map((r) => {
    let used = 0;
    for (const l of lines) {
      if (l.at <= r.countedAt) continue;
      for (const u of l.usage) if (u.inventoryItemId === r.id) used += u.qty;
    }
    return toInventoryItem(r, r.onHand - used);
  });
}

export const toInventoryItem = (
  r: InventoryRow,
  expectedLeft: number
): InventoryItem => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  barcode: r.barcode,
  packSize: r.packSize,
  packCostCents: r.packCostCents,
  onHand: r.onHand,
  countedAt: r.countedAt.toISOString(),
  expectedLeft,
});

// Base units (g or ml) per unit Open Food Facts may report.
const OFF_UNITS: Record<string, { kind: Kind; factor: number }> = {
  g: { kind: 'weight', factor: 1 },
  kg: { kind: 'weight', factor: 1000 },
  oz: { kind: 'weight', factor: 28.349523125 },
  lb: { kind: 'weight', factor: 453.59237 },
  ml: { kind: 'liquid', factor: 1 },
  cl: { kind: 'liquid', factor: 10 },
  l: { kind: 'liquid', factor: 1000 },
  'fl oz': { kind: 'liquid', factor: 29.5735295625 },
};

/**
 * Finds a barcode in local inventory, then on Open Food Facts. The lookup is a
 * convenience: offline or on any failure it returns nothing and the owner
 * types the item in.
 */
export async function lookupBarcode(
  db: Db,
  code: string,
  version: string
): Promise<BarcodeLookup> {
  const items = await listInventory(db);
  const match = items.find((i) => i.barcode === code);
  if (match) return { match };

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_quantity,product_quantity_unit`,
      {
        headers: { 'user-agent': `torta/${version}` },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return {};
    const body = (await res.json()) as {
      product?: {
        product_name?: string;
        product_quantity?: number | string;
        product_quantity_unit?: string;
      };
    };
    const p = body.product;
    if (!p?.product_name) return {};
    const unit = OFF_UNITS[p.product_quantity_unit?.toLowerCase().trim() ?? ''];
    const size = Number(p.product_quantity);
    return {
      suggestion: {
        name: p.product_name.trim().slice(0, 80),
        kind: unit?.kind,
        packSize: unit && size > 0 ? size * unit.factor : undefined,
      },
    };
  } catch {
    return {};
  }
}
