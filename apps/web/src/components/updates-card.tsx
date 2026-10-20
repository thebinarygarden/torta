import { useCallback, useEffect, useState } from 'react';
import type { UpdatesInfo } from '@torta/shared';
import { Button, Switch } from '@binarygarden/flora/form';
import { useDialog, useToast } from '@binarygarden/flora/overlay';
import { Card } from '@binarygarden/flora/ui';
import { get, post } from '../api/http';
import { errorMessage, format, useLocale, useT } from '../i18n';
import { useHealth } from './health';

/**
 * Outside the installed app nothing updates, so the card only shows the
 * version and the switch.
 */
export function UpdatesCard({
  auto,
  busy,
  onAutoChange,
}: {
  auto: boolean;
  busy: boolean;
  onAutoChange: (on: boolean) => void;
}) {
  const [info, setInfo] = useState<UpdatesInfo | null>(null);
  const { health } = useHealth();
  const { showConfirm } = useDialog();
  const { showToast } = useToast();
  const { locale } = useLocale();
  const t = useT();

  const refresh = useCallback(
    () =>
      get<UpdatesInfo>('/admin/updates')
        .then(setInfo)
        .catch(() => {}),
    []
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Follow a check or download until it settles.
  const working =
    info?.available &&
    (info.state === 'checking' || info.state === 'downloading');
  useEffect(() => {
    if (!working) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [working, refresh]);

  if (!info) return null;

  const check = () =>
    info.available &&
    post('/admin/updates/check')
      .then(() => setInfo({ ...info, state: 'checking' }))
      .catch((e) => showToast({ message: errorMessage(t, e), tone: 'danger' }));

  const restart = () =>
    showConfirm(t.settings.restartConfirm, () => {
      post('/admin/updates/install').catch((e) =>
        showToast({ message: errorMessage(t, e), tone: 'danger' })
      );
    });

  const showBackup = () =>
    post('/admin/updates/show-backup').catch((e) =>
      showToast({ message: errorMessage(t, e), tone: 'danger' })
    );

  const line = info.available
    ? {
        idle: null,
        checking: t.settings.checking,
        downloading: format(t.settings.downloading, {
          version: info.version ?? '',
          percent: info.percent ?? 0,
        }),
        ready: format(t.settings.ready, { version: info.version ?? '' }),
        'up-to-date': t.settings.upToDate,
        error: t.settings.updateError,
      }[info.state]
    : t.settings.updatesInstalledOnly;

  return (
    <Card
      title={t.settings.updates}
      description={format(t.settings.thisVersion, { version: health.version })}
      padding="md"
      action={
        <Switch
          label={t.settings.autoUpdate}
          checked={auto}
          disabled={busy}
          onChange={(e) => onAutoChange(e.target.checked)}
        />
      }
    >
      <div className="tt-stack" data-gap="sm">
        {line && <p className="tt-small tt-muted">{line}</p>}
        {info.available && info.backupAt && (
          <div>
            <Button variant="ghost" size="sm" onClick={showBackup}>
              {format(t.settings.lastBackup, {
                time: new Date(info.backupAt).toLocaleString(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </Button>
          </div>
        )}
        <div className="tt-row tt-actions">
          {info.available && info.state === 'ready' ? (
            <Button onClick={restart}>{t.settings.restart}</Button>
          ) : (
            <Button
              variant="secondary"
              onClick={check}
              loading={!!working}
              disabled={!info.available}
            >
              {t.settings.checkNow}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
