// The seed menu, loaded by `pnpm dev:reset`.
// Prices are in cents (MXN). Option prices are added to the item's price.

type Option = { name: string; priceCents: number };
type Group = { name: string; min: number; options: Option[] };
type Ingredient = { name: string; side?: boolean; extra?: boolean };
type Item = {
  name: string;
  priceCents: number;
  protein?: Option[];
  ingredients?: Ingredient[];
};

const pesos = (n: number) => n * 100;

// Every ingredient can be left off. `extra` defaults to on, `side` to off.
const ing = (names: string[], opts: Omit<Ingredient, 'name'> = {}) =>
  names.map((name) => ({ name, ...opts }));

// Offered on every food item, both optional.
const papas: Group = {
  name: 'Papas',
  min: 0,
  options: [{ name: 'Papas fritas', priceCents: pesos(30) }],
};

const bebidas: Option[] = [
  { name: 'Jarritos Mandarina', priceCents: pesos(20) },
  { name: 'Jarritos Piña', priceCents: pesos(20) },
  { name: 'Jarritos Manzana', priceCents: pesos(20) },
  { name: 'Jarritos Tutifruti', priceCents: pesos(20) },
  { name: 'Coca-Cola grande', priceCents: pesos(25) },
  { name: 'Coca-Cola chica', priceCents: pesos(12) },
  { name: 'Agua grande', priceCents: pesos(12) },
  { name: 'Agua chica', priceCents: pesos(6) },
];
const bebida: Group = { name: 'Bebida', min: 0, options: bebidas };

const cebollaCilantro = ing(['Cebolla', 'Cilantro'], { side: true });

const food: { category: string; items: Item[] }[] = [
  {
    category: 'Tortas',
    items: [
      {
        name: 'Torta clásica',
        priceCents: pesos(50),
        protein: [
          { name: 'Lomo', priceCents: 0 },
          { name: 'Jamón', priceCents: 0 },
          { name: 'Arrachera', priceCents: pesos(20) },
          { name: 'Barbacoa', priceCents: pesos(15) },
        ],
        ingredients: ing([
          'Mayonesa',
          'Lechuga',
          'Jitomate',
          'Aguacate',
          'Cebolla',
        ]),
      },
      {
        name: 'Torta cubana',
        priceCents: pesos(60),
        ingredients: [
          ...ing(['Lomo', 'Jamón'], { extra: false }),
          ...ing(['Queso', 'Jitomate', 'Cebolla', 'Salsa especial']),
        ],
      },
    ],
  },
  {
    category: 'Tacos',
    items: [
      {
        name: 'Taco',
        priceCents: pesos(15),
        protein: [
          { name: 'Carnitas', priceCents: 0 },
          { name: 'Barbacoa', priceCents: pesos(5) },
          { name: 'Arrachera', priceCents: pesos(5) },
        ],
        ingredients: cebollaCilantro,
      },
      {
        name: 'Quesadilla',
        priceCents: pesos(30),
        protein: [
          { name: 'Pierna', priceCents: 0 },
          { name: 'Barbacoa', priceCents: pesos(10) },
          { name: 'Arrachera', priceCents: pesos(10) },
        ],
      },
      {
        name: 'Volcán',
        priceCents: pesos(20),
        protein: [
          { name: 'Barbacoa', priceCents: 0 },
          { name: 'Arrachera', priceCents: pesos(5) },
        ],
        ingredients: cebollaCilantro,
      },
    ],
  },
  {
    category: 'Hamburguesas',
    items: [
      {
        name: 'Clásica',
        priceCents: pesos(80),
        ingredients: ing([
          'Queso',
          'Lechuga',
          'Jitomate',
          'Cebolla',
          'Aderezo de la casa',
        ]),
      },
      {
        name: 'Especial de la casa',
        priceCents: pesos(95),
        ingredients: ing([
          'Queso',
          'Tocino',
          'Aguacate',
          'Lechuga',
          'Jitomate',
          'Cebolla',
          'Aderezo de la casa',
        ]),
      },
      {
        name: 'Arrachera',
        priceCents: pesos(100),
        ingredients: [
          ...ing(['Mayonesa']),
          ...ing(['Arrachera'], { extra: false }),
          ...ing(['Cebolla asada', 'Queso', 'Lechuga', 'Jitomate', 'Aguacate']),
        ],
      },
    ],
  },
];

export type SeedCategory = {
  name: string;
  items: (Omit<Item, 'protein'> & { groups: Group[] })[];
};

export const menu: SeedCategory[] = [
  ...food.map(({ category, items }) => ({
    name: category,
    items: items.map(({ protein, ...item }) => ({
      ...item,
      groups: [
        ...(protein ? [{ name: 'Proteína', min: 1, options: protein }] : []),
        papas,
        bebida,
      ],
    })),
  })),
  {
    name: 'Bebidas',
    items: bebidas.map((b) => ({ ...b, groups: [] })),
  },
];
