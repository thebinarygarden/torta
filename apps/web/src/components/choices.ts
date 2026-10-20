import type { IngredientChoice, ModifierGroup } from '@torta/shared';
import { format, type Dict } from '../i18n';

/** A modifier group's rule as servers read it: "pick 1", "optional · up to 3". */
export function groupRule(
  t: Dict,
  g: Pick<ModifierGroup, 'minSelect' | 'maxSelect'>
): string {
  if (g.minSelect === 0) {
    return g.maxSelect === 1
      ? t.orders.optional
      : `${t.orders.optional} · ${format(t.orders.upTo, { n: g.maxSelect })}`;
  }
  return g.minSelect === g.maxSelect
    ? format(t.orders.pick, { n: g.minSelect })
    : format(t.orders.pickRange, { min: g.minSelect, max: g.maxSelect });
}

export function choiceLabel(t: Dict, c: IngredientChoice | 'regular'): string {
  return {
    none: t.orders.choiceNone,
    regular: t.orders.choiceRegular,
    side: t.orders.choiceSide,
    extra: t.orders.choiceExtra,
  }[c];
}

/** One change as the kitchen reads it: "no onion", "extra cilantro". */
export function ingredientNote(
  t: Dict,
  i: { name: string; choice: IngredientChoice }
): string {
  const text = {
    none: t.orders.without,
    side: t.orders.onSide,
    extra: t.orders.extraOf,
  };
  return format(text[i.choice], { name: i.name });
}

/** "no onion · salsa on the side · extra cilantro" */
export function ingredientNotes(
  t: Dict,
  ings: { name: string; choice: IngredientChoice }[]
): string {
  return ings.map((i) => ingredientNote(t, i)).join(' · ');
}
