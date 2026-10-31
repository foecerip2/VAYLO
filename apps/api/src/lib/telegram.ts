import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface InitDataResult {
  user: TgUser;
  startParam?: string;
  authDate: number;
}

/**
 * Проверка Telegram WebApp initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = HMAC_SHA256(secret_key, data_check_string)
 */
export function validateInitData(initData: string, botToken: string, maxAgeSec = 86400, now = Date.now()): InitDataResult | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;
  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as TgUser;
    if (typeof user.id !== 'number') return null;
    return { user, startParam: params.get('start_param') ?? undefined, authDate };
  } catch {
    return null;
  }
}

export interface TgButton {
  text: string;
  url?: string;
  web_app?: { url: string };
  callback_data?: string;
}

export type SendResult = { ok: true } | { ok: false; blocked: boolean; error: string };

export async function tgCall<T = unknown>(method: string, body: Record<string, unknown>, token = config().BOT_TOKEN): Promise<{ ok: boolean; result?: T; error_code?: number; description?: string }> {
  const url = `${config().TELEGRAM_API_ROOT}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as any;
}

export async function sendTelegramMessage(chatId: number, text: string, buttons?: TgButton[][]): Promise<SendResult> {
  if (!config().BOT_TOKEN) return { ok: false, blocked: false, error: 'BOT_TOKEN не задан' };
  try {
    const r = await tgCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
    if (r.ok) return { ok: true };
    return { ok: false, blocked: r.error_code === 403, error: r.description ?? 'unknown' };
  } catch (e) {
    return { ok: false, blocked: false, error: (e as Error).message };
  }
}
