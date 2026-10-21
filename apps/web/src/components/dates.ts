/** A local date as YYYY-MM-DD, the shape business dates use. */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A YYYY-MM-DD date as local midnight. */
export const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d);
};

/** "Oct 20", for a row that only needs the day. */
export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(
    undefined,
    { month: 'short', day: 'numeric' }
  );

export type Period = 'day' | 'week' | 'month';

/** The days of the period holding `anchor`. Weeks start on Monday. */
export function daysOf(period: Period, anchor: Date): Date[] {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const d = anchor.getDate();
  if (period === 'day') return [new Date(y, m, d)];
  if (period === 'week') {
    const monday = d - ((anchor.getDay() + 6) % 7);
    return Array.from({ length: 7 }, (_, n) => new Date(y, m, monday + n));
  }
  const length = new Date(y, m + 1, 0).getDate();
  return Array.from({ length }, (_, n) => new Date(y, m, n + 1));
}

export function step(period: Period, anchor: Date, by: number) {
  const d = new Date(anchor);
  if (period === 'day') d.setDate(d.getDate() + by);
  else if (period === 'week') d.setDate(d.getDate() + 7 * by);
  else d.setMonth(d.getMonth() + by, 1);
  return d;
}

export function periodLabel(period: Period, days: Date[]) {
  if (period === 'day') {
    return days[0]!.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  if (period === 'week') {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).formatRange(days[0]!, days.at(-1)!);
  }
  return days[0]!.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}
