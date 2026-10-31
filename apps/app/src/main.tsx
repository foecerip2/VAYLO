import { bootstrapMiniAppDesign } from './lib/design';
import { readPendingGift } from './lib/gift-links';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { initTelegram, telegramReady } from './lib/tg';
import { ErrorBoundary, reportClientError } from '@vpn/ui';
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
import { installTilt } from './lib/tilt';

const APP_NAME = 'miniapp';
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

bootstrapMiniAppDesign();
window.__vayloLaunch?.claim();
installTilt();

declare const __BUILD_ID__: string;
/** Если на сервере уже новая версия, а у пользователя открыта старая (кеш Telegram) — один раз перезагружаемся. */
async function checkVersion() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
    const { build } = (await r.json()) as { build?: string };
    if (build && build !== __BUILD_ID__ && sessionStorage.getItem('reloaded_for') !== build) {
      sessionStorage.setItem('reloaded_for', build);
      location.reload();
    }
  } catch { /* офлайн — пропускаем */ }
}
if (import.meta.env.PROD) {
  void checkVersion();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkVersion(); });
}

void telegramReady().then(initTelegram);
// реферальный код с сайта (?ref=...) запоминаем до входа
try {
  readPendingGift();
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref) {
    if (!sessionStorage.getItem('ref')) void fetch('/api/v1/ref/click', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: ref }) }).catch(() => {});
    sessionStorage.setItem('ref', ref);
  }
} catch {
  /* ignore */
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: (n) => Math.min(4000, 800 * 2 ** n), refetchOnWindowFocus: false, networkMode: 'always' } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary report="/api/v1/client-error" app="miniapp">
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
