import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initAuth } from './app/session';
import { applyTheme, themeStore } from './app/store';
import './styles/app.css';

applyTheme(themeStore.get());
void initAuth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
