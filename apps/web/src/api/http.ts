import type { LiquidUnit, WeightUnit } from '@torta/shared';
import { getToken } from './auth';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string
  ) {
    super(message ?? code);
  }
}

export const UNAUTHORIZED_EVENT = 'torta:unauthorized';

type Init = { method?: string; body?: unknown };

export async function api<T = unknown>(
  path: string,
  init: Init = {}
): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new HttpError(res.status, data?.error ?? 'error', data?.message);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export type Health = {
  ok: boolean;
  version: string;
  restaurantName: string | null;
  currency: string;
  taxEnabled: boolean;
  weightUnit: WeightUnit;
  liquidUnit: LiquidUnit;
};
