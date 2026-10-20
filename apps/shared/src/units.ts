import { z } from 'zod';

/**
 * Inventory amounts are stored in base units: grams, millilitres or a count.
 * The owner picks how weight and liquid read, and every screen converts at
 * input and output. Weight and liquid never convert into each other.
 */
export const kind = z.enum(['weight', 'liquid', 'count']);
export const weightUnit = z.enum(['g', 'oz']);
export const liquidUnit = z.enum(['ml', 'fl_oz']);
export const currency = z.enum(['USD', 'MXN']);

export type Kind = z.infer<typeof kind>;
export type WeightUnit = z.infer<typeof weightUnit>;
export type LiquidUnit = z.infer<typeof liquidUnit>;
export type Currency = z.infer<typeof currency>;
export type UnitPrefs = { weightUnit: WeightUnit; liquidUnit: LiquidUnit };

// Base units per one display unit.
const FACTOR: Record<WeightUnit | LiquidUnit, number> = {
  g: 1,
  oz: 28.349523125,
  ml: 1,
  fl_oz: 29.5735295625,
};

const factor = (k: Kind, prefs: UnitPrefs) =>
  k === 'weight'
    ? FACTOR[prefs.weightUnit]
    : k === 'liquid'
      ? FACTOR[prefs.liquidUnit]
      : 1;

export const toDisplay = (base: number, k: Kind, prefs: UnitPrefs) =>
  base / factor(k, prefs);

export const toBase = (value: number, k: Kind, prefs: UnitPrefs) =>
  value * factor(k, prefs);

export function unitLabel(k: Kind, prefs: UnitPrefs): string {
  if (k === 'count') return 'each';
  const u = k === 'weight' ? prefs.weightUnit : prefs.liquidUnit;
  return u === 'fl_oz' ? 'fl oz' : u;
}
