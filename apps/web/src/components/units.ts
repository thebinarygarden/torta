import { toBase, toDisplay, unitLabel, type Kind } from '@torta/shared';
import { useHealth } from './health';
import { useT } from '../i18n';

/**
 * Inventory amounts in the owner's preferred units. The server stores grams,
 * millilitres and counts; this converts at every input and output.
 */
export function useUnits() {
  const { health } = useHealth();
  const t = useT();
  const label = (k: Kind) =>
    k === 'count' ? t.units.each : unitLabel(k, health);
  return {
    label,
    /** "1,250 g" */
    format: (base: number, k: Kind) =>
      `${toDisplay(base, k, health).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} ${label(k)}`,
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
