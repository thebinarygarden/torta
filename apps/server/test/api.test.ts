import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { client, makeApp, seedMenu, setup } from './helpers';

const ctx = await makeApp();
afterAll(() => ctx.close());

describe('setup and sessions', () => {
  test('health and setup state before setup', async () => {
    const health = await (await ctx.app.request('/api/health')).json();
    expect(health).toMatchObject({
      ok: true,
      version: 'test',
      restaurantName: null,
    });
    const s = await (await ctx.app.request('/api/setup')).json();
    expect(s).toEqual({ needsSetup: true });
  });

  test('protected routes refuse anonymous callers', async () => {
    expect((await ctx.app.request('/api/menu')).status).toBe(401);
    expect((await ctx.app.request('/api/admin/settings')).status).toBe(401);
  });

  test('setup creates the restaurant and logs the admin in', async () => {
    const { res, cookie } = await setup(ctx.app);
    expect(res.status).toBe(201);
    expect(cookie).toMatch(/^torta_admin=/);
    const me = await client(ctx.app, cookie).get('/me');
    expect(me.body).toEqual({ kind: 'admin' });
  });

  test('setup cannot run twice', async () => {
    expect((await setup(ctx.app)).res.status).toBe(409);
  });

  test('login rejects a wrong password and accepts the right one', async () => {
    const bad = await client(ctx.app, '').post('/admin/login', {
      password: 'nope nope',
    });
    expect(bad.status).toBe(401);
    const ok = await ctx.app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse' }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/^torta_admin=/);
  });

  test('logout ends the session', async () => {
    const { cookie } = await (async () => {
      const res = await ctx.app.request('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'correct horse' }),
      });
      return { cookie: res.headers.get('set-cookie')!.split(';')[0]! };
    })();
    const api = client(ctx.app, cookie);
    expect((await api.get('/me')).status).toBe(200);
    await api.post('/admin/logout');
    expect((await api.get('/me')).status).toBe(401);
  });
});

describe('menu, orders and sales', () => {
  let api: ReturnType<typeof client>;
  let menu: Awaited<ReturnType<typeof seedMenu>>;

  beforeAll(async () => {
    const res = await ctx.app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse' }),
    });
    api = client(ctx.app, res.headers.get('set-cookie')!.split(';')[0]!);
    menu = await seedMenu(api);
  });

  test('menu is nested and each change broadcasts', async () => {
    const { body } = await api.get('/menu');
    expect(body.categories).toHaveLength(1);
    const [cat] = body.categories;
    expect(cat.items.map((i: { name: string }) => i.name)).toEqual([
      'taco',
      'agua fresca',
    ]);
    expect(
      cat.items[0].modifierGroups.map((g: { name: string }) => g.name)
    ).toEqual(['protein', 'extras']);
    expect(
      ctx.events.filter((e) => e.type === 'menu.updated').length
    ).toBeGreaterThan(5);
  });

  test('invalid input is a 400 with issues', async () => {
    const res = await api.post('/admin/items', {
      categoryId: 'nope',
      name: '',
      priceCents: -1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  test('a modifier group cannot have min > max', async () => {
    const res = await api.post(`/admin/items/${menu.taco.id}/modifier-groups`, {
      name: 'broken',
      minSelect: 3,
      maxSelect: 1,
    });
    expect(res.status).toBe(400);
  });

  test('orders are priced server-side with tax and a daily number', async () => {
    await api.patch('/admin/settings', { taxRateBps: 825 });
    const res = await api.post('/orders', {
      items: [
        {
          itemId: menu.taco.id,
          qty: 2,
          modifierIds: [menu.asada.id, menu.guac.id],
        },
        { itemId: menu.agua.id, qty: 1, modifierIds: [] },
      ],
    });
    expect(res.status).toBe(201);
    const order = res.body;
    expect(order.orderNumber).toBe(1);
    expect(order.status).toBe('sent');
    // (350 + 100) * 2 + 300
    expect(order.subtotalCents).toBe(1200);
    expect(order.taxCents).toBe(99);
    expect(order.totalCents).toBe(1299);
    expect(
      order.items[0].modifiers.map((m: { name: string }) => m.name)
    ).toEqual(['asada', 'guac']);
    expect(ctx.events.at(-1)).toMatchObject({
      type: 'order.created',
      order: { id: order.id },
    });

    const second = await api.post('/orders', {
      items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }],
    });
    expect(second.body.orderNumber).toBe(2);
  });

  test('modifier rules are enforced', async () => {
    const missing = await api.post('/orders', {
      items: [{ itemId: menu.taco.id, qty: 1, modifierIds: [] }],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('modifier_count');

    const foreign = await api.post('/orders', {
      items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [menu.asada.id] }],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe('unknown_modifier');
  });

  test('unavailable items cannot be ordered', async () => {
    await api.patch(`/admin/items/${menu.agua.id}`, { available: false });
    const res = await api.post('/orders', {
      items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }],
    });
    expect(res.status).toBe(409);
    await api.patch(`/admin/items/${menu.agua.id}`, { available: true });
  });

  test('status walks the state machine and rejects bad moves', async () => {
    const [order] = (await api.get('/orders')).body;
    const bad = await api.post(`/orders/${order.id}/status`, {
      status: 'sent',
    });
    expect(bad.status).toBe(409);
    const res = await api.post(`/orders/${order.id}/status`, {
      status: 'completed',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(ctx.events.at(-1)).toMatchObject({
      type: 'order.updated',
      order: { status: 'completed' },
    });
    const active = (await api.get('/orders')).body;
    expect(active.map((o: { orderNumber: number }) => o.orderNumber)).toEqual([
      2,
    ]);
  });

  test('sales summarise completed orders for a date range', async () => {
    const { body } = await api.get('/admin/sales');
    expect(body.orders).toBe(1);
    expect(body.grossCents).toBe(1299);
    expect(body.taxCents).toBe(99);
    expect(
      (await api.get('/admin/sales?from=2020-01-01&to=2020-01-02')).body.orders
    ).toBe(0);
    expect((await api.get('/admin/sales?from=2020-13-01')).status).toBe(400);
  });

  test('the kitchen completes in one step and can reopen by mistake', async () => {
    const order = (
      await api.post('/orders', {
        items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }],
      })
    ).body;
    const done = await api.post(`/orders/${order.id}/status`, {
      status: 'completed',
    });
    expect(done.body.status).toBe('completed');
    const today = (await api.get('/orders?scope=done')).body;
    expect(today.map((o: { id: string }) => o.id)).toContain(order.id);
    // Done is what the kitchen finished today: completed or cancelled.
    expect(
      today.every((o: { status: string }) =>
        ['completed', 'cancelled'].includes(o.status)
      )
    ).toBe(true);
    expect((await api.get('/admin/sales')).body.orders).toBe(2);

    const reopened = await api.post(`/orders/${order.id}/status`, {
      status: 'sent',
    });
    expect(reopened.body).toMatchObject({ status: 'sent', completedAt: null });
    const active = (await api.get('/orders')).body;
    expect(active.map((o: { id: string }) => o.id)).toContain(order.id);
    expect((await api.get('/admin/sales')).body.orders).toBe(1);
    await api.post(`/orders/${order.id}/status`, { status: 'cancelled' });
    const after = (await api.get('/orders?scope=done')).body;
    expect(after.find((o: { id: string }) => o.id === order.id)?.status).toBe(
      'cancelled'
    );

    // A cancelled order can come back too, no longer counted as made.
    await api.post(`/orders/${order.id}/status`, { status: 'sent' });
    await api.post(`/orders/${order.id}/status`, {
      status: 'cancelled',
      foodMade: true,
    });
    const back = await api.post(`/orders/${order.id}/status`, {
      status: 'sent',
    });
    expect(back.body).toMatchObject({
      status: 'sent',
      cancelledAt: null,
      foodMade: false,
    });
    await api.post(`/orders/${order.id}/status`, { status: 'cancelled' });
  });

  test('an open order can be edited until the kitchen hears it', async () => {
    const order = (
      await api.post('/orders', {
        items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }],
      })
    ).body;
    expect(order.editedAt).toBeNull();
    const edit = {
      items: [
        { itemId: menu.agua.id, qty: 3, modifierIds: [] },
        { itemId: menu.taco.id, qty: 1, modifierIds: [menu.asada.id] },
      ],
    };
    ctx.events.length = 0;
    // A price the client made up is ignored; the server prices the menu.
    const res = await api.put(`/orders/${order.id}`, {
      ...edit,
      subtotalCents: 1,
    });
    expect(res.status).toBe(200);
    const edited = res.body;
    expect(edited).toMatchObject({
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
    });
    expect(edited.editedAt).not.toBeNull();
    expect(edited.items.map((i: { qty: number }) => i.qty)).toEqual([3, 1]);
    const same = (await api.post('/orders', edit)).body;
    expect(edited.subtotalCents).toBe(same.subtotalCents);
    expect(ctx.events).toContainEqual({ type: 'order.updated', order: edited });

    const heard = await api.post(`/orders/${order.id}/heard`, {});
    expect(heard.body.editedAt).toBeNull();

    for (const o of [order, same]) {
      await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
    }
    const late = await api.put(`/orders/${order.id}`, edit);
    expect(late.status).toBe(409);
  });

  test('orders can carry a customer name, and past names are suggested', async () => {
    const named = async (customerName?: string) =>
      (
        await api.post('/orders', {
          customerName,
          items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }],
        })
      ).body;
    const maria = await named('  Maria ');
    expect(maria.customerName).toBe('Maria');
    expect((await named()).customerName).toBeNull();
    const again = await named('Maria');
    await named('Ana');
    const names = (await api.get('/orders/customers')).body;
    expect([...names].sort()).toEqual(['Ana', 'Maria']);

    // An edit can add or change the name.
    const edited = await api.put(`/orders/${again.id}`, {
      customerName: 'Mariana',
      items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }],
    });
    expect(edited.body.customerName).toBe('Mariana');
    for (const o of (await api.get('/orders')).body) {
      await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
    }
  });

  test('turning tax off charges none and keeps the rate', async () => {
    const agua = { items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }] };
    const off = await api.patch('/admin/settings', { taxEnabled: false });
    expect(off.body).toMatchObject({ taxEnabled: false, taxRateBps: 825 });
    expect((await api.get('/health')).body.taxEnabled).toBe(false);
    const untaxed = (await api.post('/orders', agua)).body;
    expect(untaxed).toMatchObject({
      taxRateBps: 0,
      taxCents: 0,
      totalCents: 300,
    });

    await api.patch('/admin/settings', { taxEnabled: true });
    const taxed = (await api.post('/orders', agua)).body;
    expect(taxed).toMatchObject({ taxRateBps: 825, taxCents: 25 });
    for (const o of [untaxed, taxed]) {
      await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
    }
  });

  test("today's orders list open and finished ones; a range lists any", async () => {
    const agua = { items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }] };
    const open = (await api.post('/orders', agua)).body;
    const done = (await api.post('/orders', agua)).body;
    await api.post(`/orders/${done.id}/status`, { status: 'completed' });

    const today = (await api.get('/orders?scope=today')).body;
    const ids = today.map((o: { id: string }) => o.id);
    expect(ids).toContain(open.id);
    expect(ids).toContain(done.id);
    expect(
      (await api.get('/orders')).body.map((o: { id: string }) => o.id)
    ).not.toContain(done.id);

    const date = open.businessDate;
    const range = (await api.get(`/orders?from=${date}&to=${date}`)).body;
    expect(range).toHaveLength(today.length);
    expect(
      (await api.get('/orders?from=2020-01-01&to=2020-01-02')).body
    ).toEqual([]);
    expect((await api.get(`/orders?from=${date}&to=2020-01-01`)).status).toBe(
      400
    );
    await api.post(`/orders/${open.id}/status`, { status: 'cancelled' });
  });

  test('settings and password change', async () => {
    const s = await api.patch('/admin/settings', {
      restaurantName: 'la torta 2',
      currency: 'MXN',
    });
    expect(s.body).toEqual({
      restaurantName: 'la torta 2',
      taxRateBps: 825,
      taxEnabled: true,
      currency: 'MXN',
      weightUnit: 'g',
      liquidUnit: 'ml',
      autoUpdate: true,
    });
    expect(
      (
        await api.post('/admin/password', {
          current: 'wrong wrong',
          next: 'new password',
        })
      ).status
    ).toBe(401);
    expect(
      (
        await api.post('/admin/password', {
          current: 'correct horse',
          next: 'new password',
        })
      ).status
    ).toBe(200);
    const login = await ctx.app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'new password' }),
    });
    expect(login.status).toBe(200);
  });

  test('the owner can enter a past order and delete a finished one', async () => {
    // Midday UTC, so it is still 1 March in whatever zone the tests run.
    const at = '2024-03-01T12:00:00.000Z';
    const items = [
      { itemId: menu.taco.id, qty: 1, modifierIds: [menu.asada.id] },
    ];
    expect(
      (await client(ctx.app, '').post('/admin/orders', { at, items })).status
    ).toBe(401);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      (await api.post('/admin/orders', { at: future, items })).status
    ).toBe(400);

    const first = await api.post('/admin/orders', { at, items });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      businessDate: '2024-03-01',
      orderNumber: 1,
      status: 'completed',
      createdAt: at,
      completedAt: at,
    });
    const second = (await api.post('/admin/orders', { at, items })).body;
    expect(second.orderNumber).toBe(2);
    const day = '/admin/sales?from=2024-03-01&to=2024-03-01';
    expect((await api.get(day)).body.orders).toBe(2);

    const open = (
      await api.post('/orders', {
        items: [{ itemId: menu.agua.id, qty: 1, modifierIds: [] }],
      })
    ).body;
    expect((await api.delete(`/admin/orders/${open.id}`)).status).toBe(409);
    await api.post(`/orders/${open.id}/status`, { status: 'cancelled' });

    expect((await api.delete(`/admin/orders/${second.id}`)).status).toBe(200);
    expect(ctx.events.at(-1)).toEqual({ type: 'order.deleted', id: second.id });
    expect((await api.get(`/orders/${second.id}`)).status).toBe(404);
    expect((await api.delete(`/admin/orders/${second.id}`)).status).toBe(404);
    expect((await api.get(day)).body.orders).toBe(1);
  });

  test('an employee meal is cooked like any order but charged nothing', async () => {
    const at = '2024-04-01T12:00:00.000Z';
    const day = '/admin/sales?from=2024-04-01&to=2024-04-01';
    const items = [
      { itemId: menu.taco.id, qty: 2, modifierIds: [menu.asada.id] },
    ];
    await api.post('/admin/orders', { at, items });
    const meal = await api.post('/admin/orders', {
      at,
      items,
      employeeMeal: true,
    });
    expect(meal.status).toBe(201);
    expect(meal.body).toMatchObject({
      employeeMeal: true,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
    expect(meal.body.items[0]).toMatchObject({
      priceCents: 350,
      lineTotalCents: 0,
    });
    const sales = (await api.get(day)).body;
    expect(sales.orders).toBe(1);
    expect(sales.employeeMeals).toBe(1);

    // Live orders too, and an edit keeps it free.
    const live = (await api.post('/orders', { items, employeeMeal: true }))
      .body;
    expect(live).toMatchObject({ employeeMeal: true, totalCents: 0 });
    expect(
      (await api.get('/orders')).body.map((o: { id: string }) => o.id)
    ).toContain(live.id);
    const edited = (
      await api.put(`/orders/${live.id}`, { items, employeeMeal: true })
    ).body;
    expect(edited.totalCents).toBe(0);
    await api.post(`/orders/${live.id}/status`, { status: 'cancelled' });
  });

  test('deleting a category cascades to its items', async () => {
    await api.delete(`/admin/categories/${menu.cat.id}`);
    expect((await api.get('/menu')).body.categories).toEqual([]);
  });
});
