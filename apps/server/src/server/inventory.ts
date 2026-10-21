import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import type {
  BarcodeLookup,
  EntryKind,
  InventoryEntry,
  InventoryHistory,
  InventoryItem,
  Kind,
} from '@torta/shared';
import type { Db } from '../db';
import { schema } from '../db';
import { localDate } from './dates';
import { ApiError } from './errors';

type ItemRow = typeof schema.inventoryItems.$inferSelect;
type EntryRow = typeof schema.inventoryEntries.$inferSelect;

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

/** What `qty` of an item costs at its current price. */
export const packPrice = (qty: number, item: ItemRow) =>
  Math.round((qty * item.packCostCents) / item.packSize);

/**
 * When a ledger line takes effect: when its amount was last saved, so lines
 * apply in the order things happened and a recount replaces the day's earlier
 * one. A line saved for an earlier day lands at the end of that day, so it
 * sits before everything typed since.
 */
function effectiveAt(e: EntryRow): Date {
  return e.businessDate === localDate(e.updatedAt)
    ? e.updatedAt
    : new Date(`${e.businessDate}T23:59:59.999`);
}

type Usage = { at: Date; businessDate: string; qty: number; costCents: number };
type Walked = EntryRow & { at: Date; expected: number | null };
type Stock = {
  item: ItemRow;
  expectedLeft: number;
  entries: Walked[];
  usage: Usage[];
};

/**
 * Replays every item's ledger against what sales used, in order: a counted
 * line records what was expected and becomes the new truth, a received line
 * adds, and usage between lines subtracts. Nothing is cached, so editing an
 * old line simply changes the replay.
 */
async function ledger(db: Db): Promise<Stock[]> {
  const items = await db
    .select()
    .from(schema.inventoryItems)
    .orderBy(asc(schema.inventoryItems.name));
  if (items.length === 0) return [];

  const entries = await db.select().from(schema.inventoryEntries);
  const walked = new Map<string, Walked[]>();
  for (const e of entries) {
    const list = walked.get(e.inventoryItemId) ?? [];
    list.push({ ...e, at: effectiveAt(e), expected: null });
    walked.set(e.inventoryItemId, list);
  }
  for (const list of walked.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  const oldest = items.reduce(
    (min, r) => (r.createdAt < min ? r.createdAt : min),
    items[0]!.createdAt
  );
  const lines = await db
    .select({
      usage: schema.orderItems.usage,
      at: finishedAt,
      businessDate: schema.orders.businessDate,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
    .where(and(foodUsed, gt(finishedAt, oldest.toISOString())));
  const usage = new Map<string, Usage[]>();
  for (const l of lines) {
    for (const u of l.usage) {
      const list = usage.get(u.inventoryItemId) ?? [];
      list.push({
        at: l.at,
        businessDate: l.businessDate,
        qty: u.qty,
        costCents: u.costCents,
      });
      usage.set(u.inventoryItemId, list);
    }
  }

  return items.map((item) => {
    const used = (usage.get(item.id) ?? [])
      .filter((u) => u.at > item.createdAt)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    let running = 0;
    let next = 0;
    // The first count ever has nothing to compare with.
    let counted = false;
    const own = walked.get(item.id) ?? [];
    for (const e of own) {
      for (; next < used.length && used[next]!.at <= e.at; next++) {
        running -= used[next]!.qty;
      }
      if (e.kind === 'counted') {
        e.expected = counted ? running : null;
        counted = true;
        running = e.qty;
      } else {
        running += e.qty;
      }
    }
    for (; next < used.length; next++) running -= used[next]!.qty;
    return { item, expectedLeft: running, entries: own, usage: used };
  });
}

const toItem = ({ item, expectedLeft, entries }: Stock): InventoryItem => {
  const last = entries.filter((e) => e.kind === 'counted').at(-1);
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    kind: item.kind,
    barcode: item.barcode,
    packSize: item.packSize,
    packCostCents: item.packCostCents,
    expectedLeft,
    valueCents: packPrice(Math.max(0, expectedLeft), item),
    lastCount: last
      ? {
          qty: last.qty,
          at: last.at.toISOString(),
          diff: last.expected === null ? null : last.qty - last.expected,
        }
      : null,
  };
};

const toEntry = (e: Walked, item: ItemRow): InventoryEntry => ({
  id: e.id,
  inventoryItemId: item.id,
  code: item.code,
  name: item.name,
  kind: item.kind,
  entry: e.kind,
  qty: e.qty,
  costCents: e.costCents,
  expected: e.expected,
  businessDate: e.businessDate,
  createdAt: e.createdAt.toISOString(),
});

export async function listInventory(db: Db): Promise<InventoryItem[]> {
  return (await ledger(db)).map(toItem);
}

export async function inventoryHistory(
  db: Db,
  from: string,
  to: string
): Promise<InventoryHistory> {
  const inRange = (d: string) => d >= from && d <= to;
  const items: InventoryHistory['items'] = [];
  const entries: InventoryEntry[] = [];
  const totals = { receivedCents: 0, usedCents: 0, diffCents: 0 };
  for (const stock of await ledger(db)) {
    const { item } = stock;
    const row = {
      inventoryItemId: item.id,
      code: item.code,
      name: item.name,
      kind: item.kind,
      receivedQty: 0,
      receivedCents: 0,
      usedQty: 0,
      usedCents: 0,
      diff: null as number | null,
      diffCents: null as number | null,
    };
    for (const e of stock.entries) {
      if (!inRange(e.businessDate)) continue;
      entries.push(toEntry(e, item));
      if (e.kind === 'received') {
        row.receivedQty += e.qty;
        row.receivedCents += e.costCents;
      } else if (e.expected !== null) {
        row.diff = (row.diff ?? 0) + e.qty - e.expected;
      }
    }
    for (const u of stock.usage) {
      if (!inRange(u.businessDate)) continue;
      row.usedQty += u.qty;
      row.usedCents += u.costCents;
    }
    if (row.diff !== null) row.diffCents = packPrice(row.diff, item);
    if (row.receivedQty || row.usedQty || row.diff !== null) items.push(row);
    totals.receivedCents += row.receivedCents;
    totals.usedCents += row.usedCents;
    totals.diffCents += row.diffCents ?? 0;
  }
  entries.sort(
    (a, b) =>
      b.businessDate.localeCompare(a.businessDate) ||
      a.createdAt.localeCompare(b.createdAt)
  );
  return { from, to, items, entries, totals };
}

/**
 * Saves a ledger line, replacing the one already there for that item, kind and
 * day. A delivery with a price makes it the item's price.
 */
export async function putEntry(
  db: Db,
  input: {
    inventoryItemId: string;
    kind: EntryKind;
    businessDate?: string;
    qty: number;
    costCents?: number;
  }
): Promise<InventoryEntry> {
  const [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, input.inventoryItemId));
  if (!item) throw new ApiError(404, 'not_found', 'inventory item');
  const received = input.kind === 'received';
  const costCents = received
    ? (input.costCents ?? packPrice(input.qty, item))
    : 0;
  const now = new Date();
  const businessDate = input.businessDate ?? localDate(now);
  // Fixing only the price leaves the line where it was in time.
  const [current] = await db
    .select({ qty: schema.inventoryEntries.qty })
    .from(schema.inventoryEntries)
    .where(
      and(
        eq(schema.inventoryEntries.inventoryItemId, item.id),
        eq(schema.inventoryEntries.kind, input.kind),
        eq(schema.inventoryEntries.businessDate, businessDate)
      )
    );
  const moved = !current || current.qty !== input.qty;
  const [row] = await db.transaction(async (tx) => {
    if (received && input.costCents !== undefined) {
      await tx
        .update(schema.inventoryItems)
        .set({
          packCostCents: Math.round((costCents * item.packSize) / input.qty),
        })
        .where(eq(schema.inventoryItems.id, item.id));
    }
    return tx
      .insert(schema.inventoryEntries)
      .values({
        inventoryItemId: item.id,
        kind: input.kind,
        qty: input.qty,
        costCents,
        businessDate,
      })
      .onConflictDoUpdate({
        target: [
          schema.inventoryEntries.inventoryItemId,
          schema.inventoryEntries.kind,
          schema.inventoryEntries.businessDate,
        ],
        set: {
          qty: input.qty,
          costCents,
          ...(moved ? { updatedAt: now } : {}),
        },
      })
      .returning({ id: schema.inventoryEntries.id });
  });
  const stock = (await ledger(db)).find((s) => s.item.id === item.id)!;
  return toEntry(
    stock.entries.find((e) => e.id === row!.id)!,
    stock.item
  );
}

export async function deleteEntry(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.inventoryEntries)
    .where(eq(schema.inventoryEntries.id, id))
    .returning({ id: schema.inventoryEntries.id });
  return rows.length > 0;
}

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
 * Finds a barcode or a #code in local inventory, then a barcode on Open Food
 * Facts. The lookup is a convenience: offline or on any failure it returns
 * nothing and the owner types the item in.
 */
export async function lookupBarcode(
  db: Db,
  raw: string,
  version: string
): Promise<BarcodeLookup> {
  const code = raw.trim();
  const items = await listInventory(db);
  const match =
    items.find((i) => i.barcode === code) ??
    (/^#?\d{1,9}$/.test(code)
      ? items.find((i) => i.code === Number(code.replace('#', '')))
      : undefined);
  if (match) return { match };
  // Real barcodes are at least eight digits; a mistyped #code never waits
  // on the network.
  if (!/^\d{8,}$/.test(code)) return {};

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
