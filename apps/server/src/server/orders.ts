import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  canTransition,
  isActive,
  type Order,
  type OrderInput,
  type OrderModifier,
  type OrderIngredient,
  type OrderStatus,
} from '@torta/shared';
import type { Db } from '../db';
import { schema } from '../db';
import type { OrderUsage } from '../db/schema';
import { localDate } from './dates';
import { ApiError } from './errors';

type OrderRow = typeof schema.orders.$inferSelect;
type OrderItemRow = typeof schema.orderItems.$inferSelect;

function toOrder(row: OrderRow, items: OrderItemRow[]): Order {
  return {
    id: row.id,
    businessDate: row.businessDate,
    orderNumber: row.orderNumber,
    status: row.status,
    notes: row.notes,
    customerName: row.customerName,
    deviceId: row.deviceId,
    subtotalCents: row.subtotalCents,
    taxRateBps: row.taxRateBps,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    foodMade: row.foodMade,
    editedAt: row.editedAt?.toISOString() ?? null,
    employeeMeal: row.employeeMeal,
    items: items
      .filter((i) => i.orderId === row.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        itemId: i.itemId,
        name: i.name,
        priceCents: i.priceCents,
        qty: i.qty,
        notes: i.notes,
        modifiers: i.modifiers,
        ingredients: i.ingredients,
        lineTotalCents: i.lineTotalCents,
        sortOrder: i.sortOrder,
      })),
  };
}

async function itemsFor(db: Db, orderIds: string[]): Promise<OrderItemRow[]> {
  if (orderIds.length === 0) return [];
  return db
    .select()
    .from(schema.orderItems)
    .where(inArray(schema.orderItems.orderId, orderIds));
}

export function taxFor(subtotalCents: number, taxRateBps: number): number {
  return Math.round((subtotalCents * taxRateBps) / 10_000);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Prices every line from the current menu, never the client's numbers, and
 * snapshots names, choices and inventory usage. Shared by create and edit.
 */
async function priceLines(
  tx: Tx,
  input: OrderInput,
  // A past order may name an item that has since sold out.
  allowUnavailable = false
) {
  const itemIds = [...new Set(input.items.map((l) => l.itemId))];
  const menuItems = await tx
    .select()
    .from(schema.items)
    .where(inArray(schema.items.id, itemIds));
  const itemsById = new Map(menuItems.map((i) => [i.id, i]));

  const groups = await tx
    .select()
    .from(schema.modifierGroups)
    .where(inArray(schema.modifierGroups.itemId, itemIds));
  const groupIds = groups.map((g) => g.id);
  const mods =
    groupIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.modifiers)
          .where(inArray(schema.modifiers.groupId, groupIds));
  const modsById = new Map(mods.map((m) => [m.id, m]));

  const ings = await tx
    .select()
    .from(schema.ingredients)
    .where(inArray(schema.ingredients.itemId, itemIds));
  const invIds = [
    ...new Set(
      ings.flatMap((i) => (i.inventoryItemId ? [i.inventoryItemId] : []))
    ),
  ];
  const inventory =
    invIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.inventoryItems)
          .where(inArray(schema.inventoryItems.id, invIds));
  const invById = new Map(inventory.map((i) => [i.id, i]));

  let subtotalCents = 0;
  const lines = input.items.map((line, sortOrder) => {
    const item = itemsById.get(line.itemId);
    if (!item) throw new ApiError(400, 'unknown_item');
    if (!item.available && !allowUnavailable) {
      throw new ApiError(409, 'item_unavailable', item.name);
    }

    const itemGroups = groups.filter((g) => g.itemId === item.id);
    const chosen: OrderModifier[] = [];
    const perGroup = new Map<string, number>();
    for (const modId of line.modifierIds) {
      const mod = modsById.get(modId);
      if (!mod || !itemGroups.some((g) => g.id === mod.groupId)) {
        throw new ApiError(400, 'unknown_modifier');
      }
      perGroup.set(mod.groupId, (perGroup.get(mod.groupId) ?? 0) + 1);
      chosen.push({ id: mod.id, name: mod.name, priceCents: mod.priceCents });
    }
    for (const g of itemGroups) {
      const n = perGroup.get(g.id) ?? 0;
      if (n < g.minSelect || n > g.maxSelect) {
        throw new ApiError(400, 'modifier_count', g.name);
      }
    }

    const itemIngs = ings.filter((i) => i.itemId === item.id);
    const adjusted: OrderIngredient[] = [];
    for (const { id, choice } of line.ingredientChoices) {
      const ing = itemIngs.find((i) => i.id === id);
      if (!ing) throw new ApiError(400, 'unknown_ingredient');
      const allowed =
        !adjusted.some((a) => a.id === id) &&
        (choice === 'none'
          ? ing.allowNone
          : choice === 'side'
            ? ing.allowSide
            : ing.allowExtra);
      if (!allowed) throw new ApiError(400, 'ingredient_choice', ing.name);
      adjusted.push({
        id: ing.id,
        name: ing.name,
        choice,
        priceCents: choice === 'extra' ? ing.extraPriceCents : 0,
      });
    }
    // Snapshot what this line takes from inventory and what that cost now,
    // so later recipe or price changes never rewrite past reports.
    const usage: OrderUsage[] = [];
    for (const ing of itemIngs) {
      const inv = ing.inventoryItemId && invById.get(ing.inventoryItemId);
      if (!inv || ing.qty == null) continue;
      // None uses nothing, extra a second portion, on the side the same.
      const choice = adjusted.find((a) => a.id === ing.id)?.choice;
      const portions = choice === 'none' ? 0 : choice === 'extra' ? 2 : 1;
      if (portions === 0) continue;
      const qty = ing.qty * portions * line.qty;
      usage.push({
        inventoryItemId: inv.id,
        name: inv.name,
        kind: inv.kind,
        qty,
        costCents: Math.round((qty * inv.packCostCents) / inv.packSize),
      });
    }

    const unit =
      item.priceCents +
      chosen.reduce((s, m) => s + m.priceCents, 0) +
      adjusted.reduce((s, a) => s + a.priceCents, 0);
    // A staff meal snapshots the menu prices but charges nothing for them.
    const lineTotalCents = input.employeeMeal ? 0 : unit * line.qty;
    subtotalCents += lineTotalCents;
    return {
      itemId: item.id,
      name: item.name,
      priceCents: item.priceCents,
      qty: line.qty,
      notes: line.notes ?? null,
      modifiers: chosen,
      ingredients: adjusted,
      usage,
      lineTotalCents,
      sortOrder,
    };
  });

  const [cfg] = await tx.select().from(schema.settings).limit(1);
  const taxRateBps = cfg?.taxEnabled ? cfg.taxRateBps : 0;
  const taxCents = taxFor(subtotalCents, taxRateBps);
  return {
    lines,
    totals: {
      subtotalCents,
      taxRateBps,
      taxCents,
      totalCents: subtotalCents + taxCents,
    },
  };
}

/**
 * `past` backfills an order the owner is entering after the fact: it lands on
 * that day with that day's next number, already completed.
 */
export async function createOrder(
  db: Db,
  input: OrderInput,
  ctx: { deviceId: string | null; past?: Date }
): Promise<Order> {
  const { past } = ctx;
  return db.transaction(async (tx) => {
    const { lines, totals } = await priceLines(tx, input, past !== undefined);

    const businessDate = localDate(past);
    const [agg] = await tx
      .select({ max: sql<number | null>`max(${schema.orders.orderNumber})` })
      .from(schema.orders)
      .where(eq(schema.orders.businessDate, businessDate));
    const orderNumber = Number(agg?.max ?? 0) + 1;

    const [row] = await tx
      .insert(schema.orders)
      .values({
        businessDate,
        orderNumber,
        status: past ? 'completed' : 'sent',
        ...(past && { createdAt: past, updatedAt: past, completedAt: past }),
        deviceId: ctx.deviceId,
        notes: input.notes ?? null,
        customerName: input.customerName || null,
        employeeMeal: input.employeeMeal ?? false,
        ...totals,
      })
      .returning();
    if (!row) throw new ApiError(500, 'insert_failed');

    const itemRows = await tx
      .insert(schema.orderItems)
      .values(lines.map((l) => ({ ...l, orderId: row.id })))
      .returning();
    return toOrder(row, itemRows);
  });
}

/**
 * Replaces an open order's items. It keeps its number and start time, so the
 * kitchen timer runs on, and is marked edited until the kitchen hears it.
 */
export async function editOrder(
  db: Db,
  id: string,
  input: OrderInput
): Promise<Order> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    if (!existing) throw new ApiError(404, 'not_found');
    if (!isActive(existing)) {
      throw new ApiError(409, 'bad_transition', existing.status);
    }
    const { lines, totals } = await priceLines(tx, input);
    const now = new Date();
    const [row] = await tx
      .update(schema.orders)
      .set({
        notes: input.notes ?? null,
        customerName: input.customerName || null,
        employeeMeal: input.employeeMeal ?? false,
        ...totals,
        updatedAt: now,
        editedAt: now,
      })
      .where(
        and(eq(schema.orders.id, id), eq(schema.orders.status, existing.status))
      )
      .returning();
    if (!row) throw new ApiError(409, 'bad_transition');
    await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, id));
    const itemRows = await tx
      .insert(schema.orderItems)
      .values(lines.map((l) => ({ ...l, orderId: id })))
      .returning();
    return toOrder(row, itemRows);
  });
}

/**
 * Removes a finished order for good, like a test order. Open orders are still
 * on the kitchen's screen, so they are closed first.
 */
export async function deleteOrder(db: Db, id: string): Promise<void> {
  const [row] = await db
    .select({ status: schema.orders.status })
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  if (isActive(row)) {
    throw new ApiError(409, 'bad_transition', row.status);
  }
  // Its lines go with it (on delete cascade).
  await db.delete(schema.orders).where(eq(schema.orders.id, id));
}

/** The kitchen saw the edit: the ticket goes back to normal. */
export async function hearOrder(db: Db, id: string): Promise<Order> {
  const [row] = await db
    .update(schema.orders)
    .set({ editedAt: null })
    .where(eq(schema.orders.id, id))
    .returning();
  if (!row) throw new ApiError(404, 'not_found');
  return toOrder(row, await itemsFor(db, [row.id]));
}

export async function getOrder(db: Db, id: string): Promise<Order> {
  const [row] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  return toOrder(row, await itemsFor(db, [row.id]));
}

export async function listOrders(
  db: Db,
  filter: { scope: 'active' | 'done' | 'today' } | { from: string; to: string }
): Promise<Order[]> {
  // Done is today's completed and cancelled orders, the most recently
  // finished first. Today is every order of the day plus any still open.
  const done = 'scope' in filter && filter.scope === 'done';
  const active = eq(schema.orders.status, 'sent');
  const where =
    'from' in filter
      ? and(
          gte(schema.orders.businessDate, filter.from),
          lte(schema.orders.businessDate, filter.to)
        )
      : filter.scope === 'today'
        ? or(active, eq(schema.orders.businessDate, localDate()))
        : done
          ? and(
              eq(schema.orders.businessDate, localDate()),
              inArray(schema.orders.status, ['completed', 'cancelled'])
            )
          : active;
  const rows = await db
    .select()
    .from(schema.orders)
    .where(where)
    .orderBy(
      done
        ? desc(
            sql`coalesce(${schema.orders.completedAt}, ${schema.orders.cancelledAt})`
          )
        : asc(schema.orders.createdAt)
    );
  const items = await itemsFor(
    db,
    rows.map((r) => r.id)
  );
  return rows.map((r) => toOrder(r, items));
}

export async function updateOrderStatus(
  db: Db,
  id: string,
  to: OrderStatus,
  foodMade = false
): Promise<Order> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    if (!row) throw new ApiError(404, 'not_found');
    if (!canTransition(row.status, to)) {
      throw new ApiError(409, 'bad_transition', `${row.status} → ${to}`);
    }
    const now = new Date();
    const [updated] = await tx
      .update(schema.orders)
      .set({
        status: to,
        updatedAt: now,
        // Reopening clears how it finished, so sales and waste stop counting
        // the order until it finishes again.
        completedAt:
          to === 'completed' ? now : to === 'sent' ? null : row.completedAt,
        cancelledAt:
          to === 'cancelled' ? now : to === 'sent' ? null : row.cancelledAt,
        foodMade:
          to === 'cancelled' ? foodMade : to === 'sent' ? false : row.foodMade,
      })
      .where(
        and(eq(schema.orders.id, id), eq(schema.orders.status, row.status))
      )
      .returning();
    if (!updated) throw new ApiError(409, 'bad_transition');
    return toOrder(updated, await itemsFor(tx as unknown as Db, [id]));
  });
}

/** Names on past orders, most recent first, for the order page to suggest. */
export async function recentCustomers(db: Db): Promise<string[]> {
  const rows = await db
    .select({ name: schema.orders.customerName })
    .from(schema.orders)
    .where(isNotNull(schema.orders.customerName))
    .groupBy(schema.orders.customerName)
    .orderBy(desc(sql`max(${schema.orders.createdAt})`))
    .limit(50);
  return rows.flatMap((r) => (r.name ? [r.name] : []));
}
