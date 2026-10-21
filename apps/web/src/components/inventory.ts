import type { BarcodeLookup, InventoryItem } from '@torta/shared';
import { get } from '../api/http';

/** A barcode or #code: a local item, a product found online, or nothing. */
export const lookup = (code: string) =>
  get<BarcodeLookup>(
    `/admin/inventory/lookup/${encodeURIComponent(code.trim())}`
  ).catch((): BarcodeLookup => ({}));

/** What `qty` of an item costs at its price. */
export const packPrice = (qty: number, item: InventoryItem) =>
  Math.round((qty * item.packCostCents) / item.packSize);

/** Finds an item by its barcode or its #code, as a scanner or a person types it. */
export function findByCode(items: InventoryItem[], raw: string) {
  const code = raw.trim();
  if (!code) return undefined;
  return (
    items.find((i) => i.barcode === code) ??
    (/^#?\d{1,9}$/.test(code)
      ? items.find((i) => i.code === Number(code.replace('#', '')))
      : undefined)
  );
}

/** Rows whose name or #code contains what was typed. */
export const matches = (item: InventoryItem, query: string) => {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    item.name.toLowerCase().includes(q) ||
    `#${item.code}`.startsWith(q) ||
    String(item.code) === q
  );
};
