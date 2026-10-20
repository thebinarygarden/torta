import { useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { Order } from '@torta/shared';
import { Button, Input } from '@binarygarden/flora/form';
import { Card, EmptyState } from '@binarygarden/flora/ui';
import { useToast } from '@binarygarden/flora/overlay';
import { post } from '../../api/http';
import {
  CartLines,
  CartPicker,
  EmployeeMealToggle,
  MenuTiles,
  orderItems,
  useCart,
} from '../../components/cart';
import { isoDate } from '../../components/dates';
import { useHealth } from '../../components/health';
import { formatCents } from '../../components/money';
import { orderLabel } from '../../components/order-title';
import { errorMessage, format, useT } from '../../i18n';
import type { AdminContext } from './layout';

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * The owner entering an order after the fact: same menu and cart as the order
 * screen, at the day and time it happened. It is saved already completed.
 */
export function AdminSaleNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { health } = useHealth();
  const { showToast } = useToast();
  const t = useT();
  const cart = useCart();
  const { menu, reloadMenu } = useOutletContext<AdminContext>();
  // Read once on mount: the clock is not read during render.
  const [now] = useState(() => new Date());
  const [date, setDate] = useState(() => {
    const d = params.get('date');
    return d && d <= isoDate(now) ? d : isoDate(now);
  });
  const [time, setTime] = useState(() =>
    date === isoDate(now) ? hhmm(now) : '12:00'
  );
  const [customer, setCustomer] = useState('');
  const [employeeMeal, setEmployeeMeal] = useState(false);
  const [saving, setSaving] = useState(false);

  const at = new Date(`${date}T${time}`);
  const valid = !Number.isNaN(at.getTime()) && at <= now;
  const back = (day: string) => navigate(`/admin/sales?date=${day}`);

  const save = async () => {
    setSaving(true);
    try {
      const order = await post<Order>('/admin/orders', {
        at: at.toISOString(),
        customerName: customer.trim() || undefined,
        items: orderItems(cart.lines),
        employeeMeal,
      });
      showToast({
        message: format(t.sales.added, { order: orderLabel(order) }),
        tone: 'ok',
      });
      back(order.businessDate);
    } catch (err) {
      showToast({ message: errorMessage(t, err), tone: 'danger' });
      reloadMenu();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>{t.sales.addOrder}</h1>
      <p className="tt-muted">{t.sales.addOrderHint}</p>
      <div className="tt-order">
        <section className="tt-stack">
          {menu && menu.categories.length > 0 ? (
            <MenuTiles
              menu={menu}
              currency={health.currency}
              onPick={cart.pick}
              allowUnavailable
            />
          ) : (
            <EmptyState>{menu ? t.order.noMenu : t.order.loading}</EmptyState>
          )}
        </section>
        <Card className="tt-cart" padding="md">
          <div className="tt-stack">
            <div className="tt-row">
              <Input
                size="sm"
                type="date"
                label={t.sales.date}
                max={isoDate(now)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <Input
                size="sm"
                type="time"
                label={t.sales.time}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            {!valid && <p className="tt-small tt-muted">{t.sales.pastOnly}</p>}
            <Input
              size="sm"
              placeholder={t.order.customer}
              aria-label={t.order.customer}
              autoComplete="off"
              maxLength={60}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
            <EmployeeMealToggle on={employeeMeal} onChange={setEmployeeMeal} />
            <CartLines cart={cart} currency={health.currency} />
            <div className="tt-totals">
              <span className="tt-muted">{t.order.subtotal}</span>
              <span className="tt-money">
                {formatCents(employeeMeal ? 0 : cart.subtotal, health.currency)}
              </span>
            </div>
            <div className="tt-row" data-end>
              <Button variant="ghost" onClick={() => back(date)}>
                {t.cancel}
              </Button>
              <Button
                disabled={cart.lines.length === 0 || !valid}
                loading={saving}
                onClick={save}
              >
                {t.sales.saveOrder}
              </Button>
            </div>
          </div>
        </Card>
      </div>
      <CartPicker cart={cart} currency={health.currency} />
    </>
  );
}
