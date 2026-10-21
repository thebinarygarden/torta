import { afterAll, beforeAll, expect, test } from 'vitest';
import type {
  InventoryEntry,
  InventoryHistory,
  InventoryItem,
  Order,
} from '@torta/shared';
import { localDate } from '../src/server/dates';
import { client, makeApp, seedMenu, setup } from './helpers';

const ctx = await makeApp();
afterAll(() => ctx.close());

let api: ReturnType<typeof client>;
let menu: Awaited<ReturnType<typeof seedMenu>>;
let beef: InventoryItem;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
};
const today = daysAgo(0);

const stock = async () =>
  ((await api.get('/admin/inventory')).body as InventoryItem[]).find(
    (i) => i.id === beef.id
  )!;
const history = async (from: string, to = from) =>
  (await api.get(`/admin/inventory/history?from=${from}&to=${to}`))
    .body as InventoryHistory;
const put = (
  kind: 'received' | 'counted',
  qty: number,
  extra: { businessDate?: string; costCents?: number } = {}
) =>
  api.put('/admin/inventory/entries', {
    inventoryItemId: beef.id,
    kind,
    qty,
    ...extra,
  });

beforeAll(async () => {
  const { cookie } = await setup(ctx.app);
  api = client(ctx.app, cookie);
  menu = await seedMenu(api);
  beef = (
    await api.post('/admin/inventory', {
      name: 'beef',
      kind: 'weight',
      packSize: 5000,
      packCostCents: 4000,
    })
  ).body;
  await api.post(`/admin/items/${menu.taco.id}/ingredients`, {
    name: 'beef',
    inventoryItemId: beef.id,
    qty: 120,
  });
});

test('a count two days ago and a delivery yesterday add up to today', async () => {
  const counted = await put('counted', 3000, { businessDate: daysAgo(2) });
  expect(counted.status).toBe(200);
  expect(counted.body).toMatchObject({
    entry: 'counted',
    qty: 3000,
    expected: null,
    businessDate: daysAgo(2),
  });

  const received = await put('received', 10000, {
    businessDate: daysAgo(1),
    costCents: 9000,
  });
  expect(received.body).toMatchObject({ qty: 10000, costCents: 9000 });

  const s = await stock();
  expect(s.expectedLeft).toBe(13000);
  // Paying $90 for 10 kg makes the 5 kg pack $45.
  expect(s.packCostCents).toBe(4500);
  expect(s.valueCents).toBe(11700);
  expect(s.lastCount).toMatchObject({ qty: 3000, diff: null });
});

test('sales use stock, and a count shows how far off the shelf was', async () => {
  const o = (
    await api.post('/orders', {
      items: [{ itemId: menu.taco.id, qty: 2, modifierIds: [menu.asada.id] }],
    })
  ).body as Order;
  await api.post(`/orders/${o.id}/status`, { status: 'completed' });
  expect((await stock()).expectedLeft).toBe(12760);

  const counted = await put('counted', 12500);
  expect(counted.body).toMatchObject({ expected: 12760, businessDate: today });
  const s = await stock();
  expect(s.expectedLeft).toBe(12500);
  expect(s.lastCount).toMatchObject({ qty: 12500, diff: -260 });
});

test('history sums deliveries, usage and count differences per item', async () => {
  const h = await history(daysAgo(2), today);
  expect(h.entries.map((e: InventoryEntry) => [e.entry, e.qty])).toEqual([
    ['counted', 12500],
    ['received', 10000],
    ['counted', 3000],
  ]);
  expect(h.items).toEqual([
    expect.objectContaining({
      name: 'beef',
      code: beef.code,
      receivedQty: 10000,
      receivedCents: 9000,
      usedQty: 240,
      // Priced when the order was made, at the updated pack price.
      usedCents: 216,
      diff: -260,
      diffCents: -234,
    }),
  ]);
  expect(h.totals).toEqual({
    receivedCents: 9000,
    usedCents: 216,
    diffCents: -234,
  });

  const day = await history(today);
  expect(day.entries).toHaveLength(1);
  expect(day.items[0]).toMatchObject({ receivedQty: 0, usedQty: 240 });
  expect((await history(daysAgo(5))).items).toEqual([]);
});

test('saving the same day again replaces the line, and the past recomputes', async () => {
  const again = await put('received', 15000, {
    businessDate: daysAgo(1),
    costCents: 13500,
  });
  expect(again.body.qty).toBe(15000);
  const h = await history(daysAgo(2), today);
  expect(h.entries.filter((e) => e.entry === 'received')).toHaveLength(1);
  expect((await stock()).lastCount).toMatchObject({ diff: -5260 });

  expect(
    (await api.delete(`/admin/inventory/entries/${again.body.id}`)).status
  ).toBe(200);
  expect((await stock()).lastCount).toMatchObject({ diff: 9740 });
  expect((await history(daysAgo(1))).entries).toEqual([]);
});

test('lines apply in the order they were typed', async () => {
  // Yesterday has no lines: the count two days ago still stands at 3000.
  // Count the shelf, then register the delivery: the delivery adds on top.
  await put('counted', 3000, { businessDate: daysAgo(1) });
  await put('received', 5000, { businessDate: daysAgo(1), costCents: 4500 });
  let day = await history(daysAgo(1));
  expect(day.entries.find((e) => e.entry === 'counted')).toMatchObject({
    expected: 3000,
  });
  // Today's count then compares against 3000 + 5000 − 240.
  expect((await stock()).lastCount).toMatchObject({ diff: 12500 - 7760 });

  // Fixing only the price does not move the delivery after the count.
  await put('received', 5000, { businessDate: daysAgo(1), costCents: 4600 });
  expect((await stock()).lastCount).toMatchObject({ diff: 12500 - 7760 });

  // Recounting after unloading replaces the delivery.
  await put('counted', 8000, { businessDate: daysAgo(1) });
  day = await history(daysAgo(1));
  expect(day.entries.find((e) => e.entry === 'counted')).toMatchObject({
    expected: 8000,
  });
  expect((await stock()).lastCount).toMatchObject({ diff: 12500 - 7760 });

  for (const e of day.entries) {
    await api.delete(`/admin/inventory/entries/${e.id}`);
  }
  expect((await stock()).lastCount).toMatchObject({ diff: 9740 });
});

test('bad input is refused', async () => {
  expect((await put('received', 0)).status).toBe(400);
  expect((await api.get('/admin/inventory/history?from=nope')).status).toBe(
    400
  );
  expect((await api.delete(`/admin/inventory/entries/${beef.id}`)).status).toBe(
    404
  );
  expect(
    (
      await api.put('/admin/inventory/entries', {
        inventoryItemId: menu.taco.id,
        kind: 'counted',
        qty: 1,
      })
    ).status
  ).toBe(404);
});

test('sales keeps the money, not the per-ingredient list', async () => {
  const sales = (await api.get('/admin/sales')).body;
  expect(sales.costCents).toBe(216);
  expect(sales).not.toHaveProperty('usage');
});
