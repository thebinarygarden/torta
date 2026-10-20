import { useEffect, useState } from 'react';
import { Link, Navigate, useOutletContext, useParams } from 'react-router';
import type {
  Category,
  Ingredient,
  InventoryItem,
  Item,
  ModifierGroup,
} from '@torta/shared';
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Select,
  Switch,
} from '@binarygarden/flora/form';
import { IconPlus, IconTrashcan } from '@binarygarden/flora/icons';
import { useDialog, useToast } from '@binarygarden/flora/overlay';
import { Card, EmptyState } from '@binarygarden/flora/ui';
import { del, get, patch, post } from '../../api/http';
import { choiceLabel, groupRule } from '../../components/choices';
import { useHealth } from '../../components/health';
import { formatCents, parseDollars, toDollars } from '../../components/money';
import { FormDialog } from '../../components/form-dialog';
import { useUnits } from '../../components/units';
import { errorMessage, format, useT } from '../../i18n';
import type { AdminContext } from './layout';

export function AdminMenu() {
  const { menu, reloadMenu } = useOutletContext<AdminContext>();
  const { categoryId } = useParams();
  const [dialog, setDialog] = useState<
    | { kind: 'category'; category?: Category }
    | { kind: 'item'; item?: Item }
    | { kind: 'ingredient'; item: Item; ingredient?: Ingredient }
    | { kind: 'group'; item: Item; group?: ModifierGroup }
    | {
        kind: 'modifier';
        group: ModifierGroup;
        modifier?: ModifierGroup['modifiers'][number];
      }
    | null
  >(null);
  const { showConfirm } = useDialog();
  const { showToast } = useToast();
  const { health } = useHealth();
  const t = useT();
  const units = useUnits();
  // Ingredients can only have amounts once the owner tracks inventory.
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  useEffect(() => {
    get<InventoryItem[]>('/admin/inventory')
      .then(setInventory)
      .catch(() => {});
  }, []);
  const amount = (ing: Ingredient) => {
    const inv = inventory.find((i) => i.id === ing.inventoryItemId);
    return inv && ing.qty != null
      ? ` · ${units.format(ing.qty, inv.kind)}`
      : '';
  };

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      reloadMenu();
      setDialog(null);
    } catch (e) {
      showToast({ message: errorMessage(t, e), tone: 'danger' });
    }
  };

  const category = menu?.categories.find((c) => c.id === categoryId);
  const money = (c: number) => formatCents(c, health.currency);
  /** "none · on the side · extra +$0.50" */
  const servedAs = (ing: Ingredient) => {
    const allowed = [
      ing.allowNone && choiceLabel(t, 'none'),
      ing.allowSide && choiceLabel(t, 'side'),
      ing.allowExtra &&
        choiceLabel(t, 'extra') +
          (ing.extraPriceCents > 0 ? ` +${money(ing.extraPriceCents)}` : ''),
    ].filter(Boolean);
    return allowed.length > 0 ? allowed.join(' · ') : t.menu.regularOnly;
  };

  if (!menu) return null;

  // /admin/menu, or a category that was just deleted, opens the first one.
  const first = menu.categories[0];
  if (!category && (categoryId || first)) {
    return (
      <Navigate
        to={first ? `/admin/menu/${first.id}` : '/admin/menu'}
        replace
      />
    );
  }

  return (
    <>
      <div className="tt-row" data-between>
        <h1>{t.menu.title}</h1>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<IconPlus size={14} />}
          onClick={() => setDialog({ kind: 'category' })}
        >
          {t.menu.category}
        </Button>
      </div>

      {!category ? (
        <EmptyState>{t.menu.noCategories}</EmptyState>
      ) : (
        <div className="tt-stack">
          <div className="tt-row" data-between>
            <h2>{category.name}</h2>
            <span className="tt-row">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialog({ kind: 'category', category })}
              >
                {t.menu.rename}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  showConfirm(
                    format(t.menu.deleteCategory, {
                      name: category.name,
                      count: category.items.length,
                    }),
                    () => run(del(`/admin/categories/${category.id}`))
                  )
                }
              >
                {t.delete}
              </Button>
              <Button
                size="sm"
                iconLeft={<IconPlus size={14} />}
                onClick={() => setDialog({ kind: 'item' })}
              >
                {t.menu.item}
              </Button>
            </span>
          </div>

          {category.items.length === 0 && (
            <EmptyState>
              {format(t.menu.noItems, { name: category.name })}
            </EmptyState>
          )}

          {category.items.map((item) => (
            <Card key={item.id} padding="md">
              <div className="tt-item-row">
                <div className="tt-item-head">
                  <strong className="tt-grow">{item.name}</strong>
                  <span className="tt-money">{money(item.priceCents)}</span>
                  <Switch
                    size="sm"
                    label={t.menu.available}
                    checked={item.available}
                    onChange={(e) =>
                      run(
                        patch(`/admin/items/${item.id}`, {
                          available: e.target.checked,
                        })
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ kind: 'item', item })}
                  >
                    {t.edit}
                  </Button>
                  <IconButton
                    size="sm"
                    label={t.menu.deleteItem}
                    onClick={() =>
                      showConfirm(
                        format(t.menu.deleteConfirm, { name: item.name }),
                        () => run(del(`/admin/items/${item.id}`))
                      )
                    }
                  >
                    <IconTrashcan size={16} />
                  </IconButton>
                </div>

                <section className="tt-item-section">
                  <div className="tt-row" data-between>
                    <span className="tt-label">{t.menu.ingredients}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<IconPlus size={14} />}
                      onClick={() => setDialog({ kind: 'ingredient', item })}
                    >
                      {t.menu.ingredient}
                    </Button>
                  </div>
                  {item.ingredients.length === 0 ? (
                    <p className="tt-small tt-muted">
                      {t.menu.ingredientsEmpty}
                    </p>
                  ) : (
                    <div>
                      {item.ingredients.map((ing) => (
                        <div className="tt-choice" key={ing.id}>
                          <span>
                            {ing.name}
                            <span className="tt-muted">{amount(ing)}</span>
                          </span>
                          <span className="tt-row">
                            <span className="tt-small tt-muted">
                              {servedAs(ing)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDialog({
                                  kind: 'ingredient',
                                  item,
                                  ingredient: ing,
                                })
                              }
                            >
                              {t.edit}
                            </Button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="tt-item-section">
                  <div className="tt-row" data-between>
                    <span className="tt-label">{t.menu.modifiers}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<IconPlus size={14} />}
                      onClick={() => setDialog({ kind: 'group', item })}
                    >
                      {t.menu.modifierGroup}
                    </Button>
                  </div>
                  {item.modifierGroups.length === 0 && (
                    <p className="tt-small tt-muted">{t.menu.modifiersEmpty}</p>
                  )}
                  {item.modifierGroups.map((g) => (
                    <div className="tt-group" key={g.id}>
                      <div className="tt-row" data-between>
                        <span>
                          {g.name}{' '}
                          <span className="tt-small tt-muted">
                            · {groupRule(t, g)}
                          </span>
                        </span>
                        <span className="tt-row">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setDialog({ kind: 'group', item, group: g })
                            }
                          >
                            {t.edit}
                          </Button>
                          <IconButton
                            size="sm"
                            label={t.menu.deleteGroup}
                            onClick={() =>
                              showConfirm(
                                format(t.menu.deleteConfirm, { name: g.name }),
                                () => run(del(`/admin/modifier-groups/${g.id}`))
                              )
                            }
                          >
                            <IconTrashcan size={16} />
                          </IconButton>
                        </span>
                      </div>
                      <div className="tt-row">
                        {g.modifiers.map((m) => (
                          <Button
                            key={m.id}
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setDialog({
                                kind: 'modifier',
                                group: g,
                                modifier: m,
                              })
                            }
                          >
                            {m.name}
                            {m.priceCents > 0 ? ` +${money(m.priceCents)}` : ''}
                          </Button>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          iconLeft={<IconPlus size={14} />}
                          onClick={() =>
                            setDialog({ kind: 'modifier', group: g })
                          }
                        >
                          {t.menu.option}
                        </Button>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            </Card>
          ))}
        </div>
      )}

      {dialog?.kind === 'category' && (
        <NameDialog
          title={dialog.category ? t.menu.renameCategory : t.menu.newCategory}
          initial={dialog.category?.name ?? ''}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            run(
              dialog.category
                ? patch(`/admin/categories/${dialog.category.id}`, { name })
                : post('/admin/categories', {
                    name,
                    sortOrder: menu.categories.length,
                  })
            )
          }
        />
      )}
      {dialog?.kind === 'item' && category && (
        <ItemDialog
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            run(
              dialog.item
                ? patch(`/admin/items/${dialog.item.id}`, body)
                : post('/admin/items', {
                    ...body,
                    categoryId: category.id,
                    sortOrder: category.items.length,
                  })
            )
          }
        />
      )}
      {dialog?.kind === 'ingredient' && (
        <IngredientDialog
          ingredient={dialog.ingredient}
          inventory={inventory}
          onClose={() => setDialog(null)}
          onDelete={
            dialog.ingredient
              ? () => run(del(`/admin/ingredients/${dialog.ingredient!.id}`))
              : undefined
          }
          onSubmit={(body) =>
            run(
              dialog.ingredient
                ? patch(`/admin/ingredients/${dialog.ingredient.id}`, body)
                : post(`/admin/items/${dialog.item.id}/ingredients`, {
                    ...body,
                    sortOrder: dialog.item.ingredients.length,
                  })
            )
          }
        />
      )}
      {dialog?.kind === 'group' && (
        <GroupDialog
          group={dialog.group}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            run(
              dialog.group
                ? patch(`/admin/modifier-groups/${dialog.group.id}`, body)
                : post(`/admin/items/${dialog.item.id}/modifier-groups`, {
                    ...body,
                    sortOrder: dialog.item.modifierGroups.length,
                  })
            )
          }
        />
      )}
      {dialog?.kind === 'modifier' && (
        <ModifierDialog
          modifier={dialog.modifier}
          onClose={() => setDialog(null)}
          onDelete={
            dialog.modifier
              ? () => run(del(`/admin/modifiers/${dialog.modifier!.id}`))
              : undefined
          }
          onSubmit={(body) =>
            run(
              dialog.modifier
                ? patch(`/admin/modifiers/${dialog.modifier.id}`, body)
                : post(`/admin/modifier-groups/${dialog.group.id}/modifiers`, {
                    ...body,
                    sortOrder: dialog.group.modifiers.length,
                  })
            )
          }
        />
      )}
    </>
  );
}

function NameDialog({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial);
  return (
    <FormDialog
      title={title}
      onClose={onClose}
      onSubmit={() => name.trim() && onSubmit(name.trim())}
    >
      <Input
        label={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
      />
    </FormDialog>
  );
}

function ItemDialog({
  item,
  onClose,
  onSubmit,
}: {
  item?: Item;
  onClose: () => void;
  onSubmit: (body: { name: string; priceCents: number }) => void;
}) {
  const t = useT();
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item ? toDollars(item.priceCents) : '');
  const cents = parseDollars(price);
  return (
    <FormDialog
      title={item ? t.menu.editItem : t.menu.newItem}
      onClose={onClose}
      onSubmit={() =>
        cents !== null &&
        name.trim() &&
        onSubmit({ name: name.trim(), priceCents: cents })
      }
    >
      <Input
        label={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
      />
      <Input
        label={t.menu.price}
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={price && cents === null ? t.notPrice : undefined}
        required
      />
    </FormDialog>
  );
}

type Rule = 'one' | 'optionalOne' | 'upTo' | 'range';

function GroupDialog({
  group,
  onClose,
  onSubmit,
}: {
  group?: ModifierGroup;
  onClose: () => void;
  onSubmit: (body: {
    name: string;
    minSelect: number;
    maxSelect: number;
  }) => void;
}) {
  const t = useT();
  const min = group?.minSelect ?? 1;
  const max = group?.maxSelect ?? 1;
  const [name, setName] = useState(group?.name ?? '');
  const [rule, setRule] = useState<Rule>(
    min === 0
      ? max === 1
        ? 'optionalOne'
        : 'upTo'
      : max === 1
        ? 'one'
        : 'range'
  );
  const [limit, setLimit] = useState(String(max > 1 ? max : 2));
  const many = rule === 'upTo' || rule === 'range';
  const n = Number(limit);
  const bad = many && !(Number.isInteger(n) && n >= 2 && n <= 20);
  return (
    <FormDialog
      title={group ? t.menu.editGroup : t.menu.newGroup}
      onClose={onClose}
      onSubmit={() =>
        !bad &&
        name.trim() &&
        onSubmit({
          name: name.trim(),
          // A group saved with a higher minimum keeps it.
          minSelect:
            rule === 'one'
              ? 1
              : rule === 'range'
                ? Math.min(Math.max(1, min), n)
                : 0,
          maxSelect: many ? n : 1,
        })
      }
    >
      <Input
        label={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
        hint={t.menu.groupHint}
      />
      <Select
        label={t.menu.rule}
        value={rule}
        onChange={(e) => setRule(e.target.value as Rule)}
        options={[
          { value: 'one', label: t.menu.ruleOne },
          { value: 'optionalOne', label: t.menu.ruleOptionalOne },
          { value: 'upTo', label: t.menu.ruleUpTo },
          { value: 'range', label: t.menu.ruleRange },
        ]}
      />
      {many && (
        <Input
          label={t.menu.limit}
          type="number"
          min={2}
          max={20}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          error={bad ? t.menu.notCount : undefined}
        />
      )}
    </FormDialog>
  );
}

function ModifierDialog({
  modifier,
  onClose,
  onDelete,
  onSubmit,
}: {
  modifier?: { name: string; priceCents: number };
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (body: { name: string; priceCents: number }) => void;
}) {
  const t = useT();
  const [name, setName] = useState(modifier?.name ?? '');
  const [price, setPrice] = useState(
    modifier ? toDollars(modifier.priceCents) : '0'
  );
  const cents = parseDollars(price);
  return (
    <FormDialog
      title={modifier ? t.menu.editOption : t.menu.newOption}
      onClose={onClose}
      onSubmit={() =>
        cents !== null &&
        name.trim() &&
        onSubmit({ name: name.trim(), priceCents: cents })
      }
      extra={
        onDelete && (
          <Button variant="danger" size="sm" type="button" onClick={onDelete}>
            {t.delete}
          </Button>
        )
      }
    >
      <Input
        label={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
      />
      <Input
        label={t.menu.extraPrice}
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={cents === null ? t.notPrice : undefined}
      />
    </FormDialog>
  );
}

function IngredientDialog({
  ingredient,
  inventory,
  onClose,
  onDelete,
  onSubmit,
}: {
  ingredient?: Ingredient;
  inventory: InventoryItem[];
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (body: {
    name: string;
    inventoryItemId: string | null;
    qty: number | null;
    allowNone: boolean;
    allowSide: boolean;
    allowExtra: boolean;
    extraPriceCents: number;
  }) => void;
}) {
  const units = useUnits();
  const t = useT();
  const [name, setName] = useState(ingredient?.name ?? '');
  const [allowNone, setAllowNone] = useState(ingredient?.allowNone ?? true);
  const [allowSide, setAllowSide] = useState(ingredient?.allowSide ?? true);
  const [allowExtra, setAllowExtra] = useState(ingredient?.allowExtra ?? false);
  const [extraPrice, setExtraPrice] = useState(
    ingredient ? toDollars(ingredient.extraPriceCents) : '0'
  );
  const extraCents = parseDollars(extraPrice);
  const [linkId, setLinkId] = useState(ingredient?.inventoryItemId ?? '');
  const linked = inventory.find((i) => i.id === linkId);
  const [qty, setQty] = useState(
    linked && ingredient?.qty != null
      ? units.toField(ingredient.qty, linked.kind)
      : ''
  );
  const base = linked ? units.fromField(qty, linked.kind) : null;
  const [before, after] = t.menu.inventoryFirst.split('{link}');

  return (
    <FormDialog
      title={ingredient ? t.menu.editIngredient : t.menu.newIngredient}
      onClose={onClose}
      onSubmit={() =>
        name.trim() &&
        (!linked || (base !== null && base > 0)) &&
        extraCents !== null &&
        onSubmit({
          name: name.trim(),
          inventoryItemId: linked?.id ?? null,
          qty: linked ? base : null,
          allowNone,
          allowSide,
          allowExtra,
          extraPriceCents: allowExtra ? extraCents : 0,
        })
      }
      extra={
        onDelete && (
          <Button variant="danger" size="sm" type="button" onClick={onDelete}>
            {t.delete}
          </Button>
        )
      }
    >
      <Input
        label={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint={t.menu.ingredientHint}
        autoFocus
        required
      />
      <fieldset className="tt-fieldset">
        <legend className="tt-label">{t.menu.servedAs}</legend>
        <Checkbox
          label={choiceLabel(t, 'none')}
          checked={allowNone}
          onChange={(e) => setAllowNone(e.target.checked)}
        />
        <Checkbox
          label={choiceLabel(t, 'side')}
          checked={allowSide}
          onChange={(e) => setAllowSide(e.target.checked)}
        />
        <Checkbox
          label={choiceLabel(t, 'extra')}
          checked={allowExtra}
          onChange={(e) => setAllowExtra(e.target.checked)}
        />
        {allowExtra && (
          <Input
            label={t.menu.extraPrice}
            inputMode="decimal"
            value={extraPrice}
            onChange={(e) => setExtraPrice(e.target.value)}
            error={extraCents === null ? t.notPrice : undefined}
          />
        )}
      </fieldset>
      {inventory.length === 0 ? (
        <p className="tt-small tt-muted">
          {before}
          <Link to="/admin/inventory">{t.menu.inventoryLink}</Link>
          {after}
        </p>
      ) : (
        <>
          <Select
            label={t.menu.usesFromInventory}
            value={linkId}
            onChange={(e) => {
              const next = inventory.find((i) => i.id === e.target.value);
              // Follow the inventory name unless the owner wrote their own.
              if (next && (!name.trim() || name === linked?.name)) {
                setName(next.name);
              }
              setLinkId(e.target.value);
              setQty('');
            }}
            options={[
              { value: '', label: t.menu.notTracked },
              ...inventory.map((i) => ({ value: i.id, label: i.name })),
            ]}
          />
          {linked && (
            <Input
              label={format(t.menu.amountPerItem, {
                unit: units.label(linked.kind),
              })}
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              error={qty && !(base && base > 0) ? t.notAmount : undefined}
              required
            />
          )}
        </>
      )}
    </FormDialog>
  );
}
