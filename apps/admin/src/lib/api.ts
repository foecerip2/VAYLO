const KEY = 'admin_token';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let token: string | null = null;
/** «Запомнить меня» → localStorage (переживает закрытие браузера), иначе sessionStorage (до закрытия вкладки) */
export const getToken = () => {
  if (token) return token;
  try {
    token = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  return token;
};
export const isRemembered = () => {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
};
export const setToken = (t: string | null, remember = isRemembered()) => {
  token = t;
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(KEY, t);
  } catch {
    /* ignore */
  }
};

let onAuthLost: (() => void) | null = null;
export const setAuthLostHandler = (fn: () => void) => (onAuthLost = fn);

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/admin${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(path.startsWith('/support/') ? { signal: AbortSignal.timeout(60_000) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data: any = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && getToken() && !path.startsWith('/auth/')) onAuthLost?.();
    throw new ApiError(res.status, data?.error?.message ?? `Ошибка ${res.status}`);
  }
  return data as T;
}
export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T,>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const patch = <T,>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const del = <T,>(p: string) => api<T>('DELETE', p);

/** Скачивание CSV с авторизацией */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api/v1/admin${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Не удалось скачать файл');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Private support photos: authorization stays in the header, never in a URL. */
export async function getBlob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch('/api/v1/admin'+path, { headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {}, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  } catch { throw new ApiError(0, 'Не удалось загрузить фото. Проверьте соединение.'); }
  if (!res.ok) {
    if (res.status === 401 && getToken()) onAuthLost?.();
    throw new ApiError(res.status, 'Не удалось загрузить фото');
  }
  if (!(res.headers.get('content-type') ?? '').startsWith('image/jpeg')) throw new ApiError(502, 'Не удалось загрузить фото');
  return res.blob();
}
export const loadSupportPhoto = (id: string) => getBlob(`/support/attachments/${encodeURIComponent(id)}`);
