import { app } from 'electron';
import en from './en.json';
import es from './es.json';

// The native strings: the dock menu, the startup error and the update
// notification. The convention every garden app follows is in
// flora/docs/I18N.md.

// Typed against English, so a key missing from es.json fails the build.
const dictionaries: Record<'en' | 'es', typeof en> = { en, es };

/**
 * Native menus and notifications follow the OS language. The main process
 * can't see the language a window picked; that lives in the page.
 */
export function mainText() {
  const lang = app
    .getPreferredSystemLanguages()
    .map((l) => l.slice(0, 2))
    .find((l): l is 'en' | 'es' => l in dictionaries);
  return dictionaries[lang ?? 'en'];
}
