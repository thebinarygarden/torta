import { toBase, toDisplay, unitLabel, type Kind } from '@torta/shared';
import { useHealth } from './health';
import { format } from '../i18n';

/**
 * Inventory amounts in the owner's preferred units. The server stores grams,
 * millilitres and counts; this converts at every input and output. Counted
 * things read as a bare number: "3", not "3 each".
 */
export function useUnits() {
  const { health } = useHealth();
  const label = (k: Kind) => (k === 'count' ? '' : unitLabel(k, health));
  return {
    label,
    /** "1,250 g", or "3" for a count. */
    format: (base: number, k: Kind) =>
      `${toDisplay(base, k, health).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}${label(k) ? ` ${label(k)}` : ''}`,
    /** A field label like "you buy ({unit})", without the unit for a count. */
    named: (text: string, k: Kind) =>
      label(k)
        ? format(text, { unit: label(k) })
        : text.replace(' ({unit})', ''),
    toDisplay: (base: number, k: Kind) => toDisplay(base, k, health),
    /** The value for an input field, rounded so it reads cleanly. */
    toField: (base: number, k: Kind) =>
      String(Math.round(toDisplay(base, k, health) * 100) / 100),
    /** Parses an input field into base units; null when it isn't a number. */
    fromField: (value: string, k: Kind) => {
      const n = Number(value);
      return value.trim() === '' || !Number.isFinite(n)
        ? null
        : toBase(n, k, health);
    },
  };
}
