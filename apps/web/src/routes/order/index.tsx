import { useCallback, useEffect, useState } from 'react';
import {
  type Menu,
  type Modifier,
  type Order as OrderRecord,
  type ServerEvent,
  isActive,
} from '@torta/shared';
import { Button, Input } from '@binarygarden/flora/form';
import { Badge, Card, EmptyState } from '@binarygarden/flora/ui';
import { useToast } from '@binarygarden/flora/overlay';
import { setSurface } from '../../api/auth';
import { get, post, put } from '../../api/http';
import { useRealtime } from '../../api/ws';
import {
  CartLines,
  CartPicker,
  EmployeeMealToggle,
  MenuTiles,
  lineKey,
  orderItems,
  useCart,
  type Choice,
  type Line,
} from '../../components/cart';
import { useHealth } from '../../components/health';
import { formatCents } from '../../components/money';
import { orderLabel } from '../../components/order-title';
import { SurfaceHeader } from '../../components/surface-header';
import { TicketHead, TicketLines } from '../../components/ticket';
import { useUnauthorizedRedirect } from '../../components/use-unauthorized';
import { errorMessage, format, useT } from '../../i18n';

type View = 'new' | 'orders';

const finishedAt = (o: OrderRecord) => o.completedAt ?? o.cancelledAt ?? '';
// Open orders first, oldest first; then finished ones, the latest first.
const byOpenThenFinished = (a: OrderRecord, b: OrderRecord) =>
  Number(isActive(b)) - Number(isActive(a)) ||
  (isActive(a)
    ? a.createdAt.localeCompare(b.createdAt)
    : finishedAt(b).localeCompare(finishedAt(a)));

/**
 * Rebuilds an open order as cart lines from the current menu. Null when
 * something on it has since left the menu, since the server could not price it.
 */
function linesFor(order: OrderRecord, menu: Menu): Line[] | null {
  const items = menu.categories.flatMap((c) => c.items);
  const lines: Line[] = [];
  for (const oi of order.items) {
    const item = items.find((i) => i.id === oi.itemId);
    if (!item) return null;
    const mods = item.modifierGroups.flatMap((g) => g.modifiers);
    const modifiers = oi.modifiers.map((m) => mods.find((x) => x.id === m.id));
    const choices = oi.ingredients.map((c) => {
      const ingredient = item.ingredients.find((i) => i.id === c.id);
      return ingredient && { ingredient, choice: c.choice };
    });
    if (modifiers.some((m) => !m) || choices.some((c) => !c)) return null;
    const m = modifiers as Modifier[];
    const ch = choices as Choice[];
    lines.push({
      key: lineKey(item, m, ch),
      item,
      modifiers: m,
      choices: ch,
      qty: oi.qty,
      notes: oi.notes ?? '',
    });
  }
  return lines;
}

export function Order() {
  useUnauthorizedRedirect();
  useEffect(() => setSurface('order'), []);
  const { health } = useHealth();
  const { showToast } = useToast();
  const t = useT();

  const [menu, setMenu] = useState<Menu | null>(null);
  const cart = useCart();
  const { lines, setLines } = cart;
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<View>('new');
  // Today's orders and any still open; only open ones can be edited.
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const openCount = orders.filter(isActive).length;
  // The open order loaded into the cart, when editing one.
  const [editing, setEditing] = useState<OrderRecord | null>(null);
  // A staff meal goes to the kitchen as usual but is charged nothing.
  const [employeeMeal, setEmployeeMeal] = useState(false);

  const loadMenu = useCallback(() => {
    get<Menu>('/menu')
      .then(setMenu)
      .catch(() => {});
  }, []);

  // Names from past orders, offered as suggestions in the name field.
  const [customer, setCustomer] = useState('');
  const [customers, setCustomers] = useState<string[]>([]);
  const loadCustomers = useCallback(() => {
    get<string[]>('/orders/customers')
      .then(setCustomers)
      .catch(() => {});
  }, []);
  useEffect(loadCustomers, [loadCustomers]);

  const loadOrders = useCallback(() => {
    get<OrderRecord[]>('/orders?scope=today')
      .then((all) => setOrders(all.sort(byOpenThenFinished)))
      .catch(() => {});
  }, []);

  useEffect(loadMenu, [loadMenu]);
  useEffect(loadOrders, [loadOrders]);
  useRealtime((e: ServerEvent) => {
    if (e.type === 'hello' || e.type === 'menu.updated') loadMenu();
    if (e.type === 'hello') loadOrders();
    if (e.type === 'order.created' || e.type === 'order.updated') {
      if (e.order.customerName) loadCustomers();
      setOrders((all) =>
        [...all.filter((o) => o.id !== e.order.id), e.order].sort(
          byOpenThenFinished
        )
      );
    }
    if (e.type === 'order.deleted') {
      setOrders((all) => all.filter((o) => o.id !== e.id));
    }
  });

  const reset = () => {
    setLines([]);
    setCustomer('');
    setEmployeeMeal(false);
    setEditing(null);
  };

  const startEdit = (order: OrderRecord) => {
    if (!isActive(order)) return;
    if (lines.length > 0 && editing?.id !== order.id) {
      showToast({ message: t.order.finishFirst, tone: 'danger' });
      return;
    }
    const loaded = menu && linesFor(order, menu);
    if (!loaded) {
      showToast({
        message: format(t.order.cantEdit, { n: order.orderNumber }),
        tone: 'danger',
      });
      return;
    }
    setLines(loaded);
    setCustomer(order.customerName ?? '');
    setEmployeeMeal(order.employeeMeal);
    setEditing(order);
    setView('new');
  };

  const send = async () => {
    setSending(true);
    try {
      const body = {
        customerName: customer.trim() || undefined,
        items: orderItems(lines),
        employeeMeal,
      };
      const order = editing
        ? await put<OrderRecord>(`/orders/${editing.id}`, body)
        : await post<OrderRecord>('/orders', body);
      reset();
      showToast({
        message: format(editing ? t.order.updated : t.order.sent, {
          order: orderLabel(order),
        }),
        tone: 'ok',
      });
    } catch (err) {
      showToast({ message: errorMessage(t, err), tone: 'danger' });
      loadMenu();
      // The kitchen may have closed it meanwhile; editing it is over then.
      if (editing) {
        loadOrders();
        reset();
      }
    } finally {
      setSending(false);
    }
  };

  const money = (c: number) => formatCents(c, health.currency);

  return (
    <div className="tt-shell">
      <SurfaceHeader
        surface="order"
        view={view}
        onView={setView}
        views={[
          { value: 'new', label: t.order.new },
          { value: 'orders', label: t.order.orders, count: openCount },
        ]}
      />
      <main className="tt-main tt-order">
        <section className="tt-stack">
          {view === 'orders' ? (
            orders.length === 0 ? (
              <EmptyState>{t.order.emptyOrders}</EmptyState>
            ) : (
              <div className="tt-kitchen">
                {orders.map((o) => (
                  <Card
                    key={o.id}
                    className="tt-ticket"
                    data-selected={editing?.id === o.id || undefined}
                    data-done={!isActive(o) || undefined}
                    data-cancelled={o.status === 'cancelled' || undefined}
                    padding="md"
                    interactive={isActive(o)}
                    onClick={() => startEdit(o)}
                  >
                    <TicketHead order={o}>
                      <span className="tt-small tt-muted">
                        {new Date(o.createdAt).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </TicketHead>
                    {o.status === 'completed' && (
                      <Badge tone="ok" dot>
                        {t.order.completed}
                      </Badge>
                    )}
                    {o.status === 'cancelled' && (
                      <Badge tone="danger" dot>
                        {t.order.cancelled}
                      </Badge>
                    )}
                    <TicketLines order={o} />
                    <div className="tt-totals">
                      <span className="tt-muted">{t.order.subtotal}</span>
                      <span className="tt-money">{money(o.subtotalCents)}</span>
                    </div>
                  </Card>
                ))}
              </div>
            )
          ) : menu && menu.categories.length > 0 ? (
            <>
              <MenuTiles
                menu={menu}
                currency={health.currency}
                onPick={cart.pick}
              />
            </>
          ) : (
            <EmptyState>{menu ? t.order.noMenu : t.order.loading}</EmptyState>
          )}
        </section>

        <Card className="tt-cart" padding="md">
          <div className="tt-stack">
            {editing && (
              <div className="tt-row" data-between>
                <strong>
                  {format(t.order.editing, { order: orderLabel(editing) })}
                </strong>
                <Button variant="ghost" size="sm" onClick={reset}>
                  {t.order.discard}
                </Button>
              </div>
            )}
            <Input
              size="sm"
              placeholder={t.order.customer}
              aria-label={t.order.customer}
              list="tt-customers"
              autoComplete="off"
              maxLength={60}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
            <EmployeeMealToggle on={employeeMeal} onChange={setEmployeeMeal} />
            <datalist id="tt-customers">
              {customers.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <CartLines cart={cart} currency={health.currency} />
            <div className="tt-totals">
              <span className="tt-muted">{t.order.subtotal}</span>
              <span className="tt-money">
                {money(employeeMeal ? 0 : cart.subtotal)}
              </span>
              {employeeMeal ? (
                <>
                  <span className="tt-small tt-muted">
                    {t.order.employeeMealNote}
                  </span>
                  <span />
                </>
              ) : (
                health.taxEnabled && (
                  <>
                    <span className="tt-small tt-muted">{t.order.taxNote}</span>
                    <span />
                  </>
                )
              )}
            </div>
            <Button
              size="lg"
              disabled={lines.length === 0}
              loading={sending}
              onClick={send}
            >
              {editing ? t.order.save : t.order.send}
            </Button>
          </div>
        </Card>
      </main>

      <CartPicker cart={cart} currency={health.currency} />
    </div>
  );
}
