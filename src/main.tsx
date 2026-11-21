import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { langStore } from './app/i18n';
import { initAuth } from './app/session';
import { initTelemetry } from './app/telemetry';
import { applyTheme, themeStore } from './app/store';
import './styles/app.css';

applyTheme(themeStore.get());
document.documentElement.lang = langStore.get();
initTelemetry();
void initAuth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
