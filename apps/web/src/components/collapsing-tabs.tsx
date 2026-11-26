import { useEffect, useRef, useState } from 'react';
import { Button } from '@binarygarden/flora/form';
import { Tabs, type TabItem } from '@binarygarden/flora/navigation';

/**
 * A pick-one that rests as a single button naming the current choice. Tapping
 * it opens every choice as pill tabs; picking one, tapping away or Escape
 * closes it again.
 */
export function CollapsingTabs({
  items,
  value,
  onChange,
  variant,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: 'primary' | 'secondary';
}) {
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

  return (
    <div ref={ref}>
      {open ? (
        <Tabs
          variant="pill"
          value={value}
          onChange={(v) => {
            setOpen(false);
            if (v !== value) onChange(v);
          }}
          items={items}
        />
      ) : (
        <Button
          size="sm"
          variant={variant}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          {items.find((i) => i.value === value)?.label}
        </Button>
      )}
    </div>
  );
}
