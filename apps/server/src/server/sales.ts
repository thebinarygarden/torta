import { and, gte, inArray, lte } from 'drizzle-orm';
import type { SalesSummary } from '@torta/shared';
import type { Db } from '../db';
import { schema } from '../db';
import { foodUsed } from './inventory';

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
  for (const i of items) {
    for (const u of i.usage) {
      if (cancelled.has(i.orderId)) summary.wasteCents += u.costCents;
      else summary.costCents += u.costCents;
    }
  }

  return summary;
}
