import { useNavigate } from 'react-router';
import { Tabs, type TabItem } from '@binarygarden/flora/navigation';
import { ThemeToggleButton } from '@binarygarden/flora/theme';
import { setSurface, type Surface } from '../api/auth';
import { CollapsingTabs } from './collapsing-tabs';
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
  return (
    <CollapsingTabs
      value={surface}
      // Admin isn't a surface the tablet remembers; it still asks for the password.
      onChange={(to) => {
        if (to === 'order' || to === 'kitchen') setSurface(to);
        navigate(`/${to}`);
      }}
      items={[
        { value: 'order', label: t.orders.order },
        { value: 'kitchen', label: t.orders.kitchen },
        { value: 'admin', label: t.orders.admin },
      ]}
    />
  );
}
