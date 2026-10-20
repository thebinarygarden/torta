import type { Order, OrderItem } from '@torta/shared';
import { Badge } from '@binarygarden/flora/ui';
import { useT } from '../i18n';
import { ingredientNote } from './choices';
import { OrderTitle } from './order-title';

/** How an order reads on a ticket, the same on the kitchen and order screens. */
export function TicketHead({
  order,
  children,
}: {
  order: Order;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <>
      <div className="tt-ticket-head">
        <OrderTitle order={order} />
        {children}
      </div>
      {order.employeeMeal && <Badge>{t.order.employeeMeal}</Badge>}
    </>
  );
}

/** Items made exactly alike: same options, same changes, same note. */
const sameKey = (i: OrderItem) =>
  [
    i.itemId ?? i.name,
    ...i.modifiers.map((m) => m.id).sort(),
    ...i.ingredients.map((g) => `${g.id}=${g.choice}`).sort(),
    i.notes ?? '',
  ].join(',');

/** Identical items share a line with their count; any difference gets its own. */
export function TicketLines({ order }: { order: Order }) {
  const lines = new Map<string, OrderItem>();
  for (const i of order.items) {
    const key = sameKey(i);
    const twin = lines.get(key);
    lines.set(key, twin ? { ...twin, qty: twin.qty + i.qty } : i);
  }
  return (
    <>
      <ul>
        {[...lines].map(([key, item]) => (
          <TicketLine key={key} item={item} />
        ))}
      </ul>
      {order.notes && <p className="tt-small">“{order.notes}”</p>}
    </>
  );
}

function TicketLine({ item }: { item: OrderItem }) {
  const t = useT();
  return (
    <li>
      <span>
        {item.qty > 1 && <strong className="tt-count">{item.qty}×</strong>}
        {item.name}
      </span>
      {item.modifiers.map((m) => (
        <div key={m.id} className="tt-small tt-muted">
          {m.name}
        </div>
      ))}
      {item.ingredients.length > 0 && (
        <div className="tt-change-list">
          {item.ingredients.map((g) => (
            <span key={g.id} className="tt-change" data-choice={g.choice}>
              {ingredientNote(t, g)}
            </span>
          ))}
        </div>
      )}
      {item.notes && <div className="tt-small">“{item.notes}”</div>}
    </li>
  );
}
