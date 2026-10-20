import { useCallback, useEffect, useState } from 'react';
import { Button, Select } from '@binarygarden/flora/form';
import { Dialog, useDialog, useToast } from '@binarygarden/flora/overlay';
import { Card, Table } from '@binarygarden/flora/ui';
import { del, get, post } from '../../api/http';
import { useHealth } from '../../components/health';
import { Qr } from '../../components/qr';
import { errorMessage, format, useT, type Dict } from '../../i18n';

type Network = {
  port: number;
  ip: string | null;
  url: string | null;
  interfaces: string[];
};
type Device = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
};
type Pairing = { code: string; expiresAt: string; url: string | null };

export function AdminOverview() {
  const { health } = useHealth();
  const { showToast } = useToast();
  const { showConfirm } = useDialog();
  const t = useT();
  const [network, setNetwork] = useState<Network | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);

  const load = useCallback(() => {
    get<Network>('/admin/network')
      .then(setNetwork)
      .catch(() => {});
    get<Device[]>('/admin/devices')
      .then(setDevices)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const addDevice = () =>
    post<Pairing>('/admin/pairing')
      .then(setPairing)
      .catch((e) => showToast({ message: errorMessage(t, e), tone: 'danger' }));

  const revoke = (d: Device) =>
    showConfirm(format(t.overview.removeConfirm, { name: d.name }), () =>
      del(`/admin/devices/${d.id}`).then(load)
    );

  return (
    <>
      <h1>{health.restaurantName}</h1>

      <Card title={t.overview.devices} padding="md">
        <div className="tt-stack">
          {network?.url ? (
            <div className="tt-row" data-gap="lg" data-top>
              <Qr value={network.url} size={140} />
              <div className="tt-stack" data-gap="sm">
                <span className="tt-label">{t.overview.openOnWifi}</span>
                <span className="tt-code" data-size="xl">
                  {network.url}
                </span>
                {network.interfaces.length > 1 && (
                  <Select
                    size="sm"
                    label={t.overview.network}
                    options={network.interfaces}
                    value={network.ip ?? ''}
                    onChange={(e) =>
                      post<Network>('/admin/network', {
                        ip: e.target.value,
                      }).then(setNetwork)
                    }
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="tt-muted">{t.overview.noNetwork}</p>
          )}
          <div className="tt-row" data-between>
            <span className="tt-small tt-muted">{t.overview.codesNote}</span>
            <Button onClick={addDevice}>{t.overview.addDevice}</Button>
          </div>
        </div>
      </Card>

      <Card title={t.overview.paired} padding="md">
        {devices.length === 0 ? (
          <p className="tt-muted">{t.overview.none}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t.name}</th>
                <th>{t.overview.lastSeen}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="tt-muted">
                    {d.lastSeenAt ? ago(t, d.lastSeenAt) : t.overview.never}
                  </td>
                  <td data-num>
                    <Button variant="ghost" size="sm" onClick={() => revoke(d)}>
                      {t.remove}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="tt-small tt-muted">
        {format(t.overview.version, { version: health.version })}
      </p>

      {pairing && (
        <PairingDialog
          pairing={pairing}
          onClose={() => {
            setPairing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function PairingDialog({
  pairing,
  onClose,
}: {
  pairing: Pairing;
  onClose: () => void;
}) {
  const t = useT();
  const [left, setLeft] = useState(() => secondsLeft(pairing.expiresAt));
  useEffect(() => {
    const t = setInterval(() => setLeft(secondsLeft(pairing.expiresAt)), 1000);
    return () => clearInterval(t);
  }, [pairing.expiresAt]);

  return (
    <Dialog
      open
      title={t.overview.addDevice}
      description={t.overview.pairDescription}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t.overview.done}</Button>}
    >
      <div className="tt-stack" data-center>
        {pairing.url && <Qr value={pairing.url} size={200} />}
        <span className="tt-code" data-size="3xl">
          {pairing.code}
        </span>
        <span className="tt-small tt-muted">
          {left > 0
            ? format(t.overview.expiresIn, {
                time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
              })
            : t.overview.expired}
        </span>
      </div>
    </Dialog>
  );
}

const secondsLeft = (iso: string) =>
  Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));

function ago(t: Dict, iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return t.overview.justNow;
  if (m < 60) return format(t.overview.minutesAgo, { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return format(t.overview.hoursAgo, { n: h });
  return format(t.overview.daysAgo, { n: Math.round(h / 24) });
}
