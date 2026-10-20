import type { Order } from './orders';

/** Events the server pushes to every connected surface. */
export type ServerEvent =
  | { type: 'hello'; serverTime: string; version: string }
  | { type: 'order.created'; order: Order }
  | { type: 'order.updated'; order: Order }
  | { type: 'order.deleted'; id: string }
  | { type: 'menu.updated' };
