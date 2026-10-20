import {
  app,
  Menu,
  powerSaveBlocker,
  clipboard,
  dialog,
  safeStorage,
} from 'electron';
import { createServer } from '../server/create';
import { plainSecrets, type Secrets } from '../server/secrets';
import { mainText } from './i18n';
import { paths } from './paths';
import { startUpdater } from './updater';
import { currentWindow, openAdminWindow } from './window';

type Running = Awaited<ReturnType<typeof createServer>>;

/**
 * Seals secrets with the OS keychain through `safeStorage` when the platform
 * supports it, and stores them unsealed otherwise.
 */
function hostSecrets(): Secrets {
  if (!safeStorage.isEncryptionAvailable()) return plainSecrets;
  return {
    seal: (s) => safeStorage.encryptString(s).toString('base64'),
    open: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let server: Running | null = null;

  app.on('second-instance', () => currentWindow()?.focus());

  // Closing the window must not stop the server the tablets depend on.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') shutdown();
  });
  app.on('activate', () => {
    if (server) openWindow(server);
  });
  app.on('before-quit', () => {
    server?.close().catch(() => {});
  });

  const shutdown = () => app.quit();

  const openWindow = (s: Running) =>
    openAdminWindow({ port: s.port, sessionId: s.sessions.create() });

  app
    .whenReady()
    .then(async () => {
      server = await createServer({
        dataDir: paths.dataDir,
        migrationsFolder: paths.migrationsFolder,
        staticDir: paths.staticDir,
        port: 7070,
        hostname: '0.0.0.0',
        version: app.getVersion(),
        secrets: hostSecrets(),
      });
      console.log(`torta server · http://127.0.0.1:${server.port}`);
      powerSaveBlocker.start('prevent-app-suspension');

      const t = mainText();
      if (process.platform === 'darwin') {
        // Unpackaged (`pnpm electron`), the Dock shows Electron's own icon. A
        // packaged app takes torta's from its bundle, in light and dark.
        if (!app.isPackaged) app.dock?.setIcon(paths.devDockIcon);
        app.dock?.setMenu(
          Menu.buildFromTemplate([
            { label: t.openAdmin, click: () => server && openWindow(server) },
            {
              label: t.copyLanUrl,
              click: () => {
                const url = server?.network.describe().url;
                if (url) clipboard.writeText(url);
              },
            },
          ])
        );
      }

      const win = await openWindow(server);
      startUpdater();

      if (process.env.TORTA_SMOKE) {
        // TORTA_SMOKE: prove the window is logged in, print the result and
        // exit, for checking a build by hand or from a script.
        const me = await win.webContents.executeJavaScript(
          `fetch('/api/me').then((r) => r.status + ' ' + r.url)`
        );
        console.log(`smoke: ${me}`);
        app.quit();
      }
    })
    .catch((err) => {
      dialog.showErrorBox(mainText().couldNotStart, String(err?.stack ?? err));
      app.exit(1);
    });
}
