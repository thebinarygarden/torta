import '@fontsource/hanken-grotesk/300.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/hanken-grotesk/800.css';
import '@binarygarden/flora/styles.css';
import './app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { DialogProvider, ToastProvider } from '@binarygarden/flora/overlay';
import { ProductScope } from '@binarygarden/flora/theme';
import { App } from './app';
import { LocaleProvider, useT } from './i18n';
import { HealthProvider } from './components/health';

// The dialog and toast providers sit above every route, so they read their
// labels here.
function Overlays({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <DialogProvider labels={t.flora.dialog}>
      <ToastProvider labels={t.flora.toast}>{children}</ToastProvider>
    </DialogProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductScope hue={90}>
      <BrowserRouter>
        <LocaleProvider>
          <HealthProvider>
            <Overlays>
              <App />
            </Overlays>
          </HealthProvider>
        </LocaleProvider>
      </BrowserRouter>
    </ProductScope>
  </StrictMode>
);
