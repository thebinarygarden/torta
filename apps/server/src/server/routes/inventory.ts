import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { inventoryInput, inventoryPatch } from '@torta/shared';
import { schema } from '../../db';
import { json, requireAdmin, type AppDeps, type AppEnv } from '../context';
import { listInventory, lookupBarcode } from '../inventory';

export function inventoryRoutes({ db, broadcast, version }: AppDeps) {
  // Scoped to /admin/inventory; see the note in routes/orders.ts.
  const app = new Hono<AppEnv>()
    .use('/admin/inventory', requireAdmin)
    .use('/admin/inventory/*', requireAdmin);

  const one = async (id: string) =>
    (await listInventory(db)).find((i) => i.id === id);

  const barcodeTaken = async (
    barcode: string | null | undefined,
    id?: string
  ) =>
    !!barcode &&
    (
      await db
        .select({ id: schema.inventoryItems.id })
        .from(schema.inventoryItems)
        .where(
          and(
            eq(schema.inventoryItems.barcode, barcode),
            id ? ne(schema.inventoryItems.id, id) : undefined
          )
        )
        .limit(1)
    ).length > 0;

  app.get('/admin/inventory', async (c) => c.json(await listInventory(db)));

  app.get('/admin/inventory/barcode/:code', async (c) =>
    c.json(await lookupBarcode(db, c.req.param('code'), version))
  );

  app.post('/admin/inventory', json(inventoryInput), async (c) => {
    if (await barcodeTaken(c.req.valid('json').barcode)) {
      return c.json({ error: 'barcode_taken' }, 409);
    }
    const [row] = await db
      .insert(schema.inventoryItems)
      .values(c.req.valid('json'))
      .returning();
    return c.json(await one(row!.id), 201);
  });

  app.patch('/admin/inventory/:id', json(inventoryPatch), async (c) => {
    const input = c.req.valid('json');
    if (await barcodeTaken(input.barcode, c.req.param('id'))) {
      return c.json({ error: 'barcode_taken' }, 409);
    }
    const [row] = await db
      .update(schema.inventoryItems)
      // Setting what's on hand is a fresh count: usage is measured from now.
      .set(
        input.onHand === undefined ? input : { ...input, countedAt: new Date() }
      )
      .where(eq(schema.inventoryItems.id, c.req.param('id')))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(await one(row.id));
  });

  app.delete('/admin/inventory/:id', async (c) => {
    const id = c.req.param('id');
    const rows = await db.transaction(async (tx) => {
      // The foreign key unlinks ingredients; their quantities go with it.
      await tx
        .update(schema.ingredients)
        .set({ qty: null })
        .where(eq(schema.ingredients.inventoryItemId, id));
      return tx
        .delete(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, id))
        .returning();
    });
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
    broadcast({ type: 'menu.updated' });
    return c.json({ ok: true });
  });

  return app;
}
