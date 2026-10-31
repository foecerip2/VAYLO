import { applyAdminTheme, readTheme } from './lib/theme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary, reportClientError } from '@vpn/ui';
import App from './App';
import { AuthProvider } from './lib/auth';
import '@fontsource/unbounded/cyrillic-700.css';
import '@fontsource/unbounded/latin-700.css';
import '@fontsource/unbounded/cyrillic-800.css';
import '@fontsource/unbounded/latin-800.css';
import '@fontsource/manrope/cyrillic-500.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/cyrillic-700.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/cyrillic-800.css';
import '@fontsource/manrope/latin-800.css';
import './index.css';
import './neon.css';
import '@vpn/ui/orbit.css';
import './orbit.css';
import { installTilt } from './fx/tilt';

const APP_NAME = 'admin';
// Ошибки, пойманные вне отрисовки, и устаревшие файлы после обновления
const REPORT = '/api/v1/client-error';
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('chunk_reload_at') ?? 0);
    if (Date.now() - last > 60_000) { sessionStorage.setItem('chunk_reload_at', String(Date.now())); e.preventDefault(); location.reload(); }
  } catch { /* ignore */ }
});
window.addEventListener('error', (e) => { if (e.error && !/ResizeObserver/.test(String(e.message))) reportClientError(REPORT, APP_NAME, e.error, 'window.onerror'); });
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; if (r instanceof Error && !/aborted|Failed to fetch|NetworkError|Load failed/i.test(r.message)) reportClientError(REPORT, APP_NAME, r, 'unhandledrejection'); });

document.documentElement.classList.add('neon');
// Тема Violet Glass: тёмная или светлая (переключатель в шапке), выбор запоминается
applyAdminTheme(readTheme());
installTilt();



const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary report="/api/v1/client-error" app="admin">
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

