import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type {
  InventoryEntry,
  InventoryHistory,
  InventoryItem,
} from '@torta/shared';
import { Button, IconButton, Input } from '@binarygarden/flora/form';
import { IconCheck, IconPlus, IconTrashcan } from '@binarygarden/flora/icons';
import { Tabs } from '@binarygarden/flora/navigation';
import { useDialog, useToast } from '@binarygarden/flora/overlay';
import { EmptyState, Stat, Table } from '@binarygarden/flora/ui';
import { del, get, patch, put } from '../../api/http';
import {
  daysOf,
  isoDate,
  shortDate,
  type Period,
} from '../../components/dates';
import { FormDialog } from '../../components/form-dialog';
import { useHealth } from '../../components/health';
import { matches } from '../../components/inventory';
import {
  InventoryDialog,
  type InventoryBody,
} from '../../components/inventory-dialog';
import { formatCents, parseDollars, toDollars } from '../../components/money';
import { PeriodPicker } from '../../components/period-picker';
import { useUnits } from '../../components/units';
import { errorMessage, format, useT } from '../../i18n';

type View = 'stock' | 'history';
type Dialog =
  | { kind: 'item'; item: InventoryItem }
  | { kind: 'entry'; entry: InventoryEntry };

export function AdminInventory() {
  const [view, setView] = useState<View>('stock');
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(() => new Date());
  const [history, setHistory] = useState<InventoryHistory | null>(null);
  const [today] = useState(() => isoDate(new Date()));
  const { showConfirm } = useDialog();
  const { health } = useHealth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const units = useUnits();
  const t = useT();
  const money = (c: number) => formatCents(c, health.currency);
  const signedMoney = (c: number) =>
    c === 0 ? money(0) : `${c < 0 ? '−' : '+'}${money(Math.abs(c))}`;
  const amount = (qty: number, kind: InventoryItem['kind']) =>
    units.format(qty, kind);
  // How far a count was from what was expected: "260 g short", "20 extra".
  const offBy = (diff: number | null, kind: InventoryItem['kind']) =>
    diff === null
      ? '—'
      : diff === 0
        ? t.inventory.matched
        : format(diff < 0 ? t.inventory.short : t.inventory.extra, {
            qty: amount(Math.abs(diff), kind),
          });

  const days = useMemo(() => daysOf(period, anchor), [period, anchor]);
  const from = isoDate(days[0]!);
  const to = isoDate(days.at(-1)!);

  const load = useCallback(() => {
    get<InventoryItem[]>('/admin/inventory')
      .then(setItems)
      .catch((e) => showToast({ message: errorMessage(t, e), tone: 'danger' }));
    get<InventoryHistory>(`/admin/inventory/history?from=${from}&to=${to}`)
      .then(setHistory)
      .catch((e) => showToast({ message: errorMessage(t, e), tone: 'danger' }));
  }, [from, to, showToast, t]);
  useEffect(load, [load]);

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      load();
      setDialog(null);
    } catch (e) {
      showToast({ message: errorMessage(t, e), tone: 'danger' });
    }
  };

  if (!items) return null;
  const rows = items.filter((i) => matches(i, query));
  const value = items.reduce((s, i) => s + i.valueCents, 0);

  return (
    <>
      <div className="tt-row" data-between>
        <h1>{t.inventory.title}</h1>
        <span className="tt-row">
          {items.length > 0 && (
            <Button
              iconLeft={<IconCheck size={14} />}
              onClick={() => navigate('/admin/inventory/count')}
            >
              {t.inventory.count}
            </Button>
          )}
          {/* A delivery is also where new items are added, so it stays even
              when the inventory is empty. */}
          <Button
            iconLeft={<IconPlus size={14} />}
            onClick={() => navigate('/admin/inventory/delivery')}
          >
            {t.inventory.delivery}
          </Button>
        </span>
      </div>
      {items.length > 0 && (
        <Tabs
          variant="line"
          value={view}
          onChange={(v) => setView(v as View)}
          items={[
            { value: 'stock', label: t.inventory.onHand },
            { value: 'history', label: t.inventory.history },
          ]}
        />
      )}

      {items.length === 0 ? (
        <EmptyState>{t.inventory.empty}</EmptyState>
      ) : view === 'stock' ? (
        <>
          <p className="tt-total">
            <span className="tt-label">{t.inventory.totalValue}</span>
            <strong>{money(value)}</strong>
          </p>
          <Input
            placeholder={t.inventory.find}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {rows.length === 0 ? (
            <EmptyState>{t.inventory.noMatches}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th data-action>#</th>
                  <th>{t.inventory.item}</th>
                  <th data-num>{t.inventory.onHand}</th>
                  <th data-num>{t.inventory.value}</th>
                  <th data-num>{t.inventory.lastCount}</th>
                  <th data-num>{t.inventory.offBy}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td data-action className="tt-muted">
                      #{i.code}
                    </td>
                    <td>{i.name}</td>
                    <td data-num data-low={i.expectedLeft <= 0 || undefined}>
                      {amount(Math.max(0, i.expectedLeft), i.kind)}
                    </td>
                    <td data-num className="tt-muted">
                      {money(i.valueCents)}
                    </td>
                    <td data-num className="tt-muted">
                      {i.lastCount
                        ? `${amount(i.lastCount.qty, i.kind)} · ${shortDate(i.lastCount.at)}`
                        : t.inventory.never}
                    </td>
                    <td
                      data-num
                      data-low={(i.lastCount?.diff ?? 0) < 0 || undefined}
                      className={i.lastCount?.diff ? undefined : 'tt-muted'}
                    >
                      {offBy(i.lastCount?.diff ?? null, i.kind)}
                    </td>
                    <td data-action>
                      <span className="tt-row" data-end>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'item', item: i })}
                        >
                          {t.edit}
                        </Button>
                        <IconButton
                          size="sm"
                          label={t.inventory.deleteItem}
                          onClick={() =>
                            showConfirm(
                              format(t.inventory.deleteConfirm, {
                                name: i.name,
                              }),
                              () => run(del(`/admin/inventory/${i.id}`))
                            )
                          }
                        >
                          <IconTrashcan size={16} />
                        </IconButton>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : (
        <>
          <PeriodPicker
            period={period}
            anchor={anchor}
            days={days}
            today={today}
            onChange={(p, a) => {
              setPeriod(p);
              setAnchor(a);
            }}
          />
          {history && (
            <>
              <div className="tt-stats">
                <Stat
                  label={t.inventory.deliveries}
                  value={money(history.totals.receivedCents)}
                />
                <Stat
                  label={t.inventory.used}
                  value={money(history.totals.usedCents)}
                  hint={t.inventory.usedHint}
                />
                <Stat
                  label={t.inventory.offBy}
                  value={signedMoney(history.totals.diffCents)}
                />
              </div>
              {history.entries.length === 0 ? (
                <EmptyState>{t.inventory.historyEmpty}</EmptyState>
              ) : (
                <>
                  <Table>
                    <thead>
                      <tr>
                        <th data-action>{t.inventory.date}</th>
                        <th>{t.inventory.item}</th>
                        <th data-num>{t.inventory.whatHappened}</th>
                        <th data-num>{t.inventory.offBy}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {history.entries.map((e) => (
                        <tr key={e.id}>
                          <td data-action className="tt-muted">
                            {shortDate(e.businessDate)}
                          </td>
                          <td>
                            <span className="tt-muted">#{e.code}</span> {e.name}
                          </td>
                          <td data-num>
                            {e.entry === 'received'
                              ? `${format(t.inventory.entryDelivery, { qty: amount(e.qty, e.kind) })} · ${money(e.costCents)}`
                              : format(t.inventory.entryCount, {
                                  qty: amount(e.qty, e.kind),
                                })}
                          </td>
                          <td
                            data-num
                            data-low={
                              (e.expected !== null && e.qty < e.expected) ||
                              undefined
                            }
                            className="tt-muted"
                          >
                            {e.entry === 'counted' && e.expected !== null
                              ? offBy(e.qty - e.expected, e.kind)
                              : ''}
                          </td>
                          <td data-action>
                            <span className="tt-row" data-end>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setDialog({ kind: 'entry', entry: e })
                                }
                              >
                                {t.edit}
                              </Button>
                              <IconButton
                                size="sm"
                                label={t.inventory.deleteEntry}
                                onClick={() =>
                                  showConfirm(
                                    t.inventory.deleteEntryConfirm,
                                    () =>
                                      run(
                                        del(`/admin/inventory/entries/${e.id}`)
                                      )
                                  )
                                }
                              >
                                <IconTrashcan size={16} />
                              </IconButton>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </>
          )}
        </>
      )}

      {dialog?.kind === 'item' && (
        <InventoryDialog
          // Remount when a scan switches to another item.
          key={dialog.item.id}
          item={dialog.item}
          onOpen={(item) => setDialog({ kind: 'item', item })}
          onClose={() => setDialog(null)}
          onSubmit={(body: InventoryBody) =>
            run(patch(`/admin/inventory/${dialog.item.id}`, body))
          }
        />
      )}
      {dialog?.kind === 'entry' && (
        <EntryDialog
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onSubmit={(qty, costCents) =>
            run(
              put('/admin/inventory/entries', {
                inventoryItemId: dialog.entry.inventoryItemId,
                kind: dialog.entry.entry,
                businessDate: dialog.entry.businessDate,
                qty,
                ...(costCents !== undefined ? { costCents } : {}),
              })
            )
          }
        />
      )}
    </>
  );
}

/** Fixes one line of the log: the amount, and what was paid for a delivery. */
function EntryDialog({
  entry,
  onClose,
  onSubmit,
}: {
  entry: InventoryEntry;
  onClose: () => void;
  onSubmit: (qty: number, costCents?: number) => void;
}) {
  const units = useUnits();
  const t = useT();
  const [value, setValue] = useState(units.toField(entry.qty, entry.kind));
  const [paid, setPaid] = useState(toDollars(entry.costCents));
  const qty = units.fromField(value, entry.kind);
  const cents = parseDollars(paid);
  const received = entry.entry === 'received';
  return (
    <FormDialog
      title={`${shortDate(entry.businessDate)} · ${entry.name}`}
      onClose={onClose}
      onSubmit={() =>
        qty !== null &&
        (!received || cents !== null) &&
        onSubmit(qty, received ? (cents ?? undefined) : undefined)
      }
    >
      <Input
        label={units.named(
          received ? t.inventory.cameIn : t.inventory.onShelf,
          entry.kind
        )}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={value && qty === null ? t.notAmount : undefined}
        autoFocus
        required
      />
      {received && (
        <Input
          label={t.inventory.paid}
          inputMode="decimal"
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
          error={paid && cents === null ? t.notPrice : undefined}
          required
        />
      )}
    </FormDialog>
  );
}
