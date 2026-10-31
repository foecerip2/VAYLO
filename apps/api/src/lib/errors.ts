export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /** Технические подробности: в логи и админам, но НЕ пользователю */
    public detail?: string,
  ) {
    super(message);
  }
}
export const badRequest = (m: string, code?: string) => new HttpError(400, m, code);
export const unauthorized = (m = 'Требуется авторизация', code = 'unauthorized') => new HttpError(401, m, code);
export const forbidden = (m = 'Недостаточно прав') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Не найдено') => new HttpError(404, m, 'not_found');
export const conflict = (m: string, code?: string) => new HttpError(409, m, code);
export const badGateway = (m: string, code?: string, detail?: string) => new HttpError(502, m, code, detail);

/** Ошибка, которую бессмысленно повторять (4xx: нет подписки, бан, товар удалён и т.п.) */
export function isPermanentError(e: unknown): e is HttpError {
  return e instanceof HttpError && e.status >= 400 && e.status < 500;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
