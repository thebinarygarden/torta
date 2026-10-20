import { LocaleToggleButton } from '@binarygarden/flora/navigation';
import { locales, useLocale } from '../i18n';

// Each language is named in itself, so it reads the same in every locale.
const names = { en: 'english', es: 'español' };

export function LocaleToggle() {
  const { locale, t, setLocale } = useLocale();
  return (
    <LocaleToggleButton
      locales={locales.map((value) => ({ value, label: names[value] }))}
      value={locale}
      onChange={setLocale}
      label={t.language}
      size="sm"
    />
  );
}
