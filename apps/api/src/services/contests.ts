import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { randomCode } from '../lib/crypto.js';
import { badRequest, conflict, escapeHtml, notFound } from '../lib/errors.js';
import { tgCall, type TgButton } from '../lib/telegram.js';
import { chatUrl, isMember } from './gate.js';
import { notifyUser, openAppButton } from './notify.js';
import { getSettings } from './settings.js';
import { grantAccess } from './subscriptions.js';
import { isClosing } from './closure.js';

export type PrizeKind = 'days' | 'balance' | 'discount' | 'manual';

export interface ContestRow {
  id: string; code: string; title: string; description: string; status: 'draft' | 'active' | 'finished' | 'cancelled';
  prize_kind: PrizeKind; prize_value: string | number; prize_text: string; winners_count: number; require_channel: boolean;
  starts_at: Date | null; ends_at: Date; post_text: string; finished_at: Date | null;
}

/* ---------- тексты ---------- */

export function prizeLabel(c: Pick<ContestRow, 'prize_kind' | 'prize_value' | 'prize_text'>): string {
  const v = Number(c.prize_value);
  if (c.prize_kind === 'days') return `${v} дн. подписки`;
  if (c.prize_kind === 'balance') return `${(v / 100).toFixed(0)} ₽ на баланс`;
  if (c.prize_kind === 'discount') return `скидка ${v}% на продление`;
  return c.prize_text || 'особый приз';
}

const MSK = (d: Date) => d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' (МСК)';

export function defaultPostText(c: Pick<ContestRow, 'title' | 'description' | 'prize_kind' | 'prize_value' | 'prize_text' | 'winners_count' | 'ends_at'>): string {
  const win = c.winners_count === 1 ? '1 победитель' : `победителей: ${c.winners_count}`;
  return [
    `🎁 <b>${escapeHtml(c.title)}</b>`,
    c.description.trim() ? escapeHtml(c.description.trim()) : '',
    `🏆 Приз: <b>${escapeHtml(prizeLabel(c))}</b> · ${win}`,
    `⏰ Итоги: ${MSK(c.ends_at)}`,
    'Нажмите «Участвовать» — это займёт секунду. Победителей выберет бот случайным образом.',
  ].filter(Boolean).join('\n\n');
}

export function botLink(start: string): string {
  const bot = config().BOT_USERNAME.replace(/^@/, '');
  return bot ? `https://t.me/${bot}?start=${start}` : '';
}

/* ---------- публикации в канал ---------- */

export async function contestChannel(): Promise<string> {
  const s = await getSettings('contests');
  if (s.channel) return s.channel;
  const g = await getSettings('gate');
  return g.chats.find((c) => c.chat)?.chat ?? '';
}

export interface PostInput { kind?: 'custom' | 'contest' | 'contest_result' | 'promo'; contestId?: string | null; adId?: string | null; text: string; imageUrl?: string; buttonText?: string; buttonUrl?: string; scheduledAt?: Date | null; by?: string | null }

export async function createPost(p: PostInput, sendNow: boolean): Promise<{ id: string; status: string; error: string }> {
  const chat = await contestChannel();
  if (!chat) throw badRequest('Канал для постов не указан. Заполните «Канал» в настройках конкурсов или добавьте канал в «Обязательную подписку».', 'no_channel');
  const when = p.scheduledAt && p.scheduledAt.getTime() > Date.now() + 30_000 ? p.scheduledAt : new Date();
  const [r] = await sql()`insert into channel_posts (kind, contest_id, ad_id, chat, text, image_url, button_text, button_url, scheduled_at, created_by)
    values (${p.kind ?? 'custom'}, ${p.contestId ?? null}, ${p.adId ?? null}, ${chat}, ${p.text}, ${p.imageUrl ?? ''}, ${p.buttonText ?? ''}, ${p.buttonUrl ?? ''}, ${when}, ${p.by ?? null}) returning id`;
  if (sendNow && when.getTime() <= Date.now() + 1000) return sendPost(r!.id as string);
  return { id: r!.id as string, status: 'scheduled', error: '' };
}

export async function sendPost(id: string): Promise<{ id: string; status: string; error: string }> {
  // атомарно «забираем» пост: параллельные тики не пошлют дважды
  const [p] = await sql()`update channel_posts set status = 'sent', sent_at = now() where id = ${id} and status = 'scheduled' returning *`;
  if (!p) return { id, status: 'skipped', error: '' };
  const chatId = /^-?\d+$/.test(p.chat as string) ? Number(p.chat) : p.chat;
  const kb: TgButton[][] | undefined = p.button_text && p.button_url ? [[{ text: p.button_text as string, url: p.button_url as string }]] : undefined;
  try {
    const r = p.image_url
      ? await tgCall<{ message_id: number }>('sendPhoto', { chat_id: chatId, photo: p.image_url, caption: (p.text as string).slice(0, 1024), parse_mode: 'HTML', ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) })
      : await tgCall<{ message_id: number }>('sendMessage', { chat_id: chatId, text: p.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });
    if (r.ok) {
      await sql()`update channel_posts set message_id = ${r.result?.message_id ?? null} where id = ${id}`;
      return { id, status: 'sent', error: '' };
    }
    const err = (r.description ?? 'ошибка Telegram').slice(0, 300);
    await sql()`update channel_posts set status = 'failed', error = ${err}, sent_at = null where id = ${id}`;
    return { id, status: 'failed', error: err };
  } catch (e) {
    const err = (e as Error).message.slice(0, 300);
    await sql()`update channel_posts set status = 'failed', error = ${err}, sent_at = null where id = ${id}`;
    return { id, status: 'failed', error: err };
  }
}

export async function postsTick(): Promise<number> {
  const due = await sql()`select id from channel_posts where status = 'scheduled' and scheduled_at <= now() order by scheduled_at limit 20`;
  for (const d of due) await sendPost(d.id as string);
  return due.length;
}

/* ---------- жизненный цикл конкурса ---------- */

export interface ContestInput { title: string; description?: string; prizeKind: PrizeKind; prizeValue?: number; prizeText?: string; winnersCount: number; requireChannel: boolean; endsAt: Date; postText?: string; by?: string | null }

export async function createContest(i: ContestInput): Promise<string> {
  if (i.endsAt.getTime() < Date.now() + 5 * 60_000) throw badRequest('Итоги должны быть минимум через 5 минут');
  if (i.prizeKind !== 'manual' && !(i.prizeValue && i.prizeValue > 0)) throw badRequest('Укажите размер приза');
  if (i.prizeKind === 'manual' && !i.prizeText?.trim()) throw badRequest('Опишите приз');
  if (i.prizeKind === 'discount' && (i.prizeValue ?? 0) > 90) throw badRequest('Скидка не больше 90%');
  for (let n = 0; n < 5; n++) {
    try {
      const [c] = await sql()`insert into contests (code, title, description, prize_kind, prize_value, prize_text, winners_count, require_channel, ends_at, post_text, created_by)
        values (${randomCode(8).toLowerCase()}, ${i.title}, ${i.description ?? ''}, ${i.prizeKind}, ${i.prizeValue ?? 0}, ${i.prizeText ?? ''}, ${i.winnersCount}, ${i.requireChannel}, ${i.endsAt}, ${i.postText ?? ''}, ${i.by ?? null}) returning id`;
      return c!.id as string;
    } catch (e: any) { if (e?.code !== '23505') throw e; }
  }
  throw new Error('Не удалось создать код конкурса');
}

export async function getContest(id: string): Promise<ContestRow> {
  const [c] = await sql()<ContestRow[]>`select * from contests where id = ${id}`;
  if (!c) throw notFound('Конкурс не найден');
  return c;
}

/** Активирует конкурс и публикует пост в канал (сразу или по расписанию). */
export async function publishContest(id: string, opts: { scheduleAt?: Date | null; by?: string | null } = {}): Promise<{ postStatus: string; error: string; link: string }> {
  const c = await getContest(id);
  if (c.status === 'finished' || c.status === 'cancelled') throw conflict('Конкурс уже завершён');
  const link = botLink(`c_${c.code}`);
  if (!link) throw badRequest('Не задан BOT_USERNAME — нельзя собрать ссылку на участие', 'no_bot_username');
  const text = c.post_text.trim() || defaultPostText(c);
  const post = await createPost({ kind: 'contest', contestId: c.id, text, buttonText: '🎁 Участвовать', buttonUrl: link, scheduledAt: opts.scheduleAt, by: opts.by }, true);
  if (post.status === 'failed') {
    // не активируем конкурс, если пост не ушёл: иначе никто о нём не узнает
    return { postStatus: 'failed', error: post.error, link };
  }
  await sql()`update contests set status = 'active', starts_at = coalesce(starts_at, now()) where id = ${id} and status in ('draft','active')`;
  return { postStatus: post.status, error: '', link };
}

export interface JoinResult { ok: boolean; reason?: 'not_active' | 'need_channel' | 'already' | 'disabled' | 'not_eligible'; channelUrl?: string; contest?: { title: string; prize: string; endsAt: string } }

export async function joinContest(user: UserRow, codeOrId: string): Promise<JoinResult> {
  const s = await getSettings('contests');
  if (!s.enabled || (await isClosing())) return { ok: false, reason: 'disabled' };
  const [c] = await sql()<ContestRow[]>`select * from contests where (code = ${codeOrId.toLowerCase()} or id::text = ${codeOrId})`;
  if (!c) throw notFound('Конкурс не найден');
  const info = { title: c.title, prize: prizeLabel(c), endsAt: c.ends_at.toISOString() };
  if (c.status !== 'active' || c.ends_at.getTime() <= Date.now()) return { ok: false, reason: 'not_active', contest: info };
  if (user.status !== 'active' || !user.tg_id) return { ok: false, reason: 'not_eligible', contest: info };
  if (c.require_channel) {
    const chat = await contestChannel();
    if (chat && (await isMember(chat, user.tg_id)) === false) return { ok: false, reason: 'need_channel', channelUrl: chatUrl(chat, ''), contest: info };
  }
  const ins = await sql()`insert into contest_entries (contest_id, user_id) values (${c.id}, ${user.id}) on conflict do nothing returning 1`;
  return { ok: true, reason: ins.length ? undefined : 'already', contest: info };
}

export async function activeContests(): Promise<{ code: string; title: string; prize: string; endsAt: string; entries: number }[]> {
  const rows = await sql()`select c.*, (select count(*)::int from contest_entries e where e.contest_id = c.id) as n from contests c where c.status = 'active' and c.ends_at > now() order by c.ends_at`;
  return rows.map((c: any) => ({ code: c.code, title: c.title, prize: prizeLabel(c), endsAt: (c.ends_at as Date).toISOString(), entries: c.n }));
}

const shuffle = <T,>(a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };

async function payPrize(c: ContestRow, userId: string): Promise<{ status: 'paid' | 'manual_pending' | 'failed'; note: string; text: string }> {
  const v = Number(c.prize_value);
  try {
    if (c.prize_kind === 'days') {
      await sql().begin(async (tx) => { await grantAccess(tx, userId, { days: v }); });
      return { status: 'paid', note: `+${v} дн.`, text: `К вашей подписке добавлено ${v} дн.` };
    }
    if (c.prize_kind === 'balance') {
      await sql().begin(async (tx) => {
        const [b] = await tx`update users set balance = balance + ${v} where id = ${userId} returning balance`;
        await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${userId}, 'contest', ${v}, ${b!.balance}, ${'Конкурс: ' + c.title})`;
      });
      return { status: 'paid', note: `+${(v / 100).toFixed(0)} ₽`, text: `На баланс зачислено ${(v / 100).toFixed(0)} ₽.` };
    }
    if (c.prize_kind === 'discount') {
      const code = 'WIN-' + randomCode(8);
      await sql()`insert into promo_codes (code, type, value, max_uses, expires_at) values (${code}, 'percent', ${v}, 1, now() + interval '30 days')`;
      return { status: 'paid', note: code, text: `Ваш промокод на скидку ${v}%: <code>${code}</code>. Действует 30 дней, один раз.` };
    }
    return { status: 'manual_pending', note: '', text: `Приз: ${escapeHtml(c.prize_text)}. Мы свяжемся с вами в этом чате в ближайшее время.` };
  } catch (e) {
    return { status: 'failed', note: (e as Error).message.slice(0, 200), text: '' };
  }
}

const who = (u: { username: string | null; first_name: string | null }) => (u.username ? `@${escapeHtml(u.username)}` : escapeHtml(u.first_name ?? 'участник'));

export interface DrawResult { winners: { userId: string; place: number; status: string }[]; entries: number }

/** Подведение итогов. Идемпотентно: статус меняется атомарно, второй вызов вернёт null. */
export async function finishContest(id: string): Promise<DrawResult | null> {
  const [c] = await sql()<ContestRow[]>`update contests set status = 'finished', finished_at = now() where id = ${id} and status = 'active' returning *`;
  if (!c) return null;
  const entries = await sql()`select e.user_id, u.tg_id, u.username, u.first_name from contest_entries e join users u on u.id = e.user_id
    where e.contest_id = ${id} and u.status = 'active' and u.tg_id is not null and not u.bot_blocked and not exists (select 1 from admins a where a.tg_id = u.tg_id)`;
  const chat = c.require_channel ? await contestChannel() : '';
  const picked: { user_id: string; username: string | null; first_name: string | null }[] = [];
  for (const e of shuffle([...entries])) {
    if (picked.length >= c.winners_count) break;
    // подписка проверяется в момент розыгрыша: кто отписался — выбывает; «не удалось проверить» не штрафуем
    if (chat && (await isMember(chat, Number(e.tg_id))) === false) continue;
    picked.push(e as any);
  }
  const out: DrawResult = { winners: [], entries: entries.length };
  let place = 0;
  for (const w of picked) {
    place++;
    const pay = await payPrize(c, w.user_id);
    await sql()`insert into contest_winners (contest_id, user_id, place, prize_status, note) values (${id}, ${w.user_id}, ${place}, ${pay.status}, ${pay.note})`;
    out.winners.push({ userId: w.user_id, place, status: pay.status });
    if (pay.status !== 'failed') {
      const ok = await notifyUser(w.user_id, `🎉 <b>Вы победили в конкурсе «${escapeHtml(c.title)}»!</b>\n\n${pay.text}`, [openAppButton()]);
      if (ok) await sql()`update contest_winners set notified_at = now() where contest_id = ${id} and user_id = ${w.user_id}`;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  const s = await getSettings('contests');
  if (s.publish_results) {
    const lines = picked.length ? picked.map((w, i) => `${i + 1}. ${who(w)}`).join('\n') : 'Подходящих участников не нашлось.';
    await createPost({ kind: 'contest_result', contestId: id, text: `🏁 <b>Итоги конкурса «${escapeHtml(c.title)}»</b>\n\nПриз: ${escapeHtml(prizeLabel(c))}\n\n${lines}\n\nСпасибо всем, кто участвовал! Следите за новыми конкурсами.`, by: 'auto' }, true).catch(() => {});
  }
  return out;
}

export async function cancelContest(id: string): Promise<void> {
  const r = await sql()`update contests set status = 'cancelled', finished_at = now() where id = ${id} and status in ('draft','active') returning id`;
  if (!r.length) throw conflict('Конкурс уже завершён');
  await sql()`update channel_posts set status = 'cancelled' where contest_id = ${id} and status = 'scheduled'`;
}

/** Тик воркера: отложенные посты и конкурсы, у которых наступил срок итогов. */
export async function contestsTick(): Promise<number> {
  let n = await postsTick();
  const s = await getSettings('contests');
  if (!s.enabled) return n;
  const due = await sql()`select id from contests where status = 'active' and ends_at <= now()`;
  for (const d of due) { await finishContest(d.id as string).catch((e) => console.error('[contests] finish', (e as Error).message)); n++; }
  return n;
}

let activeCache = { at: 0, v: false };
/** есть ли активные конкурсы (кэш 15 с) — для кнопки в меню бота */
export async function hasActiveContests(): Promise<boolean> {
  if (Date.now() - activeCache.at < 15_000) return activeCache.v;
  const s = await getSettings('contests');
  const v = s.enabled && !(await isClosing()) && (await sql()`select 1 from contests where status = 'active' and ends_at > now() limit 1`).length > 0;
  activeCache = { at: Date.now(), v };
  return v;
}
export const dropContestCache = () => { activeCache = { at: 0, v: false }; };
