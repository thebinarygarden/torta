import { useState } from 'react';
import type { BarcodeLookup, InventoryItem, Kind } from '@torta/shared';
import { Input, Select } from '@binarygarden/flora/form';
import { FormDialog } from './form-dialog';
import { lookup } from './inventory';
import { parseDollars, toDollars } from './money';
import { useUnits } from './units';
import { format, useT } from '../i18n';

export type InventoryBody = {
  name: string;
  kind: Kind;
  barcode: string | null;
  packSize: number;
  packCostCents: number;
};

/** What a scan already knows about an item that isn't in inventory yet. */
export type InventoryInitial = {
  barcode?: string;
  name?: string;
  suggestion?: BarcodeLookup['suggestion'];
};

/** The form for one stock item: what it is, how it's measured and what it costs. */
export function InventoryDialog({
  item,
  initial,
  onOpen,
  onClose,
  onSubmit,
}: {
  item?: InventoryItem;
  initial?: InventoryInitial;
  /** A scan matched another item: show that one instead. */
  onOpen: (item: InventoryItem) => void;
  onClose: () => void;
  onSubmit: (body: InventoryBody) => void;
}) {
  const units = useUnits();
  const t = useT();
  const [kind, setKind] = useState<Kind>(
    item?.kind ?? initial?.suggestion?.kind ?? 'weight'
  );
  const [barcode, setBarcode] = useState(
    item?.barcode ?? initial?.barcode ?? ''
  );
  const [lookedUp, setLookedUp] = useState(barcode);
  const [status, setStatus] = useState(
    initial?.suggestion ? t.inventory.foundOnline : ''
  );
  const [name, setName] = useState(
    item?.name ?? initial?.suggestion?.name ?? initial?.name ?? ''
  );
  const [packSize, setPackSize] = useState(() => {
    if (item) return units.toField(item.packSize, item.kind);
    const s = initial?.suggestion;
    return s?.kind && s.packSize ? units.toField(s.packSize, s.kind) : '';
  });
  const [price, setPrice] = useState(item ? toDollars(item.packCostCents) : '');

  const cents = parseDollars(price);
  const size = units.fromField(packSize, kind);

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
      title={
        item
          ? format(t.inventory.editTitle, { code: item.code })
          : t.inventory.newTitle
      }
      onClose={onClose}
      onSubmit={() =>
        name.trim() &&
        cents !== null &&
        size !== null &&
        size > 0 &&
        onSubmit({
          name: name.trim(),
          kind,
          barcode: barcode.trim() || null,
          packSize: size,
          packCostCents: cents,
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
        autoFocus={!item && !initial}
      />
      <Input
        label={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus={!item && !!initial}
        required
      />
      <Select
        label={t.inventory.measuredBy}
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
        options={[
          { value: 'weight', label: units.named(t.inventory.weight, 'weight') },
          { value: 'liquid', label: units.named(t.inventory.volume, 'liquid') },
          { value: 'count', label: t.inventory.byCount },
        ]}
      />
      <div className="tt-row">
        <Input
          label={units.named(t.inventory.youBuy, kind)}
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
    </FormDialog>
  );
}
