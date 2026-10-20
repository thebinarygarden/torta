import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  categoryInput,
  categoryPatch,
  ingredientInput,
  ingredientPatch,
  itemInput,
  itemPatch,
  modifierGroupInput,
  modifierGroupPatch,
  modifierInput,
  modifierPatch,
} from '@torta/shared';
import { schema } from '../../db';
import {
  json,
  requireAdmin,
  requireAuth,
  type AppDeps,
  type AppEnv,
} from '../context';
import { getMenu } from '../menu';

export function menuRoutes({ db, broadcast }: AppDeps) {
  const app = new Hono<AppEnv>();
  const changed = () => broadcast({ type: 'menu.updated' });

  app.get('/menu', requireAuth, async (c) => c.json(await getMenu(db)));

  const admin = new Hono<AppEnv>().use(requireAdmin);

  admin.post('/categories', json(categoryInput), async (c) => {
    const [row] = await db
      .insert(schema.categories)
      .values(c.req.valid('json'))
      .returning();
    changed();
    return c.json(row, 201);
  });
  admin.patch('/categories/:id', json(categoryPatch), async (c) => {
    const [row] = await db
      .update(schema.categories)
      .set(c.req.valid('json'))
      .where(eq(schema.categories.id, c.req.param('id')))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json(row);
  });
  admin.delete('/categories/:id', async (c) => {
    const rows = await db
      .delete(schema.categories)
      .where(eq(schema.categories.id, c.req.param('id')))
      .returning();
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json({ ok: true });
  });

  admin.post('/items', json(itemInput), async (c) => {
    const [row] = await db
      .insert(schema.items)
      .values(c.req.valid('json'))
      .returning();
    changed();
    return c.json(row, 201);
  });
  admin.patch('/items/:id', json(itemPatch), async (c) => {
    const [row] = await db
      .update(schema.items)
      .set({ ...c.req.valid('json'), updatedAt: new Date() })
      .where(eq(schema.items.id, c.req.param('id')))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json(row);
  });
  admin.delete('/items/:id', async (c) => {
    const rows = await db
      .delete(schema.items)
      .where(eq(schema.items.id, c.req.param('id')))
      .returning();
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json({ ok: true });
  });

  admin.post(
    '/items/:id/modifier-groups',
    json(modifierGroupInput),
    async (c) => {
      const input = c.req.valid('json');
      if (input.minSelect > input.maxSelect) {
        return c.json({ error: 'invalid_input', message: 'min > max' }, 400);
      }
      const [row] = await db
        .insert(schema.modifierGroups)
        .values({ ...input, itemId: c.req.param('id') })
        .returning();
      changed();
      return c.json(row, 201);
    }
  );
  admin.patch('/modifier-groups/:id', json(modifierGroupPatch), async (c) => {
    const input = c.req.valid('json');
    const [row] = await db
      .update(schema.modifierGroups)
      .set(input)
      .where(eq(schema.modifierGroups.id, c.req.param('id')))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (row.minSelect > row.maxSelect) {
      // The partial update left min above max. Clamp min down so the group
      // stays valid.
      await db
        .update(schema.modifierGroups)
        .set({ minSelect: Math.min(row.minSelect, row.maxSelect) })
        .where(eq(schema.modifierGroups.id, row.id));
      return c.json({ error: 'invalid_input', message: 'min > max' }, 400);
    }
    changed();
    return c.json(row);
  });
  admin.delete('/modifier-groups/:id', async (c) => {
    const rows = await db
      .delete(schema.modifierGroups)
      .where(eq(schema.modifierGroups.id, c.req.param('id')))
      .returning();
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json({ ok: true });
  });

  admin.post(
    '/modifier-groups/:id/modifiers',
    json(modifierInput),
    async (c) => {
      const [row] = await db
        .insert(schema.modifiers)
        .values({ ...c.req.valid('json'), groupId: c.req.param('id') })
        .returning();
      changed();
      return c.json(row, 201);
    }
  );
  admin.patch('/modifiers/:id', json(modifierPatch), async (c) => {
    const [row] = await db
      .update(schema.modifiers)
      .set(c.req.valid('json'))
      .where(eq(schema.modifiers.id, c.req.param('id')))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json(row);
  });
  admin.delete('/modifiers/:id', async (c) => {
    const rows = await db
      .delete(schema.modifiers)
      .where(eq(schema.modifiers.id, c.req.param('id')))
      .returning();
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json({ ok: true });
  });

  const inventoryExists = async (id: string | null | undefined) =>
    !id ||
    (
      await db
        .select({ id: schema.inventoryItems.id })
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, id))
        .limit(1)
    ).length > 0;

  admin.post('/items/:id/ingredients', json(ingredientInput), async (c) => {
    const input = c.req.valid('json');
    if (!(await inventoryExists(input.inventoryItemId))) {
      return c.json({ error: 'not_found', message: 'inventory item' }, 404);
    }
    const [row] = await db
      .insert(schema.ingredients)
      .values({ ...input, itemId: c.req.param('id') })
      .returning();
    changed();
    return c.json(row, 201);
  });
  admin.patch('/ingredients/:id', json(ingredientPatch), async (c) => {
    const input = c.req.valid('json');
    const [existing] = await db
      .select()
      .from(schema.ingredients)
      .where(eq(schema.ingredients.id, c.req.param('id')))
      .limit(1);
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (!(await inventoryExists(input.inventoryItemId))) {
      return c.json({ error: 'not_found', message: 'inventory item' }, 404);
    }
    // A quantity only means something against stock, so unlinking drops it.
    const next = { ...existing, ...input };
    if (next.inventoryItemId == null) next.qty = null;
    const [row] = await db
      .update(schema.ingredients)
      .set({
        name: next.name,
        inventoryItemId: next.inventoryItemId,
        qty: next.qty,
        allowNone: next.allowNone,
        allowSide: next.allowSide,
        allowExtra: next.allowExtra,
        extraPriceCents: next.extraPriceCents,
        sortOrder: next.sortOrder,
      })
      .where(eq(schema.ingredients.id, existing.id))
      .returning();
    changed();
    return c.json(row);
  });
  admin.delete('/ingredients/:id', async (c) => {
    const rows = await db
      .delete(schema.ingredients)
      .where(eq(schema.ingredients.id, c.req.param('id')))
      .returning();
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    changed();
    return c.json({ ok: true });
  });

  app.route('/admin', admin);
  return app;
}
