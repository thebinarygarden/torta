import { z } from 'zod';
import { kind, type Kind } from './units';

const amount = z.number().min(0).max(1_000_000_000);

export const inventoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind,
  barcode: z.string().trim().min(1).max(64).nullable().optional(),
  // Amounts are in base units (g, ml or each); see units.ts.
  packSize: amount.positive(),
  packCostCents: z.number().int().min(0).max(100_000_000),
  onHand: amount,
});
export const inventoryPatch = inventoryInput.partial();

export type InventoryItem = {
  id: string;
  name: string;
  kind: Kind;
  barcode: string | null;
  packSize: number;
  packCostCents: number;
  /** What the owner counted at `countedAt`. */
  onHand: number;
  countedAt: string;
  /** `onHand` minus what completed orders used since `countedAt`. */
  expectedLeft: number;
};

export type BarcodeLookup = {
  match?: InventoryItem;
  suggestion?: { name: string; kind?: Kind; packSize?: number };
};
