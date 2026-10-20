import { useMemo, useState } from 'react';
import type {
  Ingredient,
  IngredientChoice,
  Item,
  Menu,
  Modifier,
  OrderInput,
} from '@torta/shared';
import { Button, IconButton, Input } from '@binarygarden/flora/form';
import { IconMinus, IconPlus, IconX } from '@binarygarden/flora/icons';
import { Tabs } from '@binarygarden/flora/navigation';
import { Dialog } from '@binarygarden/flora/overlay';
import { EmptyState, Tag } from '@binarygarden/flora/ui';
import { useT } from '../i18n';
import { choiceLabel, groupRule, ingredientNotes } from './choices';
import { formatCents } from './money';

// The order being built, shared by the order screen and the owner's past
// orders on the sales page.

/** An ingredient served differently from regular. */
export type Choice = { ingredient: Ingredient; choice: IngredientChoice };

export type Line = {
  key: string;
  item: Item;
  modifiers: Modifier[];
  choices: Choice[];
  qty: number;
  notes: string;
};

export const lineKey = (item: Item, mods: Modifier[], choices: Choice[]) =>
  [
    item.id,
    ...mods.map((m) => m.id).sort(),
    ...choices.map((c) => `${c.ingredient.id}=${c.choice}`).sort(),
  ].join(',');

const extraPrice = (c: Choice) =>
  c.choice === 'extra' ? c.ingredient.extraPriceCents : 0;

export const unitPrice = (line: Line) =>
  line.item.priceCents +
  line.modifiers.reduce((s, m) => s + m.priceCents, 0) +
  line.choices.reduce((s, c) => s + extraPrice(c), 0);

const hasOptions = (item: Item) =>
  item.modifierGroups.length > 0 || item.ingredients.length > 0;

/** The cart's lines as the api takes them. */
export const orderItems = (lines: Line[]): OrderInput['items'] =>
  lines.map((l) => ({
    itemId: l.item.id,
    qty: l.qty,
    notes: l.notes || undefined,
    modifierIds: l.modifiers.map((m) => m.id),
    ingredientChoices: l.choices.map((c) => ({
      id: c.ingredient.id,
      choice: c.choice,
    })),
  }));

export function useCart() {
  const [lines, setLines] = useState<Line[]>([]);
  // The item whose options are open, and the cart line being changed if any.
  const [picking, setPicking] = useState<{ item: Item; line?: Line } | null>(
    null
  );

  const add = (item: Item, modifiers: Modifier[], choices: Choice[]) => {
    const key = lineKey(item, modifiers, choices);
    setLines((all) => {
      const existing = all.find((l) => l.key === key && l.notes === '');
      if (existing) {
        return all.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...all, { key, item, modifiers, choices, qty: 1, notes: '' }];
    });
  };

  // Changing a line's options can make it match another line; they merge.
  const change = (line: Line, modifiers: Modifier[], choices: Choice[]) => {
    const key = lineKey(line.item, modifiers, choices);
    setLines((all) => {
      const twin = all.find(
        (l) => l !== line && l.key === key && l.notes === line.notes
      );
      return twin
        ? all
            .filter((l) => l !== line)
            .map((l) => (l === twin ? { ...l, qty: l.qty + line.qty } : l))
        : all.map((l) => (l === line ? { ...l, key, modifiers, choices } : l));
    });
  };

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + unitPrice(l) * l.qty, 0),
    [lines]
  );

  return {
    lines,
    setLines,
    subtotal,
    picking,
    pick: (item: Item) => {
      if (hasOptions(item)) setPicking({ item });
      else add(item, [], []);
    },
    edit: (line: Line) => setPicking({ item: line.item, line }),
    closePicker: () => setPicking(null),
    choose: (modifiers: Modifier[], choices: Choice[]) => {
      if (!picking) return;
      if (picking.line) change(picking.line, modifiers, choices);
      else add(picking.item, modifiers, choices);
      setPicking(null);
    },
    bump: (line: Line, delta: number) =>
      setLines((all) =>
        all
          .map((l) => (l === line ? { ...l, qty: l.qty + delta } : l))
          .filter((l) => l.qty > 0)
      ),
    setNote: (line: Line, notes: string) =>
      setLines((all) => all.map((l) => (l === line ? { ...l, notes } : l))),
  };
}

export type Cart = ReturnType<typeof useCart>;

/** The menu as category tabs over a grid of item tiles. */
export function MenuTiles({
  menu,
  currency,
  onPick,
  allowUnavailable = false,
}: {
  menu: Menu;
  currency: string;
  onPick: (item: Item) => void;
  /** A past order may name an item that has since sold out. */
  allowUnavailable?: boolean;
}) {
  const t = useT();
  const [category, setCategory] = useState<string | undefined>();
  // A category deleted meanwhile falls back to the first.
  const current =
    menu.categories.find((c) => c.id === category) ?? menu.categories[0];
  return (
    <>
      <Tabs
        variant="pill"
        value={current?.id}
        onChange={setCategory}
        items={menu.categories.map((c) => ({ value: c.id, label: c.name }))}
      />
      <div className="tt-grid">
        {current?.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tt-tile"
            disabled={!item.available && !allowUnavailable}
            onClick={() => onPick(item)}
          >
            <strong>{item.name}</strong>
            <span className="tt-row" data-between>
              <span className="tt-money tt-muted">
                {formatCents(item.priceCents, currency)}
              </span>
              {!item.available && (
                <span className="tt-small tt-muted">{t.order.unavailable}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/** The cart's lines, each with its options, quantity, note and remove. */
export function CartLines({
  cart,
  currency,
}: {
  cart: Cart;
  currency: string;
}) {
  const t = useT();
  if (cart.lines.length === 0) {
    return <EmptyState>{t.order.empty}</EmptyState>;
  }
  return (
    <div className="tt-cart-lines">
      {cart.lines.map((line) => (
        <div className="tt-line" key={line.key + line.notes}>
          <button
            type="button"
            className="tt-line-info"
            disabled={!hasOptions(line.item)}
            onClick={() => cart.edit(line)}
          >
            <div>{line.item.name}</div>
            {line.modifiers.length > 0 && (
              <div className="tt-small tt-muted">
                {line.modifiers.map((m) => m.name).join(' · ')}
              </div>
            )}
            {line.choices.length > 0 && (
              <div className="tt-small tt-changes">
                {ingredientNotes(
                  t,
                  line.choices.map((c) => ({
                    name: c.ingredient.name,
                    choice: c.choice,
                  }))
                )}
              </div>
            )}
          </button>
          <span className="tt-money">
            {formatCents(unitPrice(line) * line.qty, currency)}
          </span>
          <div className="tt-line-meta">
            <span className="tt-qty">
              <IconButton
                size="sm"
                label={t.order.less}
                onClick={() => cart.bump(line, -1)}
              >
                <IconMinus size={16} />
              </IconButton>
              {line.qty}
              <IconButton
                size="sm"
                label={t.order.more}
                onClick={() => cart.bump(line, 1)}
              >
                <IconPlus size={16} />
              </IconButton>
            </span>
            <Input
              size="sm"
              placeholder={t.order.note}
              value={line.notes}
              onChange={(e) => cart.setNote(line, e.target.value)}
            />
            <IconButton
              size="sm"
              label={t.remove}
              onClick={() => cart.bump(line, -line.qty)}
            >
              <IconX size={16} />
            </IconButton>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Marks the cart as a staff meal: cooked as usual, charged nothing. */
export function EmployeeMealToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useT();
  return (
    <Button
      variant="secondary"
      className="tt-toggle"
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      {t.order.employeeMeal}
    </Button>
  );
}

/** The options dialog for the item being picked, when there is one. */
export function CartPicker({
  cart,
  currency,
}: {
  cart: Cart;
  currency: string;
}) {
  if (!cart.picking) return null;
  return (
    <ModifierPicker
      item={cart.picking.item}
      line={cart.picking.line}
      currency={currency}
      onCancel={cart.closePicker}
      onAdd={cart.choose}
    />
  );
}

function ModifierPicker({
  item,
  line,
  currency,
  onCancel,
  onAdd,
}: {
  item: Item;
  /** A cart line to change; its current options start selected. */
  line?: Line;
  currency: string;
  onCancel: () => void;
  onAdd: (modifiers: Modifier[], choices: Choice[]) => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      item.modifierGroups.map((g) => [
        g.id,
        g.modifiers
          .filter((m) => line?.modifiers.some((x) => x.id === m.id))
          .map((m) => m.id),
      ])
    )
  );
  // Ingredients left out of this map are served regular.
  const [served, setServed] = useState<Record<string, IngredientChoice>>(() =>
    Object.fromEntries(
      (line?.choices ?? []).map((c) => [c.ingredient.id, c.choice])
    )
  );

  const toggle = (groupId: string, max: number, mod: Modifier) =>
    setChosen((all) => {
      const now = all[groupId] ?? [];
      if (now.includes(mod.id)) {
        return { ...all, [groupId]: now.filter((id) => id !== mod.id) };
      }
      if (max === 1) return { ...all, [groupId]: [mod.id] };
      if (now.length >= max) return all;
      return { ...all, [groupId]: [...now, mod.id] };
    });

  const valid = item.modifierGroups.every((g) => {
    const n = chosen[g.id]?.length ?? 0;
    return n >= g.minSelect && n <= g.maxSelect;
  });

  const submit = () => {
    const mods = item.modifierGroups.flatMap((g) =>
      g.modifiers.filter((m) => chosen[g.id]?.includes(m.id))
    );
    onAdd(
      mods,
      item.ingredients.flatMap((ingredient) => {
        const choice = served[ingredient.id];
        return choice ? [{ ingredient, choice }] : [];
      })
    );
  };

  return (
    <Dialog
      open
      title={item.name}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button disabled={!valid} onClick={submit}>
            {line ? t.order.update : t.order.add}
          </Button>
        </>
      }
    >
      <div className="tt-stack">
        {item.ingredients.length > 0 && (
          <div className="tt-group">
            <span className="tt-label">{t.order.ingredients}</span>
            <div>
              {item.ingredients.map((i) => {
                const current = served[i.id] ?? 'regular';
                const options = (
                  ['none', 'regular', 'side', 'extra'] as const
                ).filter(
                  (c) =>
                    c === 'regular' ||
                    (c === 'none' && i.allowNone) ||
                    (c === 'side' && i.allowSide) ||
                    (c === 'extra' && i.allowExtra)
                );
                return (
                  <div
                    className="tt-choice"
                    key={i.id}
                    role="group"
                    aria-label={i.name}
                  >
                    <span>{i.name}</span>
                    <div className="tt-row">
                      {options.map((c) => (
                        <Tag
                          key={c}
                          selected={current === c}
                          onClick={() =>
                            setServed((all) => {
                              const { [i.id]: _, ...rest } = all;
                              return c === 'regular'
                                ? rest
                                : { ...rest, [i.id]: c };
                            })
                          }
                        >
                          {choiceLabel(t, c)}
                          {c === 'extra' && i.extraPriceCents > 0
                            ? ` +${formatCents(i.extraPriceCents, currency)}`
                            : ''}
                        </Tag>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {item.modifierGroups.map((g) => (
          <div className="tt-group" key={g.id}>
            <span className="tt-label">
              {g.name} · {groupRule(t, g)}
            </span>
            <div className="tt-row">
              {g.modifiers.map((m) => (
                <Tag
                  key={m.id}
                  selected={chosen[g.id]?.includes(m.id) ?? false}
                  onClick={() => toggle(g.id, g.maxSelect, m)}
                >
                  {m.name}
                  {m.priceCents > 0
                    ? ` +${formatCents(m.priceCents, currency)}`
                    : ''}
                </Tag>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
