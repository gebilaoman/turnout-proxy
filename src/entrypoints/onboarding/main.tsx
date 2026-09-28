import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureI18nLoaded } from '@/platform/view';
import '@/ui/tokens.css';
import { App } from './App';

if (ensureI18nLoaded()) {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
