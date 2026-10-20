import { createContext, useContext, useEffect, useState } from 'react';
import type { ErrorCode } from '@torta/shared';
import { HttpError } from '../api/http';
import en from './en.json';
import es from './es.json';

// The convention every garden app follows is in flora/docs/I18N.md.

export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];
export type Dict = typeof en;

// Typed against English, so a key missing from es.json fails the build, and
// every api error code needs a message.
const dictionaries: Record<
  Locale,
  Dict & { errors: Record<ErrorCode, string> }
> = { en, es };

// Per device: the kitchen tablet can read Spanish while the laptop reads English.
const KEY = 'torta.locale';

const isLocale = (v: unknown): v is Locale => locales.includes(v as Locale);

function initial(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Private windows can refuse storage; fall back to the browser language.
  }
  return navigator.languages.map((l) => l.slice(0, 2)).find(isLocale) ?? 'en';
}

const Ctx = createContext<{
  locale: Locale;
  t: Dict;
  setLocale: (l: string) => void;
}>({ locale: 'en', t: en, setLocale: () => {} });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState(initial);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const pick = (l: string) => {
    if (!isLocale(l)) return;
    setLocale(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // The choice still holds until the page reloads.
    }
  };
  return (
    <Ctx.Provider value={{ locale, t: dictionaries[locale], setLocale: pick }}>
      {children}
    </Ctx.Provider>
  );
}

export const useLocale = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/** Fills `{name}` placeholders: format('no {name}', { name }) */
export const format = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/**
 * What to tell the person when a request fails: the api's code in their
 * language, or that the laptop can't be reached. The server's own message is
 * only used as the item name some codes carry.
 */
export function errorMessage(t: Dict, err: unknown) {
  if (err instanceof HttpError) {
    const text: string | undefined = (t.errors as Record<string, string>)[
      err.code
    ];
    return text ? format(text, { name: err.message }) : t.errors.generic;
  }
  return err instanceof TypeError ? t.errors.network : t.errors.generic;
}
