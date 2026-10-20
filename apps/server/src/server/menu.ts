import { asc } from 'drizzle-orm';
import type { Category, Item, Menu, ModifierGroup } from '@torta/shared';
import type { Db } from '../db';
import { schema } from '../db';

export async function getMenu(db: Db): Promise<Menu> {
  const [cats, its, groups, mods, ings] = await Promise.all([
    db
      .select()
      .from(schema.categories)
      .orderBy(
        asc(schema.categories.sortOrder),
        asc(schema.categories.createdAt)
      ),
    db
      .select()
      .from(schema.items)
      .orderBy(asc(schema.items.sortOrder), asc(schema.items.createdAt)),
    db
      .select()
      .from(schema.modifierGroups)
      .orderBy(asc(schema.modifierGroups.sortOrder)),
    db.select().from(schema.modifiers).orderBy(asc(schema.modifiers.sortOrder)),
    db
      .select()
      .from(schema.ingredients)
      .orderBy(asc(schema.ingredients.sortOrder)),
  ]);

  const groupsById = new Map<string, ModifierGroup>();
  for (const g of groups) {
    groupsById.set(g.id, {
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sortOrder: g.sortOrder,
      modifiers: [],
    });
  }
  for (const m of mods) {
    groupsById.get(m.groupId)?.modifiers.push({
      id: m.id,
      name: m.name,
      priceCents: m.priceCents,
      sortOrder: m.sortOrder,
    });
  }

  const itemsById = new Map<string, Item>();
  for (const i of its) {
    itemsById.set(i.id, {
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      priceCents: i.priceCents,
      available: i.available,
      sortOrder: i.sortOrder,
      modifierGroups: [],
      ingredients: [],
    });
  }
  for (const ing of ings) {
    itemsById.get(ing.itemId)?.ingredients.push({
      id: ing.id,
      name: ing.name,
      inventoryItemId: ing.inventoryItemId,
      qty: ing.qty,
      allowNone: ing.allowNone,
      allowSide: ing.allowSide,
      allowExtra: ing.allowExtra,
      extraPriceCents: ing.extraPriceCents,
      sortOrder: ing.sortOrder,
    });
  }
  for (const g of groups) {
    const group = groupsById.get(g.id);
    if (group) itemsById.get(g.itemId)?.modifierGroups.push(group);
  }

  const categories: Category[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    items: [],
  }));
  const catsById = new Map(categories.map((c) => [c.id, c]));
  for (const i of its) {
    const item = itemsById.get(i.id);
    if (item) catsById.get(i.categoryId)?.items.push(item);
  }
  return { categories };
}
