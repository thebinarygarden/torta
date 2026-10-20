import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import {
  toBase,
  toDisplay,
  type IngredientChoice,
  type Order,
} from '@torta/shared';
import { client, makeApp, seedMenu, setup } from './helpers';

const ctx = await makeApp();
afterAll(() => ctx.close());
afterEach(() => vi.unstubAllGlobals());

let api: ReturnType<typeof client>;
let cookie: string;
let menu: Awaited<ReturnType<typeof seedMenu>>;

beforeAll(async () => {
  cookie = (await setup(ctx.app)).cookie;
  api = client(ctx.app, cookie);
  menu = await seedMenu(api);
});

type Choices = { id: string; choice: IngredientChoice }[];

const placeOrder = (ingredientChoices: Choices = [], qty = 1) =>
  api.post('/orders', {
    items: [
      {
        itemId: menu.taco.id,
        qty,
        modifierIds: [menu.asada.id],
        ingredientChoices,
      },
    ],
  });
const order = async (ingredientChoices: Choices = [], qty = 1) =>
  (await placeOrder(ingredientChoices, qty)).body as Order;

const advance = async (o: Order, ...steps: string[]) => {
  for (const status of steps) {
    const res = await api.post(`/orders/${o.id}/status`, { status });
    expect(res.status).toBe(200);
  }
};

const inventory = async () => (await api.get('/admin/inventory')).body;
const today = async () => (await api.get('/admin/sales')).body;

test('units round-trip through the owner preference', () => {
  const oz = { weightUnit: 'oz', liquidUnit: 'fl_oz' } as const;
  expect(toBase(1, 'weight', oz)).toBeCloseTo(28.3495, 3);
  expect(toDisplay(toBase(4.5, 'liquid', oz), 'liquid', oz)).toBeCloseTo(4.5);
  expect(toBase(3, 'count', oz)).toBe(3);
});

describe('ingredients and inventory', () => {
  let onion: { id: string };
  let beef: { id: string };
  let beefIngredient: { id: string };

  test('an ingredient needs inventory before it can have a quantity', async () => {
    const bad = await api.post(`/admin/items/${menu.taco.id}/ingredients`, {
      name: 'onion',
      qty: 10,
    });
    expect(bad.status).toBe(400);
    const ok = await api.post(`/admin/items/${menu.taco.id}/ingredients`, {
      name: 'onion',
    });
    expect(ok.status).toBe(201);
    onion = ok.body;
    const taco = (await api.get('/menu')).body.categories[0].items[0];
    expect(taco.ingredients).toEqual([
      expect.objectContaining({
        name: 'onion',
        inventoryItemId: null,
        qty: null,
      }),
    ]);
  });

  test('ingredients default to none, regular and on the side', async () => {
    expect(onion).toMatchObject({
      allowNone: true,
      allowSide: true,
      allowExtra: false,
      extraPriceCents: 0,
    });
  });

  test('an ingredient choice is snapshot on the order for the kitchen', async () => {
    const o = await order([{ id: onion.id, choice: 'none' }]);
    const snapshot = [
      { id: onion.id, name: 'onion', choice: 'none', priceCents: 0 },
    ];
    expect(o.items[0]!.ingredients).toEqual(snapshot);
    const active = (await api.get('/orders')).body as Order[];
    expect(active.find((x) => x.id === o.id)!.items[0]!.ingredients).toEqual(
      snapshot
    );
    await advance(o, 'cancelled');
  });

  test('a choice the owner did not allow is rejected', async () => {
    const extra = await placeOrder([{ id: onion.id, choice: 'extra' }]);
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('ingredient_choice');
    const twice = await placeOrder([
      { id: onion.id, choice: 'none' },
      { id: onion.id, choice: 'side' },
    ]);
    expect(twice.body.error).toBe('ingredient_choice');
  });

  test("choosing another item's ingredient is rejected", async () => {
    const lime = (
      await api.post(`/admin/items/${menu.agua.id}/ingredients`, {
        name: 'lime',
      })
    ).body;
    const res = await api.post('/orders', {
      items: [
        {
          itemId: menu.taco.id,
          qty: 1,
          modifierIds: [menu.asada.id],
          ingredientChoices: [{ id: lime.id, choice: 'none' }],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_ingredient');
  });

  test('completed orders use up linked inventory and cost money', async () => {
    beef = (
      await api.post('/admin/inventory', {
        name: 'beef',
        kind: 'weight',
        barcode: '0001',
        packSize: 5000,
        packCostCents: 4000,
        onHand: 3000,
      })
    ).body;
    expect(beef).toMatchObject({ onHand: 3000, expectedLeft: 3000 });
    beefIngredient = (
      await api.post(`/admin/items/${menu.taco.id}/ingredients`, {
        name: 'beef',
        inventoryItemId: beef.id,
        qty: 120,
      })
    ).body;

    const o = await order([], 2);
    await advance(o, 'completed');
    expect((await inventory())[0].expectedLeft).toBe(2760);
    const sales = await today();
    expect(sales.costCents).toBe(192);
    expect(sales.usage).toEqual([
      expect.objectContaining({ name: 'beef', qty: 240, expectedLeft: 2760 }),
    ]);
  });

  test('left-off ingredients and open orders use nothing', async () => {
    const removed = await order([{ id: beefIngredient.id, choice: 'none' }]);
    await advance(removed, 'completed');
    await order(); // still open
    expect((await inventory())[0].expectedLeft).toBe(2760);
  });

  test('a cancelled order only uses inventory when the food was made', async () => {
    const notMade = await order();
    await advance(notMade, 'cancelled');
    expect((await inventory())[0].expectedLeft).toBe(2760);

    const made = await order();
    const res = await api.post(`/orders/${made.id}/status`, {
      status: 'cancelled',
      foodMade: true,
    });
    expect(res.body.foodMade).toBe(true);
    expect((await inventory())[0].expectedLeft).toBe(2640);
    const sales = await today();
    expect(sales.costCents).toBe(192);
    expect(sales.wasteCents).toBe(96);
    // Waste costs food but isn't revenue.
    expect(sales.orders).toBe(2);
  });

  test('an employee meal uses inventory and costs food, but no revenue', async () => {
    const before = await today();
    const meal = (
      await api.post('/orders', {
        employeeMeal: true,
        items: [{ itemId: menu.taco.id, qty: 1, modifierIds: [menu.asada.id] }],
      })
    ).body as Order;
    await advance(meal, 'completed');
    expect((await inventory())[0].expectedLeft).toBe(2520);
    const sales = await today();
    expect(sales.costCents).toBe(before.costCents + 96);
    expect(sales.grossCents).toBe(before.grossCents);
    expect(sales.orders).toBe(before.orders);
    expect(sales.employeeMeals).toBe(1);
  });

  test('counting stock starts usage over', async () => {
    const res = await api.patch(`/admin/inventory/${beef.id}`, {
      onHand: 4000,
    });
    expect(res.body).toMatchObject({ onHand: 4000, expectedLeft: 4000 });
  });

  test('extra adds its price and a second portion; on the side the same', async () => {
    await api.patch(`/admin/ingredients/${beefIngredient.id}`, {
      allowExtra: true,
      extraPriceCents: 150,
    });
    const regular = await order();
    const extra = await order([{ id: beefIngredient.id, choice: 'extra' }]);
    const side = await order([{ id: beefIngredient.id, choice: 'side' }]);
    expect(extra.subtotalCents - regular.subtotalCents).toBe(150);
    expect(side.subtotalCents).toBe(regular.subtotalCents);
    for (const o of [regular, extra, side]) {
      await advance(o, 'completed');
    }
    // 120 + 240 + 120 grams.
    expect((await inventory())[0].expectedLeft).toBe(3520);
  });

  test('a barcode can only belong to one item', async () => {
    const res = await api.post('/admin/inventory', {
      name: 'other beef',
      kind: 'weight',
      barcode: '0001',
      packSize: 1,
      packCostCents: 1,
      onHand: 0,
    });
    expect(res.status).toBe(409);
  });

  test('a known barcode opens the item; a new one asks Open Food Facts', async () => {
    expect((await api.get('/admin/inventory/barcode/0001')).body.match.id).toBe(
      beef.id
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          product: {
            product_name: 'whole milk',
            product_quantity: '1',
            product_quantity_unit: 'l',
          },
        })
      )
    );
    expect((await api.get('/admin/inventory/barcode/0002')).body).toEqual({
      suggestion: { name: 'whole milk', kind: 'liquid', packSize: 1000 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    expect((await api.get('/admin/inventory/barcode/0003')).body).toEqual({});
  });

  test('deleting stock unlinks ingredients and drops their quantity', async () => {
    ctx.events.length = 0;
    expect((await api.delete(`/admin/inventory/${beef.id}`)).status).toBe(200);
    const taco = (await api.get('/menu')).body.categories[0].items[0];
    expect(
      taco.ingredients.find((i: { name: string }) => i.name === 'beef')
    ).toMatchObject({ inventoryItemId: null, qty: null });
    expect(ctx.events).toContainEqual({ type: 'menu.updated' });
  });
});
