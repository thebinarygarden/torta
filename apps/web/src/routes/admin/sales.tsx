import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { Order, SalesSummary } from '@torta/shared';
import { Button, IconButton } from '@binarygarden/flora/form';
import { IconArrow, IconPlus, IconTrashcan } from '@binarygarden/flora/icons';
import { Tabs } from '@binarygarden/flora/navigation';
import { useDialog, useToast } from '@binarygarden/flora/overlay';
import {
  Badge,
  Card,
  EmptyState,
  Stat,
  Table,
  Tag,
} from '@binarygarden/flora/ui';
import { del, get } from '../../api/http';
import { useRealtime } from '../../api/ws';
import { isoDate, parseDate } from '../../components/dates';
import { useHealth } from '../../components/health';
import { formatCents } from '../../components/money';
import { orderLabel } from '../../components/order-title';
import { useUnits } from '../../components/units';
import { errorMessage, format, useT } from '../../i18n';
import type { AdminContext } from './layout';

type Period = 'day' | 'week' | 'month';
type Tab = 'orders' | 'items';

const hourOf = (o: Order) => new Date(o.createdAt).getHours();

/** "2 pm", in the browser's own clock format. */
const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/** The days of the period holding `anchor`. Weeks start on Monday. */
function daysOf(period: Period, anchor: Date): Date[] {
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

function step(period: Period, anchor: Date, by: number) {
  const d = new Date(anchor);
  if (period === 'day') d.setDate(d.getDate() + by);
  else if (period === 'week') d.setDate(d.getDate() + 7 * by);
  else d.setMonth(d.getMonth() + by, 1);
  return d;
}

function periodLabel(period: Period, days: Date[]) {
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

/** "Ana" and "ana " are the same customer. */
const customerKey = (o: Order) => o.customerName?.trim().toLowerCase() ?? null;

// Sales only shows orders the kitchen has closed; open ones live on the
// order and kitchen screens until then.
const isFinished = (o: Order) =>
  o.status === 'completed' || o.status === 'cancelled';

export function AdminSales() {
  // Coming back from entering a past order lands on that day.
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(() => {
    const date = params.get('date');
    return date ? parseDate(date) : new Date();
  });
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const { menu, reloadMenu } = useOutletContext<AdminContext>();
  // The bar picked on the timeline, the items the chart is following, and
  // which table shows under it.
  const [pick, setPick] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const toggleItem = (name: string) =>
    setChosen((all) =>
      all.includes(name) ? all.filter((n) => n !== name) : [...all, name]
    );
  // "taco and torta" in the chart title.
  const chosenLabel = new Intl.ListFormat(undefined, {
    style: 'short',
    type: 'conjunction',
  }).format(chosen);
  const charting = chosen.length > 0;
  // One customer at a time; tapping another name replaces it.
  // The name is kept for the token, even in a period without their orders.
  const [customer, setCustomer] = useState<{
    key: string;
    name: string;
  } | null>(null);
  const [tab, setTab] = useState<Tab>('orders');
  const { health } = useHealth();
  const { showConfirm } = useDialog();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const t = useT();
  const money = (c: number) => formatCents(c, health.currency);
  const units = useUnits();

  // Read once on mount: the clock is not read during render.
  const [today] = useState(() => isoDate(new Date()));
  const days = useMemo(() => daysOf(period, anchor), [period, anchor]);
  const from = isoDate(days[0]!);
  const to = isoDate(days.at(-1)!);
  // A new period starts with nothing picked on the timeline.
  const go = (p: Period, a: Date) => {
    setPeriod(p);
    setAnchor(a);
    setPick(null);
  };

  const load = useCallback(() => {
    get<SalesSummary>(`/admin/sales?from=${from}&to=${to}`)
      .then(setSales)
      .catch(() => setSales(null));
    get<Order[]>(`/orders?from=${from}&to=${to}`)
      .then((all) => setOrders(all.filter(isFinished)))
      .catch(() => setOrders([]));
  }, [from, to]);
  useEffect(load, [load]);
  // Orders close on the tablets while this page is open; keep it current.
  useRealtime((e) => {
    if (
      e.type === 'hello' ||
      e.type === 'order.created' ||
      e.type === 'order.updated' ||
      e.type === 'order.deleted'
    ) {
      load();
    }
    if (e.type === 'hello' || e.type === 'menu.updated') reloadMenu();
  });

  // A day shows hours, over the span that had orders. A week or month shows
  // every day, including ones still to come, so a new owner sees the whole
  // shape a few days in.
  // With items picked, each bar counts how many of them sold instead.
  // The chart and both tables follow the picked customer.
  const mine = useMemo(
    () =>
      customer === null
        ? orders
        : orders.filter((o) => customerKey(o) === customer.key),
    [orders, customer]
  );

  const bars = useMemo(() => {
    const tally = (these: Order[]) => {
      const done = these.filter((o) => o.status === 'completed');
      if (charting) {
        const lines = done.flatMap((o) =>
          o.items.filter((i) => chosen.includes(i.name))
        );
        return {
          count: lines.reduce((s, i) => s + i.qty, 0),
          cancelled: 0,
          cents: lines.reduce((s, i) => s + i.lineTotalCents, 0),
        };
      }
      return {
        count: these.length,
        cancelled: these.length - done.length,
        cents: done.reduce((s, o) => s + o.totalCents, 0),
      };
    };
    if (period === 'day') {
      if (mine.length === 0) return [];
      const by = mine.map(hourOf);
      const first = Math.min(...by);
      return Array.from({ length: Math.max(...by) - first + 1 }, (_, n) => {
        const h = first + n;
        return {
          key: String(h),
          label: hourLabel(h),
          tip: hourLabel(h),
          future: false,
          ...tally(mine.filter((o) => hourOf(o) === h)),
        };
      });
    }
    return days.map((d, n) => {
      const key = isoDate(d);
      return {
        key,
        // A month only labels every fifth day so the labels don't collide.
        label:
          period === 'week'
            ? d.toLocaleDateString(undefined, { weekday: 'short' })
            : n % 5 === 0
              ? String(d.getDate())
              : '',
        tip: d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        future: key > today,
        ...tally(mine.filter((o) => o.businessDate === key)),
      };
    });
  }, [period, days, mine, today, chosen, charting]);
  const busiest = Math.max(1, ...bars.map((b) => b.count));
  const picked = bars.find((b) => b.key === pick);

  // Everything under the chart follows the picked bar. The orders list also
  // narrows to the picked items; items sold keeps every item to choose from.
  const inBar = useMemo(
    () =>
      mine.filter(
        (o) =>
          pick === null ||
          (period === 'day'
            ? String(hourOf(o)) === pick
            : o.businessDate === pick)
      ),
    [mine, pick, period]
  );
  const shown = useMemo(
    () =>
      inBar
        .filter(
          (o) => !charting || o.items.some((i) => chosen.includes(i.name))
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inBar, chosen, charting]
  );

  // Items from completed orders, each broken down by the options from its
  // required groups (the protein), not add-ons or ingredient changes.
  const sold = useMemo(() => {
    const required = new Set(
      menu?.categories.flatMap((c) =>
        c.items.flatMap((i) =>
          i.modifierGroups
            .filter((g) => g.minSelect >= 1)
            .flatMap((g) => g.modifiers.map((m) => m.id))
        )
      )
    );
    const by = new Map<
      string,
      { qty: number; cents: number; options: Map<string, number> }
    >();
    for (const o of inBar) {
      if (o.status !== 'completed') continue;
      for (const i of o.items) {
        const s = by.get(i.name) ?? { qty: 0, cents: 0, options: new Map() };
        s.qty += i.qty;
        s.cents += i.lineTotalCents;
        for (const m of i.modifiers) {
          if (required.has(m.id)) {
            s.options.set(m.name, (s.options.get(m.name) ?? 0) + i.qty);
          }
        }
        by.set(i.name, s);
      }
    }
    return [...by]
      .map(([name, s]) => ({
        name,
        qty: s.qty,
        cents: s.cents,
        options: [...s.options].sort((a, b) => b[1] - a[1]),
      }))
      .sort((a, b) => b.qty - a.qty || b.cents - a.cents);
  }, [inBar, menu]);

  const cancelled = orders.filter((o) => o.status === 'cancelled').length;
  const unnamed = orders.filter((o) => !o.customerName).length;
  const time = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      ...(period !== 'day' && { month: 'short', day: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    });

  // A new past order starts on the picked day, else the day in view.
  const addOrder = () => {
    const day =
      period !== 'day' && pick
        ? pick
        : to < today
          ? to
          : from > today
            ? from
            : today;
    navigate(`/admin/sales/new?date=${day}`);
  };

  const remove = (o: Order) =>
    showConfirm(format(t.sales.deleteConfirm, { order: orderLabel(o) }), () => {
      del(`/admin/orders/${o.id}`)
        .then(load)
        .catch((e) =>
          showToast({ message: errorMessage(t, e), tone: 'danger' })
        );
    });

  return (
    <>
      <div className="tt-row" data-between>
        <h1>{t.sales.title}</h1>
        <div className="tt-row">
          <Tabs
            variant="pill"
            value={period}
            onChange={(v) => go(v as Period, anchor)}
            items={[
              { value: 'day', label: t.sales.day },
              { value: 'week', label: t.sales.week },
              { value: 'month', label: t.sales.month },
            ]}
          />
          <div className="tt-pager">
            <IconButton
              size="sm"
              label={t.sales.previous}
              onClick={() => go(period, step(period, anchor, -1))}
            >
              <IconArrow orientation="left" size={14} />
            </IconButton>
            <span className="tt-period">{periodLabel(period, days)}</span>
            <IconButton
              size="sm"
              label={t.sales.next}
              disabled={to >= today}
              onClick={() => go(period, step(period, anchor, 1))}
            >
              <IconArrow orientation="right" size={14} />
            </IconButton>
            <span className="tt-pager-divider" aria-hidden="true" />
            <Button
              size="sm"
              variant="ghost"
              disabled={to >= today}
              onClick={() => go(period, new Date())}
            >
              {t.sales.today}
            </Button>
          </div>
        </div>
      </div>
      {sales && (
        <>
          <div
            className="tt-stats"
            data-counts={sales.employeeMeals > 0 ? 4 : 3}
          >
            <Stat label={t.sales.orders} value={String(sales.orders)} />
            <Stat label={t.sales.cancelled} value={String(cancelled)} />
            <Stat label={t.sales.unnamed} value={String(unnamed)} />
            {sales.employeeMeals > 0 && (
              <Stat
                label={t.sales.employeeMeals}
                value={String(sales.employeeMeals)}
              />
            )}
            <Stat
              data-money
              label={t.sales.gross}
              value={money(sales.grossCents)}
            />
            {(health.taxEnabled || sales.taxCents > 0) && (
              <Stat
                data-money
                label={t.sales.tax}
                value={money(sales.taxCents)}
              />
            )}
            {sales.usage.length > 0 && (
              <>
                <Stat
                  data-money
                  label={t.sales.foodCost}
                  value={money(sales.costCents)}
                />
                <Stat
                  data-money
                  label={t.sales.afterFood}
                  value={money(
                    sales.subtotalCents - sales.costCents - sales.wasteCents
                  )}
                  hint={t.sales.afterFoodHint}
                />
                {sales.wasteCents > 0 && (
                  <Stat
                    data-money
                    label={t.sales.waste}
                    value={money(sales.wasteCents)}
                    hint={t.sales.wasteHint}
                  />
                )}
              </>
            )}
          </div>
          <Card
            padding="md"
            title={
              !charting
                ? customer !== null
                  ? format(
                      period === 'day'
                        ? t.sales.customerTimeline
                        : t.sales.customerTimelineDays,
                      { name: customer.name }
                    )
                  : period === 'day'
                    ? t.sales.timeline
                    : t.sales.timelineDays
                : format(
                    period === 'day'
                      ? t.sales.itemTimeline
                      : t.sales.itemTimelineDays,
                    { item: chosenLabel }
                  )
            }
            action={
              <Button
                size="sm"
                variant="secondary"
                iconLeft={<IconPlus size={14} />}
                onClick={addOrder}
              >
                {t.sales.addOrder}
              </Button>
            }
          >
            <div className="tt-stack">
              {orders.length === 0 ? (
                <EmptyState>{t.sales.empty}</EmptyState>
              ) : (
                <>
                  <div>
                    <div className="tt-timeline">
                      {bars.map((b) => (
                        <button
                          key={b.key}
                          type="button"
                          className="tt-timeline-hour"
                          data-future={b.future || undefined}
                          disabled={b.future}
                          aria-pressed={pick === b.key}
                          aria-label={format(
                            !charting
                              ? t.sales.barSummary
                              : t.sales.barSoldSummary,
                            { when: b.tip, n: b.count, sales: money(b.cents) }
                          )}
                          onClick={() => setPick(pick === b.key ? null : b.key)}
                        >
                          <span className="tt-timeline-tip" aria-hidden="true">
                            <strong>{b.tip}</strong>
                            <span>
                              {format(
                                !charting ? t.sales.nOrders : t.sales.nSold,
                                { n: b.count }
                              )}
                            </span>
                            <span>{money(b.cents)}</span>
                            {b.cancelled > 0 && (
                              <span>
                                {format(t.sales.nCancelled, {
                                  n: b.cancelled,
                                })}
                              </span>
                            )}
                          </span>
                          <span className="tt-timeline-track">
                            <span
                              className="tt-timeline-bar"
                              style={{
                                height: `${(b.count / busiest) * 100}%`,
                              }}
                            />
                          </span>
                          <span className="tt-timeline-label">{b.label}</span>
                        </button>
                      ))}
                    </div>
                    <p className="tt-small tt-muted">
                      {!charting
                        ? t.sales.timelineHint
                        : t.sales.itemTimelineHint}
                    </p>
                  </div>
                  <Tabs
                    value={tab}
                    onChange={(v) => setTab(v as Tab)}
                    items={[
                      {
                        value: 'orders',
                        label: t.sales.lookup,
                        count: shown.length,
                      },
                      { value: 'items', label: t.sales.itemsSold },
                    ]}
                  />
                  {(charting || picked || customer !== null) && (
                    <div className="tt-row" data-center>
                      {picked && (
                        <Tag
                          onRemove={() => setPick(null)}
                          labels={t.flora.tag}
                        >
                          {period === 'day'
                            ? format(t.sales.atHour, { hour: picked.tip })
                            : format(t.sales.onDay, { day: picked.tip })}
                        </Tag>
                      )}
                      {customer !== null && (
                        <Tag
                          onRemove={() => setCustomer(null)}
                          labels={t.flora.tag}
                        >
                          {customer.name}
                        </Tag>
                      )}
                      {chosen.map((name) => (
                        <Tag
                          key={name}
                          onRemove={() => toggleItem(name)}
                          labels={t.flora.tag}
                        >
                          {name}
                        </Tag>
                      ))}
                    </div>
                  )}
                  {tab === 'orders' ? (
                    <>
                      {!charting && !picked && customer === null && (
                        <p className="tt-small tt-muted">
                          {t.sales.ordersHint}
                        </p>
                      )}
                      <Table>
                        <thead>
                          <tr>
                            <th>{t.sales.time}</th>
                            <th>{t.sales.order}</th>
                            <th data-num>{t.sales.items}</th>
                            <th data-num>{t.sales.total}</th>
                            <th aria-label={t.sales.deleteOrder} />
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((o) => (
                            <tr
                              key={o.id}
                              data-cancelled={
                                o.status === 'cancelled' || undefined
                              }
                            >
                              <td>{time(o.createdAt)}</td>
                              <td>
                                {o.customerName ? (
                                  <button
                                    type="button"
                                    className="tt-name-pick"
                                    aria-pressed={
                                      customerKey(o) === customer?.key
                                    }
                                    onClick={() =>
                                      setCustomer({
                                        key: customerKey(o)!,
                                        name: o.customerName!.trim(),
                                      })
                                    }
                                  >
                                    {o.customerName}
                                  </button>
                                ) : null}{' '}
                                <span
                                  className={
                                    o.customerName ? 'tt-muted' : undefined
                                  }
                                >
                                  #{o.orderNumber}
                                </span>
                                {o.employeeMeal && (
                                  <Badge className="tt-meal">
                                    {t.order.employeeMeal}
                                  </Badge>
                                )}
                              </td>
                              <td data-num>
                                {o.items.reduce((s, i) => s + i.qty, 0)}
                              </td>
                              <td data-num>{money(o.totalCents)}</td>
                              <td data-action>
                                <IconButton
                                  size="sm"
                                  label={t.sales.deleteOrder}
                                  onClick={() => remove(o)}
                                >
                                  <IconTrashcan size={16} />
                                </IconButton>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </>
                  ) : sold.length === 0 ? (
                    <EmptyState>{t.sales.noneSold}</EmptyState>
                  ) : (
                    <>
                      {/* The tokens above replace the hint once anything is picked. */}
                      {!charting && !picked && customer === null && (
                        <p className="tt-small tt-muted">
                          {t.sales.itemsSoldHint}
                        </p>
                      )}
                      <Table>
                        <thead>
                          <tr>
                            <th>{t.sales.item}</th>
                            <th data-num>{t.sales.qty}</th>
                            <th data-num>{t.sales.title}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sold.map((i) => (
                            <tr
                              key={i.name}
                              data-picked={chosen.includes(i.name) || undefined}
                            >
                              <td>
                                <button
                                  type="button"
                                  className="tt-item-pick"
                                  aria-pressed={chosen.includes(i.name)}
                                  onClick={() => toggleItem(i.name)}
                                >
                                  {i.name}
                                  {i.options.length > 0 && (
                                    <span className="tt-options">
                                      {i.options
                                        .map(([name, qty]) => `${name} ${qty}`)
                                        .join(' · ')}
                                    </span>
                                  )}
                                </button>
                              </td>
                              <td data-num>{i.qty}</td>
                              <td data-num>{money(i.cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </>
                  )}
                </>
              )}
            </div>
          </Card>
          {sales.usage.length > 0 && (
            <Card title={t.sales.ingredientsUsed} padding="md">
              <Table>
                <thead>
                  <tr>
                    <th>{t.sales.ingredient}</th>
                    <th data-num>{t.sales.used}</th>
                    <th data-num>{t.sales.cost}</th>
                    <th data-num>{t.sales.shouldBeLeft}</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.usage.map((u) => (
                    <tr key={u.inventoryItemId}>
                      <td>{u.name}</td>
                      <td data-num>{units.format(u.qty, u.kind)}</td>
                      <td data-num>{money(u.costCents)}</td>
                      <td
                        data-num
                        data-low={
                          (u.expectedLeft !== null && u.expectedLeft <= 0) ||
                          undefined
                        }
                      >
                        {u.expectedLeft === null
                          ? '—'
                          : units.format(Math.max(0, u.expectedLeft), u.kind)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
