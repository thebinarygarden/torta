import { z } from 'zod';

const name = z.string().trim().min(1).max(80);
const cents = z.number().int().min(0).max(1_000_000);
const sortOrder = z.number().int().min(0).optional();

export const categoryInput = z.object({ name, sortOrder });
export const categoryPatch = categoryInput.partial();

export const itemInput = z.object({
  categoryId: z.uuid(),
  name,
  priceCents: cents,
  available: z.boolean().optional(),
  sortOrder,
});
export const itemPatch = itemInput.partial();

export const modifierGroupInput = z.object({
  name,
  minSelect: z.number().int().min(0).max(20).default(0),
  maxSelect: z.number().int().min(1).max(20).default(1),
  sortOrder,
});
export const modifierGroupPatch = modifierGroupInput.partial();

export const modifierInput = z.object({
  name,
  priceCents: cents.default(0),
  sortOrder,
});
export const modifierPatch = modifierInput.partial();

// `qty` is in base units (see units.ts) and needs a linked inventory item.
// Regular is always offered; the owner picks which other choices servers get.
const ingredient = z.object({
  name,
  inventoryItemId: z.uuid().nullable().optional(),
  qty: z.number().positive().max(1_000_000).nullable().optional(),
  allowNone: z.boolean().optional(),
  allowSide: z.boolean().optional(),
  allowExtra: z.boolean().optional(),
  extraPriceCents: cents.optional(),
  sortOrder,
});
export const ingredientInput = ingredient.refine(
  (i) => i.qty == null || i.inventoryItemId != null,
  { message: 'qty needs an inventory item', path: ['qty'] }
);
// The server checks the merged row, since a patch may carry only one of them.
export const ingredientPatch = ingredient.partial();

/**
 * The menu as served to every surface, nested as categories → items →
 * modifier groups → modifiers.
 */
export type Modifier = {
  id: string;
  name: string;
  priceCents: number;
  sortOrder: number;
};

export type ModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  modifiers: Modifier[];
};

export type Ingredient = {
  id: string;
  name: string;
  inventoryItemId: string | null;
  qty: number | null;
  allowNone: boolean;
  allowSide: boolean;
  allowExtra: boolean;
  extraPriceCents: number;
  sortOrder: number;
};

export type Item = {
  id: string;
  categoryId: string;
  name: string;
  priceCents: number;
  available: boolean;
  sortOrder: number;
  modifierGroups: ModifierGroup[];
  ingredients: Ingredient[];
};

export type Category = {
  id: string;
  name: string;
  sortOrder: number;
  items: Item[];
};

export type Menu = { categories: Category[] };
