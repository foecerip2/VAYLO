/** Gift codes stay in the URL fragment when shared, so web-server access logs do not receive them. */
const STORAGE_KEY = 'pending_gift_v2';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const normalize = (value: string | null | undefined) => value?.trim().toUpperCase() ?? '';
export const validGiftCode = (value: string) => /^VAYLO-[A-F0-9]{24}$/.test(normalize(value));

export function rememberGift(value: string): boolean {
  const code = normalize(value);
  if (!validGiftCode(code)) return false;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code, expiresAt: Date.now() + MAX_AGE_MS }));
    sessionStorage.removeItem('gift_code');
  } catch { /* Private browsing can disable storage; the current link still works. */ }
  return true;
}

export function readPendingGift(): string {
  try {
    const url = new URL(location.href);
    if (url.pathname.replace(/\/$/, '') === '/gifts') {
      const hash = new URLSearchParams(url.hash.slice(1));
      const incoming = normalize(hash.get('gift') ?? url.searchParams.get('code'));
      if (validGiftCode(incoming)) { rememberGift(incoming); return incoming; }
    }
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const pending = JSON.parse(stored) as { code?: string; expiresAt?: number };
      if (validGiftCode(pending.code ?? '') && typeof pending.expiresAt === 'number' && pending.expiresAt > Date.now()) return normalize(pending.code);
      sessionStorage.removeItem(STORAGE_KEY);
    }
    const legacy = normalize(sessionStorage.getItem('gift_code'));
    if (validGiftCode(legacy)) { rememberGift(legacy); return legacy; }
  } catch { /* A malformed or unavailable cache must not prevent entering a code manually. */ }
  return '';
}

export function forgetGift(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem('gift_code'); } catch { /* ignore */ }
  try {
    const url = new URL(location.href);
    if (url.pathname.replace(/\/$/, '') !== '/gifts') return;
    url.searchParams.delete('code');
    const hash = new URLSearchParams(url.hash.slice(1));
    if (hash.has('gift')) { hash.delete('gift'); url.hash = hash.toString(); }
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}

export function giftShareUrl(code: string): string {
  if (!validGiftCode(code)) return '';
  return `${location.origin}/gifts#gift=${encodeURIComponent(normalize(code))}`;
}
