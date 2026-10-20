import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Currency, LiquidUnit, Settings, WeightUnit } from '@torta/shared';
import { Button, Input, Select, Switch } from '@binarygarden/flora/form';
import { useDialog, useToast } from '@binarygarden/flora/overlay';
import { Card } from '@binarygarden/flora/ui';
import { get, patch, post } from '../../api/http';
import { BgLinkCard } from '../../components/bg-link';
import { useHealth } from '../../components/health';
import { errorMessage, useT } from '../../i18n';

export function AdminSettings() {
  const [name, setName] = useState('');
  const [tax, setTax] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('g');
  const [liquidUnit, setLiquidUnit] = useState<LiquidUnit>('ml');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { showToast } = useToast();
  const { refresh } = useHealth();
  const { showConfirm } = useDialog();
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get<Settings>('/admin/settings')
      .then((s) => {
        setName(s.restaurantName);
        setTax((s.taxRateBps / 100).toString());
        setTaxEnabled(s.taxEnabled);
        setCurrency(s.currency);
        setWeightUnit(s.weightUnit);
        setLiquidUnit(s.liquidUnit);
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

  const save = (e: FormEvent) => {
    e.preventDefault();
    send({ restaurantName: name, currency, weightUnit, liquidUnit });
  };

  const saveTax = (e: FormEvent) => {
    e.preventDefault();
    send({ taxRateBps: Math.round(Number(tax) * 100) });
  };

  // The switch applies at once; the rate keeps its own save.
  const toggleTax = async (on: boolean) => {
    setTaxEnabled(on);
    if (!(await send({ taxEnabled: on }))) setTaxEnabled(!on);
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

  const restore = async (file: File) => {
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      showToast({ message: t.errors.bad_backup, tone: 'danger' });
      return;
    }
    showConfirm(t.settings.restoreConfirm, async () => {
      try {
        await post('/admin/import', backup);
        refresh();
        showToast({ message: t.settings.restored, tone: 'ok' });
      } catch (err) {
        showToast({ message: errorMessage(t, err), tone: 'danger' });
      }
    });
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
          <div>
            <Button type="submit" loading={busy}>
              {t.save}
            </Button>
          </div>
        </form>
      </Card>
      <Card
        title={t.settings.taxes}
        description={t.settings.taxesDescription}
        padding="md"
      >
        <form className="tt-form" onSubmit={saveTax}>
          <Switch
            label={t.settings.chargeTax}
            checked={taxEnabled}
            disabled={busy}
            onChange={(e) => toggleTax(e.target.checked)}
          />
          {taxEnabled && (
            <>
              <Input
                label={t.settings.taxRate}
                inputMode="decimal"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                hint={t.settings.taxHint}
              />
              <div>
                <Button type="submit" loading={busy}>
                  {t.save}
                </Button>
              </div>
            </>
          )}
        </form>
      </Card>
      <Card
        title={t.settings.backup}
        description={t.settings.backupDescription}
        padding="md"
      >
        <div className="tt-row tt-actions">
          <Button variant="secondary" href="/api/admin/export" download>
            {t.settings.download}
          </Button>
          <Button variant="ghost" onClick={() => fileInput.current?.click()}>
            {t.settings.restore}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) restore(f);
            }}
          />
        </div>
      </Card>
      <BgLinkCard />
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
