import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { mainText } from './i18n';

const SIX_HOURS = 6 * 60 * 60_000;

/**
 * Checks GitHub releases for a new version at launch and every six hours.
 * Downloaded updates are installed when the app quits.
 */
export function startUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.warn('updater:', err.message));
  autoUpdater.on('update-downloaded', (info) =>
    console.log(`updater: v${info.version} downloaded, installs on quit`)
  );
  // electron-updater fills in {appName} and {version} itself.
  const { updateTitle, updateBody } = mainText();
  const check = () =>
    autoUpdater
      .checkForUpdatesAndNotify({ title: updateTitle, body: updateBody })
      .catch(() => {});
  check();
  setInterval(check, SIX_HOURS);
}
