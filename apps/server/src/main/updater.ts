import { Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '@torta/shared';
import type { Updater } from '../server/context';
import { mainText } from './i18n';

const SIX_HOURS = 6 * 60 * 60_000;

/**
 * Checks GitHub releases for a new version. With auto on it checks now and
 * every six hours and downloads what it finds; `check()` always downloads.
 * A downloaded update installs when the app quits, or at once with
 * `install()`, which first lets `beforeInstall` close the database.
 */
export function createUpdater(
  beforeInstall: () => Promise<void>
): Omit<Updater, 'backupAt' | 'showBackup'> {
  let status: UpdateStatus = { state: 'idle' };
  let auto = false;
  let manual = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => {
    status = { state: 'checking' };
  });
  autoUpdater.on('update-not-available', () => {
    status = { state: 'up-to-date' };
    manual = false;
  });
  autoUpdater.on('update-available', (info) => {
    if (!auto && !manual) {
      status = { state: 'idle' };
      return;
    }
    status = { state: 'downloading', version: info.version, percent: 0 };
    autoUpdater.downloadUpdate().catch(() => {});
  });
  autoUpdater.on('download-progress', (p) => {
    status = { ...status, percent: Math.round(p.percent) };
  });
  autoUpdater.on('update-downloaded', (info) => {
    status = { state: 'ready', version: info.version };
    manual = false;
    if (Notification.isSupported()) {
      const { updateTitle, updateBody } = mainText();
      new Notification({
        title: updateTitle,
        body: updateBody.replace('{version}', info.version),
      }).show();
    }
  });
  autoUpdater.on('error', (err) => {
    console.warn('updater:', err.message);
    status = { state: 'error' };
    manual = false;
  });

  const run = () => {
    // A ready update stays ready; a check or download already running finishes.
    if (['checking', 'downloading', 'ready'].includes(status.state)) return;
    autoUpdater.checkForUpdates().catch(() => {});
  };

  return {
    status: () => status,
    check: () => {
      manual = true;
      run();
    },
    install: () => {
      if (status.state !== 'ready') return;
      beforeInstall().finally(() => autoUpdater.quitAndInstall());
    },
    setAuto: (on) => {
      auto = on;
      clearInterval(timer);
      timer = undefined;
      if (!on) return;
      run();
      timer = setInterval(run, SIX_HOURS);
    },
  };
}
