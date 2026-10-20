import type { Order } from '@torta/shared';

/** "Maria #12", or "#12" when the order has no customer name. */
export function OrderTitle({ order }: { order: Order }) {
  return (
    <span className="tt-ticket-number">
      {order.customerName}
      {order.customerName && ' '}
      <span className={order.customerName ? 'tt-muted' : undefined}>
        #{order.orderNumber}
      </span>
    </span>
  );
}

/** The same as plain text, for toasts and headings. */
export const orderLabel = (order: Order) =>
  order.customerName
    ? `${order.customerName} #${order.orderNumber}`
    : `#${order.orderNumber}`;
