import { createContext, useContext, useEffect, useState } from 'react';
import { get, type Health } from '../api/http';

const fallback: Health = {
  ok: false,
  version: '',
  restaurantName: null,
  currency: 'USD',
  taxEnabled: false,
  weightUnit: 'g',
  liquidUnit: 'ml',
};

const Ctx = createContext<{ health: Health; refresh: () => void }>({
  health: fallback,
  refresh: () => {},
});

export const useHealth = () => useContext(Ctx);

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<Health>(fallback);
  const refresh = () => {
    get<Health>('/health')
      .then(setHealth)
      .catch(() => {});
  };
  useEffect(refresh, []);
  return <Ctx.Provider value={{ health, refresh }}>{children}</Ctx.Provider>;
}
