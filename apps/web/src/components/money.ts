export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Parses a price typed in dollars into integer cents: "12.50" becomes 1250.
 * Returns null for empty or unparseable input.
 */
export function parseDollars(value: string): number | null {
  const n = Number(value.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export const toDollars = (cents: number) => (cents / 100).toFixed(2);
