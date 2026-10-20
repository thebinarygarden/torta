import {
  app,
  Menu,
  powerSaveBlocker,
  clipboard,
  dialog,
  shell,
} from 'electron';
import { schema } from '../db';
import { createServer } from '../server/create';
import { copyBeforeUpgrade, lastCopyAt } from './data-copy';
import { mainText } from './i18n';
import { paths } from './paths';
import { createUpdater } from './updater';
import { currentWindow, openAdminWindow } from './window';

type Running = Awaited<ReturnType<typeof createServer>>;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let server: Running | null = null;
  let closed = false;
  let closing: Promise<void> | undefined;

  // Waits for the database to finish writing. Quitting and installing an
  // update both go through here, once.
  const closeServer = () =>
    (closing ??= (server?.close() ?? Promise.resolve())
      .catch(() => {})
      .finally(() => {
        closed = true;
      }));

  const updater = app.isPackaged
    ? {
        ...createUpdater(closeServer),
        backupAt: () => lastCopyAt(paths.dataCopyDir),
        showBackup: () => void shell.openPath(paths.dataCopyDir),
      }
    : undefined;

  app.on('second-instance', () => currentWindow()?.focus());

  // Closing the window must not stop the server the tablets depend on.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') shutdown();
  });
  app.on('activate', () => {
    if (server) openWindow(server);
  });
  app.on('before-quit', (e) => {
    if (closed) return;
    e.preventDefault();
    closeServer().then(() => app.quit());
  });

  const shutdown = () => app.quit();

  const openWindow = (s: Running) =>
    openAdminWindow({ port: s.port, sessionId: s.sessions.create() });

  app
    .whenReady()
    .then(async () => {
      if (app.isPackaged) {
        await copyBeforeUpgrade({
          dataDir: paths.dataDir,
          copyDir: paths.dataCopyDir,
          versionFile: paths.versionFile,
          version: app.getVersion(),
        });
      }
      server = await createServer({
        dataDir: paths.dataDir,
        migrationsFolder: paths.migrationsFolder,
        staticDir: paths.staticDir,
        port: 7070,
        hostname: '0.0.0.0',
        version: app.getVersion(),
        updater,
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
      const [row] = await server.db
        .select({ autoUpdate: schema.settings.autoUpdate })
        .from(schema.settings)
        .limit(1);
      updater?.setAuto(row?.autoUpdate ?? true);

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
