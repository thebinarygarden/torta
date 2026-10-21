import { z } from 'zod';
import { kind, type Kind } from './units';

const amount = z.number().min(0).max(1_000_000_000);
const cents = z.number().int().min(0).max(100_000_000);

export const inventoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind,
  barcode: z.string().trim().min(1).max(64).nullable().optional(),
  // Amounts are in base units (g, ml or each); see units.ts.
  packSize: amount.positive(),
  packCostCents: cents,
});
export const inventoryPatch = inventoryInput.partial();

/**
 * Stock is a ledger: what came in (received) and what the shelf held when
 * someone looked (counted). What is on hand now is worked out from it.
 */
export const entryKind = z.enum(['received', 'counted']);
export type EntryKind = z.infer<typeof entryKind>;

export const entryInput = z
  .object({
    inventoryItemId: z.uuid(),
    kind: entryKind,
    /** Defaults to today. One line per item, kind and day: saving replaces. */
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    qty: amount,
    /** What a delivery cost. Defaults to the item's price. Received only. */
    costCents: cents.optional(),
  })
  .refine((e) => e.kind !== 'received' || e.qty > 0, {
    message: 'received needs an amount',
    path: ['qty'],
  });

export type InventoryItem = {
  id: string;
  /** A short number every item has, barcode or not. Shown as #42. */
  code: number;
  name: string;
  kind: Kind;
  barcode: string | null;
  packSize: number;
  packCostCents: number;
  /** The latest count, plus what came in and minus what sales used since. */
  expectedLeft: number;
  /** What that is worth at the item's price. */
  valueCents: number;
  /**
   * The latest count and how far it was from what was expected. The first
   * count ever has nothing to compare with, so its diff is null.
   */
  lastCount: { qty: number; at: string; diff: number | null } | null;
};

export type InventoryEntry = {
  id: string;
  inventoryItemId: string;
  code: number;
  name: string;
  kind: Kind;
  entry: EntryKind;
  qty: number;
  costCents: number;
  /** Counted only: what was expected on the shelf at the time. Null for the first count. */
  expected: number | null;
  businessDate: string;
  createdAt: string;
};

export type InventoryHistory = {
  from: string;
  to: string;
  items: {
    inventoryItemId: string;
    code: number;
    name: string;
    kind: Kind;
    receivedQty: number;
    receivedCents: number;
    usedQty: number;
    usedCents: number;
    /** Counted minus expected, summed over the period's counts. */
    diff: number | null;
    diffCents: number | null;
  }[];
  entries: InventoryEntry[];
  totals: { receivedCents: number; usedCents: number; diffCents: number };
};

export type BarcodeLookup = {
  match?: InventoryItem;
  suggestion?: { name: string; kind?: Kind; packSize?: number };
};
