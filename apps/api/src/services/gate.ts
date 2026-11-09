import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { HttpError } from '../lib/errors.js';
import { tgCall } from '../lib/telegram.js';
import { getSettings } from './settings.js';

export interface GateChat {
  chat: string;
  title: string;
  url: string;
  joined: boolean;
}
export interface GateStatus {
  required: boolean;
  ok: boolean;
  text: string;
  chats: GateChat[];
  needTelegram?: boolean;
}

const OK_TTL_MS = 10 * 60_000;
const MEMBER = new Set(['creator', 'administrator', 'member', 'restricted']);

export function chatUrl(chat: string, url: string): string {
  if (url) return url;
  return chat.startsWith('@') ? `https://t.me/${chat.slice(1)}` : '';
}

export async function isTgAdmin(tgId: number | null): Promise<boolean> {
  if (!tgId) return false;
  const [a] = await sql()`select 1 from admins where tg_id = ${tgId}`;
  return Boolean(a);
}

/** true — участник, false — нет, null — не удалось проверить (бот не админ канала и т.п.) */
export async function isMember(chat: string, tgId: number): Promise<boolean | null> {
  const chatId = /^-?\d+$/.test(chat) ? Number(chat) : chat;
  try {
    const r = await tgCall<{ status: string; is_member?: boolean }>('getChatMember', { chat_id: chatId, user_id: tgId });
    if (r.ok && r.result) {
      if (r.result.status === 'restricted') return r.result.is_member !== false;
      return MEMBER.has(r.result.status);
    }
    const d = (r.description ?? '').toLowerCase();
    if (r.error_code === 400 && (d.includes('user not found') || d.includes('participant_id_invalid'))) return false;
    return null;
  } catch {
    return null;
  }
}

/** Проверка обязательной подписки. force — игнорировать кэш (кнопка «Проверить»). */
export async function gateStatus(user: UserRow, opts: { force?: boolean } = {}): Promise<GateStatus> {
  const cfg = await getSettings('gate');
  const chatsCfg = cfg.chats.filter((c) => c.chat);
  const none: GateStatus = { required: false, ok: true, text: cfg.text, chats: [] };
  if (!cfg.enabled || cfg.mode !== 'hard' || !chatsCfg.length) return none;
  if (!user.tg_id) {
    // аккаунт по почте без Telegram не может подтвердить подписку на канал: просим привязать Telegram, а не пропускаем мимо шлюза
    return user.password_hash ? { required: true, ok: false, text: 'Привяжите Telegram в профиле, чтобы продолжить', chats: [], needTelegram: true } : none;
  }
  if (await isTgAdmin(user.tg_id)) return none;

  const cached = !opts.force && user.channel_ok_at && Date.now() - user.channel_ok_at.getTime() < OK_TTL_MS;
  const chats: GateChat[] = [];
  let ok = true;
  for (const c of chatsCfg) {
    const joined = cached ? true : await isMember(c.chat, user.tg_id);
    // не удалось проверить (ошибка настройки) — не блокируем пользователей из-за нашей ошибки
    const j = joined === null ? true : joined;
    if (!j) ok = false;
    chats.push({ chat: c.chat, title: c.title || c.chat, url: chatUrl(c.chat, c.url), joined: j });
  }
  if (!cached) {
    if (ok) await sql()`update users set channel_ok_at = now() where id = ${user.id}`;
    else await sql()`update users set channel_ok_at = null where id = ${user.id}`;
  }
  return { required: true, ok, text: cfg.text, chats };
}

export async function enforceGate(user: UserRow): Promise<void> {
  const g = await gateStatus(user);
  if (!g.ok) throw new HttpError(403, g.text || 'Подпишитесь на канал', g.needTelegram ? 'telegram_required' : 'subscribe_required');
}

/**
 * Для условия «триал только подписчикам»: ведём себя как гейт — нет каналов в настройках
 * или не удалось проверить (бот не админ канала) → пропускаем, не блокируем всех из-за нашей настройки.
 */
export async function passesChannelCheck(user: UserRow): Promise<boolean> {
  const cfg = await getSettings('gate');
  const chats = cfg.chats.filter((c) => c.chat);
  if (!chats.length || !user.tg_id) return true;
  for (const c of chats) if ((await isMember(c.chat, user.tg_id)) === false) return false;
  return true;
}

/** Для квеста «подписка на канал»: есть ли хотя бы один канал и пользователь в нём */
export async function inChannels(user: UserRow): Promise<boolean> {
  const cfg = await getSettings('gate');
  const chats = cfg.chats.filter((c) => c.chat);
  if (!chats.length || !user.tg_id) return false;
  for (const c of chats) if ((await isMember(c.chat, user.tg_id)) !== true) return false;
  return true;
}
