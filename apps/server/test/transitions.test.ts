import { describe, expect, test } from 'vitest';
import { canTransition, orderStatus, type OrderStatus } from '@torta/shared';

const legal: [OrderStatus, OrderStatus][] = [
  ['sent', 'completed'],
  ['sent', 'cancelled'],
  ['completed', 'sent'],
  ['cancelled', 'sent'],
];

describe('order transitions', () => {
  test('legal moves', () => {
    for (const [from, to] of legal) expect(canTransition(from, to)).toBe(true);
  });

  test('every other move is illegal', () => {
    for (const from of orderStatus.options) {
      for (const to of orderStatus.options) {
        const isLegal = legal.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(isLegal);
      }
    }
  });
});
