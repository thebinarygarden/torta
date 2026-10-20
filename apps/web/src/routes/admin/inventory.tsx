import { useCallback, useEffect, useState } from 'react';
import type { BarcodeLookup, InventoryItem, Kind } from '@torta/shared';
import { Button, IconButton, Input, Select } from '@binarygarden/flora/form';
import { IconPlus, IconTrashcan } from '@binarygarden/flora/icons';
import { useDialog, useToast } from '@binarygarden/flora/overlay';
import { EmptyState, Table } from '@binarygarden/flora/ui';
import { del, get, patch, post } from '../../api/http';
import { FormDialog } from '../../components/form-dialog';
import { useHealth } from '../../components/health';
import { formatCents, parseDollars, toDollars } from '../../components/money';
import { useUnits } from '../../components/units';
import { errorMessage, format, useT } from '../../i18n';

const lookup = (code: string) =>
  get<BarcodeLookup>(
    `/admin/inventory/barcode/${encodeURIComponent(code.trim())}`
  ).catch((): BarcodeLookup => ({}));

type Dialog =
  | { kind: 'edit'; item?: InventoryItem }
  | { kind: 'count'; item: InventoryItem };

export function AdminInventory() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { showConfirm } = useDialog();
  const { health } = useHealth();
  const units = useUnits();
  const { showToast } = useToast();
  const t = useT();
  const money = (c: number) => formatCents(c, health.currency);

  const load = useCallback(() => {
    get<InventoryItem[]>('/admin/inventory')
      .then(setItems)
      .catch((e) => showToast({ message: errorMessage(t, e), tone: 'danger' }));
  }, [showToast, t]);
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

  return (
    <>
      <div className="tt-row" data-between>
        <h1>{t.inventory.title}</h1>
        <span className="tt-row">
          <Button
            size="sm"
            iconLeft={<IconPlus size={14} />}
            onClick={() => setDialog({ kind: 'edit' })}
          >
            {t.inventory.item}
          </Button>
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState>{t.inventory.empty}</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t.inventory.item}</th>
              <th data-num>{t.inventory.shouldBeLeft}</th>
              <th data-num>{t.inventory.counted}</th>
              <th data-num>{t.inventory.youPay}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td data-num data-low={i.expectedLeft <= 0 || undefined}>
                  {units.format(Math.max(0, i.expectedLeft), i.kind)}
                </td>
                <td data-num className="tt-muted">
                  {units.format(i.onHand, i.kind)}
                </td>
                <td data-num className="tt-muted">
                  {format(t.inventory.per, {
                    price: money(i.packCostCents),
                    size: units.format(i.packSize, i.kind),
                  })}
                </td>
                <td>
                  <span className="tt-row" data-end>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: 'count', item: i })}
                    >
                      {t.inventory.count}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: 'edit', item: i })}
                    >
                      {t.edit}
                    </Button>
                    <IconButton
                      size="sm"
                      label={t.inventory.deleteItem}
                      onClick={() =>
                        showConfirm(
                          format(t.inventory.deleteConfirm, { name: i.name }),
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

      {dialog?.kind === 'count' && (
        <CountDialog
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSubmit={(onHand) =>
            run(patch(`/admin/inventory/${dialog.item.id}`, { onHand }))
          }
        />
      )}
      {dialog?.kind === 'edit' && (
        <InventoryDialog
          // Remount when a scan switches to another item.
          key={dialog.item?.id ?? 'new'}
          item={dialog.item}
          onOpen={(item) => setDialog({ kind: 'edit', item })}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            run(
              dialog.item
                ? patch(`/admin/inventory/${dialog.item.id}`, body)
                : post('/admin/inventory', body)
            )
          }
        />
      )}
    </>
  );
}

function InventoryDialog({
  item,
  onOpen,
  onClose,
  onSubmit,
}: {
  item?: InventoryItem;
  onOpen: (item: InventoryItem) => void;
  onClose: () => void;
  onSubmit: (body: {
    name: string;
    kind: Kind;
    barcode: string | null;
    packSize: number;
    packCostCents: number;
    onHand?: number;
  }) => void;
}) {
  const units = useUnits();
  const t = useT();
  const [kind, setKind] = useState<Kind>(item?.kind ?? 'weight');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [lookedUp, setLookedUp] = useState(barcode);
  const [status, setStatus] = useState('');
  const [name, setName] = useState(item?.name ?? '');
  const [packSize, setPackSize] = useState(
    item ? units.toField(item.packSize, item.kind) : ''
  );
  const [price, setPrice] = useState(item ? toDollars(item.packCostCents) : '');
  const [onHand, setOnHand] = useState(
    item ? units.toField(item.onHand, item.kind) : ''
  );

  const cents = parseDollars(price);
  const size = units.fromField(packSize, kind);
  const have = units.fromField(onHand, kind);
  const unit = units.label(kind);

  const findBarcode = async () => {
    const code = barcode.trim();
    if (!code || code === lookedUp) return;
    setLookedUp(code);
    setStatus(t.inventory.lookingUp);
    const found = await lookup(code);
    if (found.match && found.match.id !== item?.id) return onOpen(found.match);
    const s = found.suggestion;
    if (!s) return setStatus(item ? '' : t.inventory.notFound);
    if (!name.trim()) setName(s.name);
    if (s.kind) setKind(s.kind);
    if (s.kind && s.packSize && !packSize) {
      setPackSize(units.toField(s.packSize, s.kind));
    }
    setStatus(t.inventory.foundOnline);
  };

  return (
    <FormDialog
      title={item ? t.inventory.editTitle : t.inventory.newTitle}
      onClose={onClose}
      onSubmit={() =>
        name.trim() &&
        cents !== null &&
        size !== null &&
        size > 0 &&
        have !== null &&
        onSubmit({
          name: name.trim(),
          kind,
          barcode: barcode.trim() || null,
          packSize: size,
          packCostCents: cents,
          // Only send a count when it changed, so editing a name doesn't
          // restart the usage count.
          ...(item && onHand === units.toField(item.onHand, item.kind)
            ? {}
            : { onHand: have }),
        })
      }
    >
      <Input
        label={t.inventory.barcode}
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        // Scanners type the code and press enter; don't submit the form.
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            findBarcode();
          }
        }}
        onBlur={findBarcode}
        hint={status || t.inventory.barcodeHint}
        autoFocus={!item}
      />
      <Input
        label={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Select
        label={t.inventory.measuredBy}
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
        options={[
          {
            value: 'weight',
            label: format(t.inventory.weight, { unit: units.label('weight') }),
          },
          {
            value: 'liquid',
            label: format(t.inventory.volume, { unit: units.label('liquid') }),
          },
          {
            value: 'count',
            label: format(t.inventory.byCount, { unit: units.label('count') }),
          },
        ]}
      />
      <div className="tt-row">
        <Input
          label={format(t.inventory.youBuy, { unit })}
          inputMode="decimal"
          value={packSize}
          onChange={(e) => setPackSize(e.target.value)}
          error={packSize && !size ? t.notAmount : undefined}
          required
        />
        <Input
          label={t.inventory.for}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={price && cents === null ? t.notPrice : undefined}
          required
        />
      </div>
      <Input
        label={format(t.inventory.youHave, { unit })}
        inputMode="decimal"
        value={onHand}
        onChange={(e) => setOnHand(e.target.value)}
        error={onHand && have === null ? t.notAmount : undefined}
        hint={t.inventory.freshCount}
        required
      />
    </FormDialog>
  );
}

function CountDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: InventoryItem;
  onClose: () => void;
  onSubmit: (onHand: number) => void;
}) {
  const units = useUnits();
  const t = useT();
  const [value, setValue] = useState(
    units.toField(Math.max(0, item.expectedLeft), item.kind)
  );
  const have = units.fromField(value, item.kind);
  return (
    <FormDialog
      title={format(t.inventory.countTitle, { name: item.name })}
      onClose={onClose}
      onSubmit={() => have !== null && onSubmit(have)}
    >
      <Input
        label={format(t.inventory.youHave, { unit: units.label(item.kind) })}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={value && have === null ? t.notAmount : undefined}
        hint={t.inventory.countHint}
        autoFocus
        required
      />
    </FormDialog>
  );
}
