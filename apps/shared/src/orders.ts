import { z } from 'zod';

export const orderStatus = z.enum(['sent', 'completed', 'cancelled']);
export type OrderStatus = z.infer<typeof orderStatus>;

/** An order the kitchen still has to make. */
export const isActive = (o: { status: OrderStatus }) => o.status === 'sent';

// The kitchen completes or cancels an open order in one step. A finished order
// can be reopened by mistake.
const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  sent: ['completed', 'cancelled'],
  completed: ['sent'],
  cancelled: ['sent'],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

const notes = z.string().trim().max(200).optional();

/** How an ingredient is served when it isn't the regular way. */
export const ingredientChoice = z.enum(['none', 'side', 'extra']);
export type IngredientChoice = z.infer<typeof ingredientChoice>;

export const orderItemInput = z.object({
  itemId: z.uuid(),
  qty: z.number().int().min(1).max(99),
  notes,
  modifierIds: z.array(z.uuid()).max(40).default([]),
  // Only ingredients served differently from regular are listed.
  ingredientChoices: z
    .array(z.object({ id: z.uuid(), choice: ingredientChoice }))
    .max(40)
    .default([]),
});

export const orderInput = z.object({
  notes,
  // Optional, so the kitchen can call an order by name instead of number.
  customerName: z.string().trim().max(60).optional(),
  items: z.array(orderItemInput).min(1).max(100),
  // Cooked and taken from inventory like any order, but charged nothing.
  employeeMeal: z.boolean().optional(),
});

/** An order the owner enters after the fact, at the time it happened. */
export const pastOrderInput = orderInput.extend({ at: z.iso.datetime() });

export const orderStatusInput = z.object({
  status: orderStatus,
  // Cancelling after the food was made still uses up its ingredients.
  foodMade: z.boolean().optional(),
});

export type OrderInput = z.infer<typeof orderInput>;

export type OrderModifier = { id: string; name: string; priceCents: number };
/** An ingredient served differently from regular: none, on the side, extra. */
export type OrderIngredient = {
  id: string;
  name: string;
  choice: IngredientChoice;
  priceCents: number;
};

export type OrderItem = {
  id: string;
  itemId: string | null;
  name: string;
  priceCents: number;
  qty: number;
  notes: string | null;
  modifiers: OrderModifier[];
  ingredients: OrderIngredient[];
  lineTotalCents: number;
  sortOrder: number;
};

export type Order = {
  id: string;
  businessDate: string;
  orderNumber: number;
  status: OrderStatus;
  notes: string | null;
  customerName: string | null;
  deviceId: string | null;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Cancelled after the kitchen made it, so inventory counts it as used. */
  foodMade: boolean;
  /** Edited since the kitchen last heard it. */
  editedAt: string | null;
  /** A staff meal: everything on it is priced at zero. */
  employeeMeal: boolean;
  items: OrderItem[];
};
