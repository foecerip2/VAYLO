import { config } from '../config.js';
import { sql } from '../db/index.js';
import { sendTelegramMessage, type TgButton } from '../lib/telegram.js';

/** Отправка пользователю уведомления в бота. Если бот заблокирован — помечаем пользователя. */
export async function notifyUser(userId: string, text: string, buttons?: TgButton[][]): Promise<boolean> {
  const [u] = await sql()`select tg_id from users where id = ${userId}`;
  if (!u?.tg_id) return false;
  const r = await sendTelegramMessage(u.tg_id, text, buttons);
  if (!r.ok && r.blocked) await sql()`update users set bot_blocked = true where id = ${userId}`;
  return r.ok;
}

export function openAppButton(text = '🚀 Открыть приложение'): TgButton[] {
  return [{ text, web_app: { url: config().APP_URL } }];
}
