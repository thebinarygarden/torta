import { BrowserWindow, session, shell } from 'electron';
import { ADMIN_COOKIE } from '../server/auth';
import { paths } from './paths';

let win: BrowserWindow | null = null;

/**
 * The owner's window is an ordinary browser window pointed at the server on
 * loopback, already logged in as admin through a cookie set here.
 */
export async function openAdminWindow(opts: {
  port: number;
  sessionId: string;
}): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) {
    win.focus();
    return win;
  }
  const origin = `http://127.0.0.1:${opts.port}`;
  await session.defaultSession.cookies.set({
    url: origin,
    name: ADMIN_COOKIE,
    value: opts.sessionId,
    httpOnly: true,
    sameSite: 'lax',
  });

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    title: 'torta',
    // Only Linux reads this; macOS and Windows use the app's own icon.
    icon: paths.icon,
    backgroundColor: '#0f1110',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  // Links to other hosts open in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`${origin}/admin`);
  return win;
}

export const currentWindow = () => (win && !win.isDestroyed() ? win : null);
