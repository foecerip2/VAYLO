import { miniAppDesign } from '@vpn/shared';
/** Тонкая обёртка над Telegram WebApp SDK (подключается async-скриптом из index.html, может появиться позже) */
interface TgWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string }; start_param?: string };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  platform: string;
  ready(): void;
  expand(): void;
  close(): void;
  openLink(url: string, opts?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  onEvent(e: string, cb: () => void): void;
  offEvent(e: string, cb: () => void): void;
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: 'success' | 'error' | 'warning'): void; selectionChanged(): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  showConfirm?(message: string, cb?: (ok: boolean) => void): void;
  isVersionAtLeast?(v: string): boolean;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
    TelegramWebviewProxy?: unknown;
  }
}

export const webApp = (): TgWebApp | undefined => window.Telegram?.WebApp;
export const isTelegram = (): boolean => Boolean(webApp()?.initData);
export const initDataRaw = (): string => webApp()?.initData ?? '';

function hexToTriplet(hex?: string): string | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Маппинг themeParams Telegram на токены дизайн-системы (бренд-градиент и статусные цвета остаются нашими) */
export function applyTelegramTheme() {
  const tg = webApp();
  if (!tg?.initData) return;
  const root = document.documentElement;
  if (root.dataset.design) {
    const design = miniAppDesign(root.dataset.design);
    root.dataset.theme = design.mode;
    // Each call is optional on older Telegram SDK versions.
    try { tg.setHeaderColor?.(design.background); } catch { /* older SDK */ }
    try { tg.setBackgroundColor?.(design.background); } catch { /* older SDK */ }
    try { tg.setBottomBarColor?.(design.surface); } catch { /* older SDK */ }
    return;
  }
  root.setAttribute('data-theme', tg.colorScheme === 'dark' ? 'dark' : 'light');
  const p = tg.themeParams ?? {};
  const set = (name: string, hex?: string) => {
    const t = hexToTriplet(hex);
    if (t) root.style.setProperty(name, t);
  };
  set('--bg', p.bg_color);
  set('--surface', p.section_bg_color ?? p.secondary_bg_color);
  set('--surface-2', p.secondary_bg_color);
  set('--text', p.text_color);
  set('--text-muted', p.hint_color);
  // акцентом остаётся фирменный фиолетовый — читается в любой теме
  const bg = p.bg_color ?? (tg.colorScheme === 'dark' ? '#0b0d14' : '#f6f7fb');
  tg.setHeaderColor?.(bg);
  tg.setBackgroundColor?.(bg);
}

/** Есть ли признаки запуска внутри Telegram (до загрузки SDK) — тогда SDK стоит подождать подольше */
function looksLikeTelegram(): boolean {
  try {
    if (/tgWebApp/.test(location.hash) || /tgWebApp/.test(location.search)) return true;
    if (sessionStorage.getItem('__telegram__initParams')) return true;
  } catch {
    /* ignore */
  }
  return Boolean(window.TelegramWebviewProxy);
}

let readyPromise: Promise<void> | null = null;
/**
 * Ждём загрузки telegram-web-app.js (он подключён async, чтобы вне Telegram не блокировать отрисовку,
 * например если telegram.org недоступен). Внутри Telegram ждём до 5 с, вне — не ждём.
 */
export function telegramReady(): Promise<void> {
  readyPromise ??= new Promise<void>((resolve) => {
    if (window.Telegram?.WebApp) return resolve();
    if (!looksLikeTelegram()) return resolve();
    const el = document.getElementById('tg-sdk');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    };
    const poll = setInterval(() => window.Telegram?.WebApp && finish(), 50);
    const timer = setTimeout(finish, 5000);
    el?.addEventListener('load', finish);
    el?.addEventListener('error', finish);
  });
  return readyPromise;
}

/** Подтверждение: нативный диалог Telegram в Mini App, window.confirm в браузере */
export function confirmDialog(message: string): Promise<boolean> {
  const tg = webApp();
  if (tg?.initData && tg.showConfirm && (tg.isVersionAtLeast?.('6.2') ?? true)) {
    return new Promise((resolve) => {
      try {
        tg.showConfirm!(message, (ok) => resolve(Boolean(ok)));
      } catch {
        resolve(window.confirm(message));
      }
    });
  }
  return Promise.resolve(window.confirm(message));
}

export function initTelegram() {
  const tg = webApp();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
    applyTelegramTheme();
    tg.onEvent('themeChanged', applyTelegramTheme);
  } catch {
    /* вне Telegram */
  }
}

export function haptic(kind: 'light' | 'success' | 'error' = 'light') {
  const h = webApp()?.HapticFeedback;
  if (!h) return;
  if (kind === 'light') h.impactOccurred('light');
  else h.notificationOccurred(kind);
}

export function openExternal(url: string) {
  const tg = webApp();
  if (tg?.initData && /^https?:\/\/t\.me\//.test(url)) return tg.openTelegramLink(url);
  if (tg?.initData) return tg.openLink(url);
  window.open(url, '_blank', 'noopener');
}
