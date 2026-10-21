import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type {
  InventoryEntry,
  InventoryHistory,
  InventoryItem,
} from '@torta/shared';
import { Button, Input } from '@binarygarden/flora/form';
import { IconCheck } from '@binarygarden/flora/icons';
import { useToast } from '@binarygarden/flora/overlay';
import { EmptyState, Table } from '@binarygarden/flora/ui';
import { del, get, put } from '../../api/http';
import { isoDate } from '../../components/dates';
import { findByCode, matches } from '../../components/inventory';
import { useUnits } from '../../components/units';
import { errorMessage, format, useT } from '../../i18n';

const FIND_ID = 'tt-find';
const rowId = (id: string) => `tt-count-${id}`;
const focus = (id: string) => {
  const el = document.getElementById(id);
  el?.focus();
  el?.scrollIntoView({ block: 'center' });
};

/**
 * The count sheet: every item, with what torta thinks should be there and a
 * box for what the shelf holds. Fill in only what was counted; each line
 * saves itself.
 */
export function AdminInventoryCount() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  // Today's counts. The rows wait for them, so their inputs start out right.
  const [saved, setSaved] = useState<InventoryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  // Saves still on their way to the server; "back" waits for them.
  const inflight = useRef(0);
  const [today] = useState(() => isoDate(new Date()));
  const { showToast } = useToast();
  const navigate = useNavigate();
  const t = useT();

  const fail = useCallback(
    (e: unknown) => showToast({ message: errorMessage(t, e), tone: 'danger' }),
    [showToast, t]
  );
  const load = useCallback(() => {
    get<InventoryItem[]>('/admin/inventory').then(setItems).catch(fail);
    get<InventoryHistory>(`/admin/inventory/history?from=${today}&to=${today}`)
      .then((h) => setSaved(h.entries.filter((e) => e.entry === 'counted')))
      .catch(fail);
  }, [today, fail]);
  useEffect(load, [load]);

  const track = <T,>(p: Promise<T>) => {
    inflight.current++;
    return p.finally(() => {
      inflight.current--;
    });
  };
  const back = async () => {
    while (inflight.current > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    navigate('/admin/inventory');
  };

  if (!items || !saved) return null;
  const rows = items.filter((i) => matches(i, query));

  // Enter in the box jumps to the item a scanner or a person typed.
  const jump = () => {
    const target = findByCode(items, query) ?? rows[0];
    if (!target) return;
    setQuery('');
    requestAnimationFrame(() => focus(rowId(target.id)));
  };

  return (
    <>
      <div className="tt-row" data-between>
        <h1>{t.inventory.count}</h1>
        <Button size="sm" onClick={back}>
          {t.inventory.back}
        </Button>
      </div>
      <Input
        id={FIND_ID}
        placeholder={t.inventory.scanOrSearch}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            jump();
          }
        }}
        autoFocus
      />
      {rows.length === 0 ? (
        <EmptyState>
          {items.length === 0 ? t.inventory.empty : t.inventory.noMatches}
        </EmptyState>
      ) : (
        <Table>
          <tbody>
            {rows.map((item) => (
              <CountRow
                key={item.id}
                item={item}
                saved={saved.find((e) => e.inventoryItemId === item.id)}
                track={track}
                onChange={load}
              />
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function CountRow({
  item,
  saved,
  track,
  onChange,
}: {
  item: InventoryItem;
  /** Today's count of this item, if one was already typed. */
  saved?: InventoryEntry;
  track: <T>(p: Promise<T>) => Promise<T>;
  onChange: () => void;
}) {
  const units = useUnits();
  const { showToast } = useToast();
  const t = useT();
  const [text, setText] = useState(
    saved ? units.toField(saved.qty, item.kind) : ''
  );
  // Nothing to expect yet for an item never counted or delivered.
  const expects = item.lastCount !== null || item.expectedLeft > 0;

  const save = () => {
    const qty = units.fromField(text, item.kind);
    const fail = (e: unknown) =>
      showToast({ message: errorMessage(t, e), tone: 'danger' });
    if (qty === null) {
      if (saved && text.trim() === '') {
        track(del(`/admin/inventory/entries/${saved.id}`))
          .then(onChange)
          .catch(fail);
      }
      return;
    }
    if (saved && saved.qty === qty) return;
    track(
      put('/admin/inventory/entries', {
        inventoryItemId: item.id,
        kind: 'counted',
        qty,
      })
    )
      .then(onChange)
      .catch(fail);
  };

  return (
    <tr>
      <td data-action className="tt-muted">
        #{item.code}
      </td>
      <td>{item.name}</td>
      <td data-num className="tt-muted">
        {expects &&
          format(t.inventory.shouldBe, {
            qty: units.format(Math.max(0, item.expectedLeft), item.kind),
          })}
      </td>
      <td data-action className="tt-count-field">
        <Input
          id={rowId(item.id)}
          size="sm"
          aria-label={units.named(t.inventory.onShelf, item.kind)}
          placeholder={units.named(t.inventory.onShelf, item.kind)}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          // Enter moves on; the blur saves.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
              focus(FIND_ID);
            }
          }}
          error={
            text && units.fromField(text, item.kind) === null
              ? t.notAmount
              : undefined
          }
        />
      </td>
      <td data-action className="tt-muted">
        {saved && <IconCheck size={14} />}
      </td>
    </tr>
  );
}
