import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Order,
  type OrderStatus,
  type ServerEvent,
  isActive,
} from '@torta/shared';
import { Button, Checkbox, IconButton } from '@binarygarden/flora/form';
import { IconCheck, IconX } from '@binarygarden/flora/icons';
import { Dialog, useToast } from '@binarygarden/flora/overlay';
import { Badge, Card, EmptyState } from '@binarygarden/flora/ui';
import { setSurface } from '../../api/auth';
import { get, post } from '../../api/http';
import { useRealtime } from '../../api/ws';
import { SurfaceHeader } from '../../components/surface-header';
import { TicketHead, TicketLines } from '../../components/ticket';
import { useUnauthorizedRedirect } from '../../components/use-unauthorized';
import { errorMessage, format, useT } from '../../i18n';

type View = 'open' | 'allDay' | 'done';

const byCreated = (a: Order, b: Order) =>
  a.createdAt.localeCompare(b.createdAt);
const isDone = (o: Order) =>
  o.status === 'completed' || o.status === 'cancelled';
const finishedAt = (o: Order) => o.completedAt ?? o.cancelledAt ?? '';
const byFinished = (a: Order, b: Order) =>
  finishedAt(b).localeCompare(finishedAt(a));

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "4:07" since the order reached the kitchen. */
const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Kitchen() {
  useUnauthorizedRedirect();
  useEffect(() => setSurface('kitchen'), []);
  const { showToast } = useToast();
  const t = useT();
  const [view, setView] = useState<View>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const now = useNow(1000);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [done, setDone] = useState<Order[] | null>(null);

  const load = useCallback(() => {
    get<Order[]>('/orders')
      .then(setOrders)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  const loadDone = useCallback(() => {
    get<Order[]>('/orders?scope=done')
      .then(setDone)
      .catch(() => {});
  }, []);
  // Loaded up front too, since the stats bar counts today's finished orders.
  useEffect(loadDone, [loadDone]);

  // Every write comes back here, so both lists follow one order's status.
  const place = useCallback((order: Order) => {
    setOrders((all) => {
      const rest = (all ?? []).filter((o) => o.id !== order.id);
      return (isActive(order) ? [...rest, order] : rest).sort(byCreated);
    });
    setDone((all) => {
      if (!all) return all;
      const rest = all.filter((o) => o.id !== order.id);
      return (isDone(order) ? [...rest, order] : rest).sort(byFinished);
    });
  }, []);

  useRealtime((e: ServerEvent) => {
    if (e.type === 'hello') {
      load();
      loadDone();
    }
    if (e.type === 'order.created' || e.type === 'order.updated') {
      place(e.order);
    }
    if (e.type === 'order.deleted') {
      setDone((all) => all && all.filter((o) => o.id !== e.id));
    }
  });

  const move = async (order: Order, to: OrderStatus, foodMade?: boolean) => {
    try {
      place(
        await post<Order>(`/orders/${order.id}/status`, {
          status: to,
          foodMade,
        })
      );
    } catch (err) {
      showToast({ message: errorMessage(t, err), tone: 'danger' });
      load();
    }
  };

  // Acknowledges an edit; the ticket then works as usual.
  const hear = async (order: Order) => {
    try {
      place(await post<Order>(`/orders/${order.id}/heard`));
    } catch (err) {
      showToast({ message: errorMessage(t, err), tone: 'danger' });
      load();
    }
  };

  // All day: how many of each item and its options the open orders still
  // need. Ingredient changes don't change the count, so they're left out.
  const allDay = useMemo(() => {
    const counts = new Map<
      string,
      { name: string; modifiers: string; qty: number }
    >();
    for (const o of orders ?? []) {
      for (const i of o.items) {
        const modifiers = i.modifiers.map((m) => m.name).join(' · ');
        const key = `${i.name}\n${modifiers}`;
        const c = counts.get(key) ?? { name: i.name, modifiers, qty: 0 };
        c.qty += i.qty;
        counts.set(key, c);
      }
    }
    // Variants of one item sit together, the most needed first.
    return [...counts].sort(
      ([, a], [, b]) =>
        a.name.localeCompare(b.name) ||
        b.qty - a.qty ||
        a.modifiers.localeCompare(b.modifiers)
    );
  }, [orders]);

  // Today's completed orders and how long they took on average. Orders entered
  // after the fact complete the moment they're created, so they're left out of
  // the average.
  const stats = useMemo(() => {
    const completed = (done ?? []).filter((o) => o.status === 'completed');
    const times = completed
      .map((o) => Date.parse(o.completedAt ?? '') - Date.parse(o.createdAt))
      .filter((ms) => ms > 0);
    return {
      count: completed.length,
      avgMs: times.length
        ? times.reduce((a, b) => a + b, 0) / times.length
        : null,
    };
  }, [done]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div className="tt-shell">
      <SurfaceHeader
        surface="kitchen"
        view={view}
        onView={setView}
        views={[
          { value: 'open', label: t.kitchen.open, count: orders?.length },
          { value: 'allDay', label: t.kitchen.allDay },
          { value: 'done', label: t.kitchen.done },
        ]}
      />
      {done && (
        <p className="tt-kitchen-stats tt-small">
          {format(t.kitchen.ordersToday, { n: stats.count })}
          {' · '}
          {format(t.kitchen.avgTime, {
            time: stats.avgMs === null ? '—' : elapsed(stats.avgMs),
          })}
        </p>
      )}
      <main className="tt-main">
        {view === 'done' ? (
          done === null ? (
            <EmptyState>{t.kitchen.loading}</EmptyState>
          ) : done.length === 0 ? (
            <EmptyState>{t.kitchen.emptyDone}</EmptyState>
          ) : (
            <div className="tt-kitchen">
              {done.map((o) => (
                <Card
                  key={o.id}
                  className="tt-ticket"
                  data-cancelled={o.status === 'cancelled' || undefined}
                  padding="md"
                >
                  <TicketHead order={o}>
                    {o.status === 'cancelled' ? (
                      <Badge tone="danger" dot>
                        {o.cancelledAt &&
                          format(t.kitchen.cancelledAt, {
                            time: time(o.cancelledAt),
                          })}
                      </Badge>
                    ) : (
                      <span className="tt-small tt-muted">
                        {o.completedAt &&
                          format(t.kitchen.completedAt, {
                            time: time(o.completedAt),
                          })}
                      </span>
                    )}
                  </TicketHead>
                  {o.completedAt && (
                    <p className="tt-small tt-muted">
                      {format(t.kitchen.took, {
                        time: elapsed(
                          Date.parse(o.completedAt) - Date.parse(o.createdAt)
                        ),
                      })}
                    </p>
                  )}
                  <TicketLines order={o} />
                  <div className="tt-row" data-center>
                    <Button onClick={() => move(o, 'sent')}>
                      {t.kitchen.reopen}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : orders === null ? (
          <EmptyState>{t.kitchen.loading}</EmptyState>
        ) : orders.length === 0 ? (
          <EmptyState>{t.kitchen.empty}</EmptyState>
        ) : view === 'allDay' ? (
          <ul className="tt-allday">
            {allDay.map(([key, c]) => (
              <li key={key}>
                <strong>{c.qty}×</strong>
                <span>
                  {c.name}
                  {c.modifiers && (
                    <span className="tt-small tt-muted">{c.modifiers}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="tt-kitchen">
            {orders.map((o) => {
              const ms = now - Date.parse(o.createdAt);
              const isSelected = selected === o.id;
              const toggle = () => setSelected(isSelected ? null : o.id);
              return (
                <Card
                  key={o.id}
                  className="tt-ticket"
                  data-selected={isSelected || undefined}
                  data-edited={!!o.editedAt || undefined}
                  padding="md"
                  interactive
                  onClick={toggle}
                >
                  {o.editedAt && (
                    <Badge className="tt-updated" tone="warn" dot>
                      {t.kitchen.updated}
                    </Badge>
                  )}
                  <TicketHead order={o}>
                    <span
                      className="tt-elapsed tt-muted"
                      data-late={ms >= 15 * 60_000 || undefined}
                    >
                      {elapsed(ms)}
                    </span>
                  </TicketHead>
                  <TicketLines order={o} />
                  {isSelected && o.editedAt && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="lg"
                        className="tt-heard"
                        onClick={() => {
                          setSelected(null);
                          hear(o);
                        }}
                      >
                        {t.kitchen.heard}
                      </Button>
                    </div>
                  )}
                  {isSelected && !o.editedAt && (
                    <div
                      className="tt-row"
                      data-between
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton
                        size="lg"
                        variant="outline"
                        label={format(t.kitchen.cancel, { n: o.orderNumber })}
                        onClick={() => setCancelling(o)}
                      >
                        <IconX size={22} />
                      </IconButton>
                      <IconButton
                        size="lg"
                        variant="filled"
                        label={format(t.kitchen.complete, {
                          n: o.orderNumber,
                        })}
                        onClick={() => {
                          setSelected(null);
                          move(o, 'completed');
                        }}
                      >
                        <IconCheck size={22} />
                      </IconButton>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </main>
      {cancelling && (
        <CancelDialog
          order={cancelling}
          onClose={() => setCancelling(null)}
          onCancel={(foodMade) => {
            move(cancelling, 'cancelled', foodMade);
            setCancelling(null);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Cancelling asks whether the food was made, so inventory counts what was
 * used even though nobody paid for it.
 */
function CancelDialog({
  order,
  onClose,
  onCancel,
}: {
  order: Order;
  onClose: () => void;
  onCancel: (foodMade: boolean) => void;
}) {
  const t = useT();
  const [made, setMade] = useState(false);
  return (
    <Dialog
      open
      title={format(t.kitchen.cancelTitle, { n: order.orderNumber })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.kitchen.keep}
          </Button>
          <Button variant="danger" onClick={() => onCancel(made)}>
            {t.kitchen.cancelOrder}
          </Button>
        </>
      }
    >
      <Checkbox
        label={t.kitchen.foodMade}
        description={t.kitchen.foodMadeNote}
        checked={made}
        onChange={(e) => setMade(e.target.checked)}
      />
    </Dialog>
  );
}
