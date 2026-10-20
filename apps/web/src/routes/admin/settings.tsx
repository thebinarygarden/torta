import { useEffect, useState, type FormEvent } from 'react';
import type { Currency, LiquidUnit, Settings, WeightUnit } from '@torta/shared';
import { Button, Checkbox, Input, Select } from '@binarygarden/flora/form';
import { useToast } from '@binarygarden/flora/overlay';
import { Card } from '@binarygarden/flora/ui';
import { get, patch, post } from '../../api/http';
import { useHealth } from '../../components/health';
import { UpdatesCard } from '../../components/updates-card';
import { errorMessage, useT } from '../../i18n';

/** What the restaurant card's save button sends. */
type RestaurantForm = Pick<
  Settings,
  | 'restaurantName'
  | 'currency'
  | 'weightUnit'
  | 'liquidUnit'
  | 'taxEnabled'
  | 'taxRateBps'
>;

export function AdminSettings() {
  const [saved, setSaved] = useState<RestaurantForm | null>(null);
  const [name, setName] = useState('');
  const [tax, setTax] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('g');
  const [liquidUnit, setLiquidUnit] = useState<LiquidUnit>('ml');
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { showToast } = useToast();
  const { refresh } = useHealth();
  const t = useT();

  useEffect(() => {
    get<Settings>('/admin/settings')
      .then((s) => {
        setName(s.restaurantName);
        setTax((s.taxRateBps / 100).toString());
        setTaxEnabled(s.taxEnabled);
        setCurrency(s.currency);
        setWeightUnit(s.weightUnit);
        setLiquidUnit(s.liquidUnit);
        setAutoUpdate(s.autoUpdate);
        setSaved(s);
      })
      .catch(() => {});
  }, []);

  const send = async (body: Partial<Settings>) => {
    setBusy(true);
    try {
      await patch('/admin/settings', body);
      refresh();
      showToast({ message: t.settings.saved, tone: 'ok' });
      return true;
    } catch (err) {
      showToast({ message: errorMessage(t, err), tone: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const form: RestaurantForm = {
    restaurantName: name,
    currency,
    weightUnit,
    liquidUnit,
    taxEnabled,
    taxRateBps: Math.round(Number(tax) * 100),
  };
  // Save stays off until something differs from what the server has.
  const changed =
    saved !== null &&
    (Object.keys(form) as (keyof RestaurantForm)[]).some(
      (k) => form[k] !== saved[k]
    );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await send(form)) setSaved(form);
  };

  const toggleAutoUpdate = async (on: boolean) => {
    setAutoUpdate(on);
    if (!(await send({ autoUpdate: on }))) setAutoUpdate(!on);
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post('/admin/password', { current, next });
      setCurrent('');
      setNext('');
      showToast({ message: t.settings.passwordChanged, tone: 'ok' });
    } catch {
      showToast({ message: t.settings.wrongPassword, tone: 'danger' });
    }
  };

  return (
    <>
      <h1>{t.settings.title}</h1>
      <Card title={t.settings.restaurant} padding="md">
        <form className="tt-form" onSubmit={save}>
          <Input
            label={t.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Select
            label={t.settings.currency}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            options={[
              { value: 'USD', label: t.settings.usd },
              { value: 'MXN', label: t.settings.mxn },
            ]}
          />
          <div className="tt-row">
            <Select
              label={t.settings.weighIn}
              value={weightUnit}
              onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
              options={[
                { value: 'g', label: t.settings.grams },
                { value: 'oz', label: t.settings.ounces },
              ]}
            />
            <Select
              label={t.settings.liquidsIn}
              value={liquidUnit}
              onChange={(e) => setLiquidUnit(e.target.value as LiquidUnit)}
              options={[
                { value: 'ml', label: t.settings.millilitres },
                { value: 'fl_oz', label: t.settings.fluidOunces },
              ]}
            />
          </div>
          <Checkbox
            label={t.settings.chargeTax}
            description={t.settings.taxesDescription}
            checked={taxEnabled}
            onChange={(e) => setTaxEnabled(e.target.checked)}
          />
          {taxEnabled && (
            <Input
              label={t.settings.taxRate}
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              hint={t.settings.taxHint}
            />
          )}
          <div>
            <Button type="submit" loading={busy} disabled={!changed}>
              {t.save}
            </Button>
          </div>
        </form>
      </Card>
      <UpdatesCard
        auto={autoUpdate}
        busy={busy}
        onAutoChange={toggleAutoUpdate}
      />
      <Card title={t.settings.password} padding="md">
        <form className="tt-form" onSubmit={changePassword}>
          <Input
            label={t.settings.current}
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <Input
            label={t.settings.new}
            type="password"
            value={next}
            minLength={8}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <div>
            <Button type="submit" variant="secondary">
              {t.settings.changePassword}
            </Button>
          </div>
        </form>
      </Card>
      <Card
        title={t.settings.license}
        description={t.settings.licenseDescription}
        padding="md"
      >
        <div className="tt-row tt-actions">
          <Button
            variant="secondary"
            href="https://github.com/thebinarygarden/torta"
            target="_blank"
            rel="noreferrer"
          >
            {t.settings.viewSource}
          </Button>
          <Button variant="ghost" href="/licenses.txt" download>
            {t.settings.thirdParty}
          </Button>
        </div>
      </Card>
    </>
  );
}
