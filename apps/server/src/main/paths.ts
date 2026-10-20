import { join, resolve } from 'node:path';
import { app } from 'electron';

/**
 * Where torta keeps its files. The database lives in Electron's user data
 * directory. The web build, migrations and window icon are under `resources/`
 * in a packaged app, or in the repository during development.
 */
export const paths = {
  dataDir: join(app.getPath('userData'), 'db'),
  // A copy of the database from before the last update, and the version that
  // made it. See data-copy.ts.
  dataCopyDir: join(app.getPath('userData'), 'db-backup'),
  versionFile: join(app.getPath('userData'), 'last-version'),
  migrationsFolder: app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : resolve(__dirname, '../drizzle'),
  staticDir: app.isPackaged
    ? join(process.resourcesPath, 'web')
    : resolve(__dirname, '../../web/dist'),
  icon: app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : resolve(__dirname, '../build/icon.png'),
  // The Dock draws a runtime icon exactly as given, with no rounding or margin,
  // so this one is already shaped like a macOS icon. Development only.
  devDockIcon: resolve(__dirname, '../build/icon-dock.png'),
};
