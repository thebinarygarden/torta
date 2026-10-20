import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@binarygarden/flora/form';
import { Tabs, type TabItem } from '@binarygarden/flora/navigation';
import { ThemeToggleButton } from '@binarygarden/flora/theme';
import { setSurface, type Surface } from '../api/auth';
import { useHealth } from './health';
import { LocaleToggle } from './locale-toggle';
import { useT } from '../i18n';

/**
 * The shared top bar for the order and kitchen surfaces: the current surface,
 * then its views. The other surface stays hidden until the switch is tapped,
 * so every view shown belongs to the surface you're on.
 */
export function SurfaceHeader<V extends string>({
  surface,
  views,
  view,
  onView,
}: {
  surface: Surface;
  views: TabItem[];
  view: V;
  onView: (view: V) => void;
}) {
  const { health } = useHealth();
  const t = useT();
  return (
    <header className="tt-header">
      <span className="tt-brand">{health.restaurantName ?? 'torta'}</span>
      <div className="tt-header-nav">
        <SurfaceSwitch surface={surface} />
        <Tabs
          variant="pill"
          value={view}
          onChange={(v) => onView(v as V)}
          items={views}
        />
      </div>
      <div className="tt-row">
        <LocaleToggle />
        <ThemeToggleButton size="sm" labels={t.flora.theme} />
      </div>
    </header>
  );
}

function SurfaceSwitch({ surface }: { surface: Surface }) {
  const navigate = useNavigate();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // The opening click lands on the button it replaces, which is no longer
    // on the page by the time it bubbles here, so detached targets are ignored.
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (target.isConnected && !ref.current?.contains(target)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const label = { order: t.orders.order, kitchen: t.orders.kitchen };
  // Admin isn't a surface the tablet remembers; it still asks for the password.
  const go = (to: string) => {
    if (to === 'order' || to === 'kitchen') setSurface(to);
    navigate(`/${to}`);
  };
  return (
    <div ref={ref}>
      {open ? (
        <Tabs
          variant="pill"
          value={surface}
          onChange={(v) => {
            setOpen(false);
            if (v !== surface) go(v);
          }}
          items={[
            { value: 'order', label: label.order },
            { value: 'kitchen', label: label.kitchen },
            { value: 'admin', label: t.orders.admin },
          ]}
        />
      ) : (
        <Button size="sm" aria-expanded={false} onClick={() => setOpen(true)}>
          {label[surface]}
        </Button>
      )}
    </div>
  );
}
