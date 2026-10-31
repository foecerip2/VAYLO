import { sql } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { tgCall } from '../lib/telegram.js';
import { config } from '../config.js';
import { getSettings } from './settings.js';

const KEY = 'welcome';
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Определяем тип по сигнатуре файла, а не по заявленному mime */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export async function saveWelcomeImage(buf: Buffer): Promise<number> {
  if (buf.length > MAX_IMAGE_BYTES) throw badRequest('Картинка слишком большая (максимум 2 МБ)', 'too_big');
  const mime = sniffImage(buf);
  if (!mime) throw badRequest('Нужна картинка JPG, PNG или WebP', 'bad_image');
  const [r] = await sql()`
    insert into bot_media (key, mime, data, version) values (${KEY}, ${mime}, ${buf}, 1)
    on conflict (key) do update set mime = excluded.mime, data = excluded.data, version = bot_media.version + 1, updated_at = now()
    returning version`;
  return r!.version as number;
}

export async function deleteWelcomeImage(): Promise<void> {
  await sql()`delete from bot_media where key = ${KEY}`;
}

export async function getWelcomeImage(): Promise<{ mime: string; data: Buffer; version: number } | null> {
  const [r] = await sql()`select mime, data, version from bot_media where key = ${KEY}`;
  return r ? { mime: r.mime as string, data: r.data as Buffer, version: r.version as number } : null;
}

export async function welcomeImageUrl(): Promise<string | null> {
  const [r] = await sql()`select version from bot_media where key = ${KEY}`;
  return r ? `${config().API_URL.replace(/\/$/, '')}/api/v1/media/welcome?v=${r.version}` : null;
}

/** Применяет описание и короткое описание бота в Telegram (то, что видно до нажатия Start). */
export async function syncBotDescription(): Promise<{ ok: boolean; error?: string }> {
  if (!config().BOT_TOKEN) return { ok: false, error: 'BOT_TOKEN не задан' };
  const cfg = await getSettings('bot_welcome');
  const a = await tgCall('setMyDescription', { description: cfg.description });
  if (!a.ok) return { ok: false, error: a.description ?? 'setMyDescription не удался' };
  const b = await tgCall('setMyShortDescription', { short_description: cfg.short_description });
  if (!b.ok) return { ok: false, error: b.description ?? 'setMyShortDescription не удался' };
  return { ok: true };
}
