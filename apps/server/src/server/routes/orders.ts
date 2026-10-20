import { Hono } from 'hono';
import { orderInput, orderStatusInput, pastOrderInput } from '@torta/shared';
import {
  json,
  requireAdmin,
  requireAuth,
  type AppDeps,
  type AppEnv,
} from '../context';
import { isIsoDate } from '../dates';
import {
  createOrder,
  deleteOrder,
  editOrder,
  getOrder,
  hearOrder,
  listOrders,
  recentCustomers,
  updateOrderStatus,
} from '../orders';

export function orderRoutes({ db, broadcast }: AppDeps) {
  // Scoped to /orders on purpose. A bare use() on a sub-app mounted at the root
  // would also guard every route mounted after it.
  const app = new Hono<AppEnv>()
    .use('/orders', requireAuth)
    .use('/orders/*', requireAuth)
    .use('/admin/orders', requireAdmin)
    .use('/admin/orders/*', requireAdmin);

  app.post('/orders', json(orderInput), async (c) => {
    const principal = c.get('principal');
    const order = await createOrder(db, c.req.valid('json'), {
      deviceId: principal?.kind === 'device' ? principal.deviceId : null,
    });
    broadcast({ type: 'order.created', order });
    return c.json(order, 201);
  });

  app.get('/orders', async (c) => {
    // One day as ?date=, or a range as ?from=&to=.
    const date = c.req.query('date');
    const from = c.req.query('from') ?? date;
    const to = c.req.query('to') ?? from;
    if (from !== undefined) {
      if (!isIsoDate(from) || !to || !isIsoDate(to) || from > to) {
        return c.json({ error: 'invalid_input', message: 'from/to' }, 400);
      }
      return c.json(await listOrders(db, { from, to }));
    }
    const q = c.req.query('scope');
    const scope = q === 'done' || q === 'today' ? q : 'active';
    return c.json(await listOrders(db, { scope }));
  });

  // Before /orders/:id, which would otherwise take "customers" as an id.
  app.get('/orders/customers', async (c) => c.json(await recentCustomers(db)));

  app.get('/orders/:id', async (c) =>
    c.json(await getOrder(db, c.req.param('id')))
  );

  app.put('/orders/:id', json(orderInput), async (c) => {
    const order = await editOrder(db, c.req.param('id'), c.req.valid('json'));
    broadcast({ type: 'order.updated', order });
    return c.json(order);
  });

  app.post('/orders/:id/heard', async (c) => {
    const order = await hearOrder(db, c.req.param('id'));
    broadcast({ type: 'order.updated', order });
    return c.json(order);
  });

  app.post('/orders/:id/status', json(orderStatusInput), async (c) => {
    const { status, foodMade } = c.req.valid('json');
    const order = await updateOrderStatus(
      db,
      c.req.param('id'),
      status,
      foodMade
    );
    broadcast({ type: 'order.updated', order });
    return c.json(order);
  });

  // The owner correcting sales: entering a past order, removing a test one.
  app.post('/admin/orders', json(pastOrderInput), async (c) => {
    const { at, ...input } = c.req.valid('json');
    const past = new Date(at);
    if (past > new Date()) {
      return c.json({ error: 'invalid_input', message: 'at' }, 400);
    }
    const order = await createOrder(db, input, { deviceId: null, past });
    broadcast({ type: 'order.created', order });
    return c.json(order, 201);
  });

  app.delete('/admin/orders/:id', async (c) => {
    const id = c.req.param('id');
    await deleteOrder(db, id);
    broadcast({ type: 'order.deleted', id });
    return c.json({ ok: true });
  });

  return app;
}
