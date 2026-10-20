const TOKEN = 'torta.token';
const SURFACE = 'torta.surface';

export type Surface = 'order' | 'kitchen';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing or blocked storage. The app still works, but nothing
    // stored here survives a reload.
  }
}

export const getToken = () => read(TOKEN);
export const setToken = (t: string) => write(TOKEN, t);
export const clearToken = () => write(TOKEN, null);

export const getSurface = (): Surface | null => {
  const s = read(SURFACE);
  return s === 'order' || s === 'kitchen' ? s : null;
};
export const setSurface = (s: Surface) => write(SURFACE, s);
