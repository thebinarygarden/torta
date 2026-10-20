import { z } from 'zod';
import {
  currency,
  liquidUnit,
  weightUnit,
  type Currency,
  type Kind,
  type LiquidUnit,
  type WeightUnit,
} from './units';

const restaurantName = z.string().trim().min(1).max(80);
const password = z.string().min(8).max(200);

export const setupInput = z.object({ restaurantName, password });
export const loginInput = z.object({ password });

export const settingsPatch = z.object({
  restaurantName: restaurantName.optional(),
  taxRateBps: z.number().int().min(0).max(10_000).optional(),
  taxEnabled: z.boolean().optional(),
  currency: currency.optional(),
  weightUnit: weightUnit.optional(),
  liquidUnit: liquidUnit.optional(),
  autoUpdate: z.boolean().optional(),
});

export const passwordInput = z.object({ current: password, next: password });

export type Settings = {
  restaurantName: string;
  taxRateBps: number;
  /** Off charges no tax but keeps taxRateBps for when it comes back on. */
  taxEnabled: boolean;
  currency: Currency;
  weightUnit: WeightUnit;
  liquidUnit: LiquidUnit;
  /** Download new versions in the background. Installed app only. */
  autoUpdate: boolean;
};

export type SalesSummary = {
  from: string;
  to: string;
  orders: number;
  /** Completed staff meals: free, but their food still counts as cost. */
  employeeMeals: number;
  grossCents: number;
  subtotalCents: number;
  taxCents: number;
  /** What the food cost, from linked ingredients. 0 without inventory. */
  costCents: number;
  /** Food made for orders that were then cancelled. */
  wasteCents: number;
  usage: {
    inventoryItemId: string;
    name: string;
    kind: Kind;
    qty: number;
    costCents: number;
    expectedLeft: number | null;
  }[];
};
