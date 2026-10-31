import type { User } from 'grammy/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  internalKey: string;
}

/** Клиент Core API от имени пользователя Telegram (внутренний ключ + данные пользователя в заголовках). */
export function createApi(opts: ApiClientOptions) {
  async function call<T>(user: Pick<User, 'id' | 'first_name' | 'username' | 'language_code'>, method: string, path: string, body?: unknown, extra: Record<string, string> = {}, timeoutMs = 20000): Promise<T> {
    const res = await fetch(`${opts.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-internal-key': opts.internalKey,
        'x-tg-user': Buffer.from(JSON.stringify({ id: user.id, first_name: user.first_name, username: user.username, language_code: user.language_code })).toString('base64'),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, json?.error?.message ?? `Ошибка ${res.status}`, json?.error?.code);
    return json as T;
  }
  return { call };
}
export type Api = ReturnType<typeof createApi>;
