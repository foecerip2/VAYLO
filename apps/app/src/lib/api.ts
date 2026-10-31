import { friendlyErrorMessage } from '@vpn/shared';

const TOKEN_KEY = 'vpn_token';

export class ApiError extends Error {
  /** исходный текст ошибки сервера (для логов); в message — безопасный для пользователя текст */
  public raw: string;
  constructor(public status: number, message: string, public code?: string) {
    super(friendlyErrorMessage(message));
    this.raw = message;
  }
}

/** Текст ошибки для тоста/экрана: технические сообщения заменяются на общий понятный текст */
export const errorText = (e: unknown, fallback?: string): string => (e instanceof ApiError ? e.message : friendlyErrorMessage(e instanceof Error ? e.message : '', fallback));

let memoryToken: string | null = null;
export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  return memoryToken;
}
export function setToken(t: string | null) {
  memoryToken = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

const paymentKeys = new Map<string, string>();

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

let onGate: (() => void) | null = null;
export function setGateHandler(fn: () => void) {
  onGate = fn;
}

export async function api<T>(method: string, path: string, body?: unknown, operationKey?: string): Promise<T> {
  const token = getToken();
  const paymentSignature = method === 'POST' && path === '/payments' ? `${token}:${JSON.stringify(body)}` : '';
  if (paymentSignature && !operationKey) {
    operationKey = paymentKeys.get(paymentSignature) ?? crypto.randomUUID();
    paymentKeys.set(paymentSignature, operationKey);
  }
  let res: Response | undefined;
  // На плохом Wi-Fi запрос может повиснуть навсегда: ограничиваем ожидание и для чтения (GET) повторяем с паузой
  const attempts = method === 'GET' ? 3 : 1;
  const timeoutMs = method === 'GET' ? 12_000 : path.startsWith('/support/') ? 60_000 : 25_000;
  for (let i = 0; ; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      res = await fetch(`/api/v1${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(operationKey ? { 'idempotency-key': operationKey } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      break;
    } catch {
      clearTimeout(timer);
      if (i + 1 >= attempts) break;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  if (!res) throw new ApiError(0, 'Нет соединения с сервером. Проверьте интернет.');
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    if (json?.error?.code === 'subscribe_required') onGate?.();
    throw new ApiError(res.status, json?.error?.message ?? `Ошибка ${res.status}`, json?.error?.code);
  }
  if (paymentSignature) paymentKeys.delete(paymentSignature);
  return json as T;
}

export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b?: unknown, operationKey?: string) => api<T>('POST', p, b ?? {}, operationKey);

/** Private support photos: authorization stays in the header, never in a URL. */
export async function getBlob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch('/api/v1'+path, { headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {}, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  } catch { throw new ApiError(0, 'Не удалось загрузить фото. Проверьте соединение.'); }
  if (!res.ok) {
    if (res.status === 401 && getToken()) onUnauthorized?.();
    throw new ApiError(res.status, 'Не удалось загрузить фото');
  }
  if (!(res.headers.get('content-type') ?? '').startsWith('image/jpeg')) throw new ApiError(502, 'Не удалось загрузить фото');
  return res.blob();
}
export const loadSupportPhoto = (id: string) => getBlob(`/support/attachments/${encodeURIComponent(id)}`);
