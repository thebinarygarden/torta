import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type {
  InventoryEntry,
  InventoryHistory,
  InventoryItem,
} from '@torta/shared';
import { Button, IconButton, Input } from '@binarygarden/flora/form';
import { IconCheck, IconPlus, IconTrashcan } from '@binarygarden/flora/icons';
import { useDialog, useToast } from '@binarygarden/flora/overlay';
import { Card, EmptyState } from '@binarygarden/flora/ui';
import { del, get, post, put } from '../../api/http';
import { isoDate } from '../../components/dates';
import { useHealth } from '../../components/health';
import {
  findByCode,
  lookup,
  matches,
  packPrice,
} from '../../components/inventory';
import {
  InventoryDialog,
  type InventoryBody,
  type InventoryInitial,
} from '../../components/inventory-dialog';
import { formatCents, parseDollars, toDollars } from '../../components/money';
import { useUnits } from '../../components/units';
import { errorMessage, format, useT } from '../../i18n';

const SCAN_ID = 'tt-scan';
const rowId = (id: string) => `tt-delivery-${id}`;
const focus = (id: string) => {
  const el = document.getElementById(id);
  el?.focus();
  el?.scrollIntoView({ block: 'center' });
};
const isBarcode = (code: string) => /^\d{8,}$/.test(code);

/**
 * The delivery sheet: the page starts with today's deliveries, and each item
 * that is scanned or picked gets a row for what came in and what it cost.
 * Each line saves itself.
 */
export function AdminInventoryDelivery() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  // Today's deliveries. The rows wait for them, so their inputs start out right.
  const [saved, setSaved] = useState<InventoryEntry[] | null>(null);
  // Items on the sheet, newest first: picked here, or already delivered today.
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  // The whole catalog, for picking without typing.
  const [browsing, setBrowsing] = useState(false);
  const [dialog, setDialog] = useState<InventoryInitial | null>(null);
  // A row to jump to once the list has it: the item a scan just created.
  const pending = useRef<string | null>(null);
  // Saves still on their way to the server; "back" waits for them.
  const inflight = useRef(0);
  const [today] = useState(() => isoDate(new Date()));
  const { showToast } = useToast();
  const { showConfirm } = useDialog();
  const navigate = useNavigate();
  const units = useUnits();
  const t = useT();

  const fail = useCallback(
    (e: unknown) => showToast({ message: errorMessage(t, e), tone: 'danger' }),
    [showToast, t]
  );
  const load = useCallback(() => {
    get<InventoryItem[]>('/admin/inventory').then(setItems).catch(fail);
    get<InventoryHistory>(`/admin/inventory/history?from=${today}&to=${today}`)
      .then((h) => {
        const lines = h.entries.filter((e) => e.entry === 'received');
        setSaved(lines);
        setPicked((p) => [
          ...p,
          ...lines
            .map((e) => e.inventoryItemId)
            .filter((id, i, all) => !p.includes(id) && all.indexOf(id) === i),
        ]);
      })
      .catch(fail);
  }, [today, fail]);
  useEffect(load, [load]);

  useEffect(() => {
    const id = pending.current;
    if (!id || !items?.some((i) => i.id === id)) return;
    pending.current = null;
    focus(rowId(id));
  }, [items]);

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

  const pick = (item: InventoryItem) => {
    setQuery('');
    setBrowsing(false);
    setPicked((p) => (p.includes(item.id) ? p : [item.id, ...p]));
    // The row may not exist yet; focus it on the next frame.
    requestAnimationFrame(() => focus(rowId(item.id)));
  };

  const suggestions =
    items && query.trim().length >= 2
      ? items.filter((i) => matches(i, query)).slice(0, 6)
      : [];

  const scan = async () => {
    if (!items) return;
    const code = query.trim();
    if (!code) return;
    const target = findByCode(items, code) ?? suggestions[0];
    if (target) return pick(target);
    // Something torta hasn't seen: a barcode is looked up online, a name is
    // just the start of a new item.
    const found = isBarcode(code) ? await lookup(code) : {};
    setDialog(
      isBarcode(code)
        ? { barcode: code, suggestion: found.suggestion }
        : { name: code }
    );
  };

  if (!items || !saved) return null;
  const rows = picked
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is InventoryItem => !!i);

  return (
    <>
      <div className="tt-row" data-between>
        <h1>{t.inventory.delivery}</h1>
        <span className="tt-row">
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<IconPlus size={14} />}
            onClick={() => setDialog({})}
          >
            {t.inventory.item}
          </Button>
          <Button size="sm" onClick={back}>
            {t.inventory.back}
          </Button>
        </span>
      </div>
      <div className="tt-stack" data-gap="sm">
        <div className="tt-row" data-top>
          <Input
            id={SCAN_ID}
            className="tt-grow"
            placeholder={t.inventory.scanOrSearch}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setBrowsing(false);
            }}
            // Scanners type the code and press enter.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                scan();
              }
            }}
            autoFocus
          />
          <Button
            variant={browsing ? 'primary' : 'ghost'}
            onClick={() => setBrowsing((b) => !b)}
          >
            {t.inventory.browse}
          </Button>
        </div>
        {(browsing || suggestions.length > 0) && (
          <Card padding="sm">
            {(browsing ? items : suggestions).map((i) => (
              <button
                key={i.id}
                type="button"
                className="tt-suggestion"
                onClick={() => pick(i)}
              >
                <span className="tt-muted">#{i.code}</span> {i.name}
                <span className="tt-muted tt-small">
                  {' · '}
                  {units.format(Math.max(0, i.expectedLeft), i.kind)}
                </span>
              </button>
            ))}
          </Card>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState>
          {items.length === 0 ? t.inventory.empty : t.inventory.deliveryEmpty}
        </EmptyState>
      ) : (
        <div className="tt-stack">
          {rows.map((item) => (
            <DeliveryRow
              key={item.id}
              item={item}
              saved={saved.find((e) => e.inventoryItemId === item.id)}
              track={track}
              onChange={load}
              onRemove={() => {
                const line = saved.find((e) => e.inventoryItemId === item.id);
                const drop = () => {
                  setPicked((p) => p.filter((id) => id !== item.id));
                  if (!line) return;
                  track(del(`/admin/inventory/entries/${line.id}`))
                    .then(load)
                    .catch(fail);
                };
                if (!line) return drop();
                showConfirm(
                  format(t.inventory.removeConfirm, { name: item.name }),
                  drop
                );
              }}
            />
          ))}
        </div>
      )}
      {dialog && (
        <InventoryDialog
          initial={dialog}
          onOpen={(item) => {
            setDialog(null);
            pick(item);
          }}
          onClose={() => {
            setDialog(null);
            focus(SCAN_ID);
          }}
          onSubmit={(body: InventoryBody) =>
            // A product added from here came in today: one pack, at its price.
            track(
              post<InventoryItem>('/admin/inventory', body).then((item) =>
                put('/admin/inventory/entries', {
                  inventoryItemId: item.id,
                  kind: 'received',
                  qty: item.packSize,
                  costCents: item.packCostCents,
                }).then(() => item)
              )
            )
              .then((item) => {
                setDialog(null);
                setQuery('');
                setPicked((p) => [item.id, ...p]);
                pending.current = item.id;
                load();
              })
              .catch(fail)
          }
        />
      )}
    </>
  );
}

function DeliveryRow({
  item,
  saved,
  track,
  onChange,
  onRemove,
}: {
  item: InventoryItem;
  /** Today's delivery of this item, if one was already typed. */
  saved?: InventoryEntry;
  track: <T>(p: Promise<T>) => Promise<T>;
  onChange: () => void;
  /** Takes the item off today's sheet, line included. */
  onRemove: () => void;
}) {
  const units = useUnits();
  const { health } = useHealth();
  const { showToast } = useToast();
  const t = useT();
  const money = (c: number) => formatCents(c, health.currency);

  const [qtyText, setQtyText] = useState(
    saved ? units.toField(saved.qty, item.kind) : ''
  );
  const [paid, setPaid] = useState(saved ? toDollars(saved.costCents) : '');
  // The price fills itself in from the amount until the owner types one.
  const [paidTouched, setPaidTouched] = useState(!!saved);

  const fail = (e: unknown) =>
    showToast({ message: errorMessage(t, e), tone: 'danger' });
  const save = () => {
    const qty = units.fromField(qtyText, item.kind);
    const cents = parseDollars(paid);
    if (qty === null || qty === 0) {
      if (saved && qtyText.trim() === '') {
        track(del(`/admin/inventory/entries/${saved.id}`))
          .then(onChange)
          .catch(fail);
      }
      return;
    }
    if (cents === null) return;
    if (saved && saved.qty === qty && saved.costCents === cents) return;
    track(
      put('/admin/inventory/entries', {
        inventoryItemId: item.id,
        kind: 'received',
        qty,
        costCents: cents,
      })
    )
      .then(onChange)
      .catch(fail);
  };
  // Enter moves on; the blur saves.
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
      focus(SCAN_ID);
    }
  };

  return (
    <Card padding="md">
      <div className="tt-stack" data-gap="sm">
        <div className="tt-row" data-between>
          <span>
            <span className="tt-muted">#{item.code}</span>{' '}
            <strong>{item.name}</strong>
          </span>
          <span className="tt-row">
            {saved && (
              <span className="tt-muted" aria-label={t.save}>
                <IconCheck size={14} />
              </span>
            )}
            <IconButton size="sm" label={t.inventory.remove} onClick={onRemove}>
              <IconTrashcan size={16} />
            </IconButton>
          </span>
        </div>
        <div className="tt-row" data-top>
          <Input
            id={rowId(item.id)}
            label={units.named(t.inventory.cameIn, item.kind)}
            inputMode="decimal"
            value={qtyText}
            onChange={(e) => {
              setQtyText(e.target.value);
              const qty = units.fromField(e.target.value, item.kind);
              if (!paidTouched) {
                setPaid(qty ? toDollars(packPrice(qty, item)) : '');
              }
            }}
            onBlur={save}
            onKeyDown={onEnter}
            error={
              qtyText && units.fromField(qtyText, item.kind) === null
                ? t.notAmount
                : undefined
            }
          />
          <Input
            label={t.inventory.paid}
            inputMode="decimal"
            value={paid}
            onChange={(e) => {
              setPaidTouched(true);
              setPaid(e.target.value);
            }}
            onBlur={save}
            onKeyDown={onEnter}
            hint={
              saved
                ? format(t.inventory.per, {
                    price: money(item.packCostCents),
                    size: units.format(item.packSize, item.kind),
                  })
                : t.inventory.paidHint
            }
            error={paid && parseDollars(paid) === null ? t.notPrice : undefined}
          />
        </div>
      </div>
    </Card>
  );
}
