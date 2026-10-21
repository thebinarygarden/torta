import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import type { Menu } from '@torta/shared';
import { Button, IconButton, Input } from '@binarygarden/flora/form';
import { IconMenu, IconX } from '@binarygarden/flora/icons';
import { SidebarNav } from '@binarygarden/flora/navigation';
import { ThemeToggleButton } from '@binarygarden/flora/theme';
import { Card } from '@binarygarden/flora/ui';
import { useToast } from '@binarygarden/flora/overlay';
import { get, post } from '../../api/http';
import { useHealth } from '../../components/health';
import { LocaleToggle } from '../../components/locale-toggle';
import { errorMessage, useT } from '../../i18n';

type Gate = 'loading' | 'setup' | 'login' | 'in';

/** What admin pages get from `useOutletContext()`. */
export interface AdminContext {
  menu: Menu | null;
  reloadMenu: () => void;
}

// The sidebar's width and collapsed state are remembered per device.
const NAV_WIDTH = 'torta.nav.width';
const NAV_COLLAPSED = 'torta.nav.collapsed';
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
// Below this width the sidebar folds into a menu under a top bar.
const NARROW = '(max-width: 799px)';
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the sidebar just won't remember.
  }
};

export function AdminLayout() {
  const [gate, setGate] = useState<Gate>('loading');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [navWidth, setNavWidth] = useState(
    () => Number(stored(NAV_WIDTH)) || 220
  );
  const [navCollapsed, setNavCollapsed] = useState(
    () => stored(NAV_COLLAPSED) === 'true'
  );
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const { health, refresh } = useHealth();
  const { showToast } = useToast();
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const { categoryId } = useParams();

  // The menu lives here so the sidebar's categories and the menu page share it.
  const reloadMenu = useCallback(() => {
    get<Menu>('/menu')
      .then(setMenu)
      .catch((e) => showToast({ message: errorMessage(t, e), tone: 'danger' }));
  }, [showToast, t]);
  useEffect(() => {
    if (gate === 'in') reloadMenu();
  }, [gate, reloadMenu]);

  // Widening the window closes the menu; the sidebar is back in place.
  useEffect(() => {
    const query = matchMedia(NARROW);
    const onChange = () => {
      setNarrow(query.matches);
      if (!query.matches) setMenuOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    get<{ needsSetup: boolean }>('/setup')
      .then(({ needsSetup }) => {
        if (needsSetup) return setGate('setup');
        return fetch('/api/me').then((r) => setGate(r.ok ? 'in' : 'login'));
      })
      .catch(() => setGate('login'));
  }, []);

  if (gate === 'loading') return null;
  if (gate === 'setup') {
    return (
      <SetupForm
        onDone={() => {
          refresh();
          setGate('in');
        }}
      />
    );
  }
  if (gate === 'login') return <LoginForm onDone={() => setGate('in')} />;

  const section = location.pathname.split('/')[2] || 'overview';
  const categories = menu?.categories ?? [];
  return (
    <div className="tt-admin">
      <header className="tt-admin-bar">
        <span className="tt-brand">{health.restaurantName ?? 'torta'}</span>
        <IconButton
          label={menuOpen ? t.admin.closeMenu : t.admin.openMenu}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <IconX size={16} /> : <IconMenu size={16} />}
        </IconButton>
      </header>
      <aside id={menuId} className="tt-admin-nav" data-open={menuOpen}>
        <SidebarNav
          collapsible
          width={navWidth}
          onWidthChange={(w) => {
            setNavWidth(w);
            store(NAV_WIDTH, String(w));
          }}
          // A sidebar folded to a rail still opens in full in the menu.
          collapsed={navCollapsed && !narrow}
          onCollapsedChange={(c) => {
            setNavCollapsed(c);
            store(NAV_COLLAPSED, String(c));
          }}
          labels={t.flora.sidebar}
          header={
            <span className="tt-brand">{health.restaurantName ?? 'torta'}</span>
          }
          footer={
            <div className="tt-stack" data-gap="sm">
              <div className="tt-row" data-center>
                <LocaleToggle />
                <ThemeToggleButton size="sm" labels={t.flora.theme} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  post('/admin/logout').then(() => setGate('login'))
                }
              >
                {t.admin.signOut}
              </Button>
            </div>
          }
          current={categoryId ?? section}
          onSelect={(id) => {
            setMenuOpen(false);
            navigate(
              id === 'overview'
                ? '/admin'
                : categories.some((c) => c.id === id)
                  ? `/admin/menu/${id}`
                  : `/admin/${id}`
            );
          }}
          groups={[
            {
              items: [
                { id: 'overview', label: t.admin.overview },
                {
                  id: 'menu',
                  label: t.admin.menu,
                  children: categories.map((c) => ({
                    id: c.id,
                    label: c.name,
                    badge: c.items.length,
                  })),
                },
                { id: 'inventory', label: t.admin.inventory },
                { id: 'sales', label: t.admin.sales },
                { id: 'settings', label: t.admin.settings },
              ],
            },
            {
              title: t.admin.surfaces,
              items: [
                { id: 'order', label: t.orders.order, href: '/order' },
                { id: 'kitchen', label: t.orders.kitchen, href: '/kitchen' },
              ],
            },
          ]}
        />
      </aside>
      <main className="tt-admin-main">
        <Outlet context={{ menu, reloadMenu } satisfies AdminContext} />
      </main>
    </div>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await post('/setup', { restaurantName: name, password });
      onDone();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tt-center">
      <Card title={t.admin.setupTitle} description={t.admin.setupDescription}>
        <form className="tt-form" onSubmit={submit}>
          <Input
            label={t.admin.restaurant}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <Input
            label={t.admin.password}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t.admin.passwordHint}
            error={error}
            minLength={8}
            required
          />
          <Button type="submit" loading={busy}>
            {t.admin.start}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await post('/admin/login', { password });
      onDone();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tt-center">
      <Card title={t.admin.loginTitle}>
        <form className="tt-form" onSubmit={submit}>
          <Input
            label={t.admin.password}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
            autoFocus
            required
          />
          <Button type="submit" loading={busy}>
            {t.admin.signIn}
          </Button>
        </form>
      </Card>
    </div>
  );
}
