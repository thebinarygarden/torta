import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  Currency,
  Kind,
  LiquidUnit,
  OrderModifier,
  OrderIngredient,
  WeightUnit,
} from '@torta/shared';

/**
 * What one order line used from inventory, in base units, with its cost at the
 * time of the order. Server-side only; sales reads it.
 */
export type OrderUsage = {
  inventoryItemId: string;
  name: string;
  kind: Kind;
  qty: number;
  costCents: number;
};

export const orderStatusEnum = pgEnum('order_status', [
  'sent',
  'completed',
  'cancelled',
]);

const id = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').defaultNow().notNull();

export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    restaurantName: text('restaurant_name').notNull(),
    adminPasswordHash: text('admin_password_hash').notNull(),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    // Off keeps the rate, so turning tax back on restores it.
    taxEnabled: boolean('tax_enabled').notNull().default(true),
    currency: text('currency').$type<Currency>().notNull().default('USD'),
    weightUnit: text('weight_unit').$type<WeightUnit>().notNull().default('g'),
    liquidUnit: text('liquid_unit').$type<LiquidUnit>().notNull().default('ml'),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    // Optional link to a Binary Garden account. torta never needs it to run.
    bgUserId: text('bg_user_id'),
    bgEmail: text('bg_email'),
    bgLinkedAt: ts('bg_linked_at'),
  },
  (t) => [check('settings_single_row', sql`${t.id} = 1`)]
);

export const categories = pgTable('categories', {
  id: id(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const items = pgTable('items', {
  id: id(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  available: boolean('available').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

export const modifierGroups = pgTable('modifier_groups', {
  id: id(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  minSelect: integer('min_select').notNull().default(0),
  maxSelect: integer('max_select').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const modifiers = pgTable('modifiers', {
  id: id(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => modifierGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});

// Amounts are in base units: grams, millilitres or a count.
export const inventoryItems = pgTable('inventory_items', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind').$type<Kind>().notNull(),
  barcode: text('barcode').unique(),
  packSize: doublePrecision('pack_size').notNull(),
  packCostCents: integer('pack_cost_cents').notNull(),
  onHand: doublePrecision('on_hand').notNull().default(0),
  countedAt: ts('counted_at').defaultNow().notNull(),
  createdAt: createdAt(),
});

export const ingredients = pgTable('ingredients', {
  id: id(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  inventoryItemId: uuid('inventory_item_id').references(
    () => inventoryItems.id,
    { onDelete: 'set null' }
  ),
  qty: doublePrecision('qty'),
  allowNone: boolean('allow_none').notNull().default(true),
  allowSide: boolean('allow_side').notNull().default(true),
  allowExtra: boolean('allow_extra').notNull().default(false),
  extraPriceCents: integer('extra_price_cents').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const devices = pgTable('devices', {
  id: id(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: createdAt(),
  lastSeenAt: ts('last_seen_at'),
  revokedAt: ts('revoked_at'),
});

export const pairingCodes = pgTable('pairing_codes', {
  id: id(),
  code: char('code', { length: 6 }).notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  deviceId: uuid('device_id').references(() => devices.id),
  createdAt: createdAt(),
});

export const orders = pgTable(
  'orders',
  {
    id: id(),
    businessDate: date('business_date').notNull(),
    orderNumber: integer('order_number').notNull(),
    status: orderStatusEnum('status').notNull().default('sent'),
    deviceId: uuid('device_id').references(() => devices.id),
    notes: text('notes'),
    customerName: text('customer_name'),
    subtotalCents: integer('subtotal_cents').notNull(),
    taxRateBps: integer('tax_rate_bps').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    foodMade: boolean('food_made').notNull().default(false),
    // Set when an open order is edited, cleared when the kitchen hears it.
    editedAt: ts('edited_at'),
    // A staff meal: cooked and counted in inventory, but charged nothing.
    employeeMeal: boolean('employee_meal').notNull().default(false),
  },
  (t) => [uniqueIndex('orders_date_number').on(t.businessDate, t.orderNumber)]
);

export const orderItems = pgTable('order_items', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  qty: integer('qty').notNull(),
  notes: text('notes'),
  modifiers: jsonb('modifiers').$type<OrderModifier[]>().notNull().default([]),
  ingredients: jsonb('ingredients')
    .$type<OrderIngredient[]>()
    .notNull()
    .default([]),
  usage: jsonb('usage').$type<OrderUsage[]>().notNull().default([]),
  lineTotalCents: integer('line_total_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});
