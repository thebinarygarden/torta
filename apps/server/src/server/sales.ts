import { and, gte, inArray, lte } from 'drizzle-orm';
import type { SalesSummary } from '@torta/shared';
import type { Db } from '../db';
import { schema } from '../db';
import { foodUsed, listInventory } from './inventory';

export async function salesSummary(
  db: Db,
  from: string,
  to: string
): Promise<SalesSummary> {
  // Completed orders, plus cancelled ones whose food was made: those count
  // toward ingredient cost (as waste) but not revenue.
  const used = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        foodUsed,
        gte(schema.orders.businessDate, from),
        lte(schema.orders.businessDate, to)
      )
    );
  const rows = used.filter((r) => r.status === 'completed');
  const summary: SalesSummary = {
    from,
    to,
    // Paying orders; staff meals are counted on their own.
    orders: rows.filter((r) => !r.employeeMeal).length,
    employeeMeals: rows.filter((r) => r.employeeMeal).length,
    grossCents: 0,
    subtotalCents: 0,
    taxCents: 0,
    costCents: 0,
    wasteCents: 0,
    usage: [],
  };
  for (const r of rows) {
    summary.grossCents += r.totalCents;
    summary.subtotalCents += r.subtotalCents;
    summary.taxCents += r.taxCents;
  }
  if (used.length === 0) return summary;

  const items = await db
    .select()
    .from(schema.orderItems)
    .where(
      inArray(
        schema.orderItems.orderId,
        used.map((r) => r.id)
      )
    );
  const cancelled = new Set(
    used.filter((r) => r.status === 'cancelled').map((r) => r.id)
  );
  const byInventory = new Map<string, SalesSummary['usage'][number]>();
  for (const i of items) {
    for (const u of i.usage) {
      if (cancelled.has(i.orderId)) summary.wasteCents += u.costCents;
      else summary.costCents += u.costCents;
      const t = byInventory.get(u.inventoryItemId) ?? {
        inventoryItemId: u.inventoryItemId,
        name: u.name,
        kind: u.kind,
        qty: 0,
        costCents: 0,
        expectedLeft: null,
      };
      t.qty += u.qty;
      t.costCents += u.costCents;
      byInventory.set(u.inventoryItemId, t);
    }
  }
  if (byInventory.size > 0) {
    for (const inv of await listInventory(db)) {
      const t = byInventory.get(inv.id);
      if (t) t.expectedLeft = inv.expectedLeft;
    }
    summary.usage = [...byInventory.values()].sort(
      (a, b) => b.costCents - a.costCents
    );
  }

  return summary;
}
