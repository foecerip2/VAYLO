import { sql } from '../db/index.js';
import { HttpError, badRequest, conflict, escapeHtml } from '../lib/errors.js';
import { createPost } from './contests.js';
import { notifyUser, openAppButton } from './notify.js';
import { getSettings, setSettings, clearSettingsCache } from './settings.js';

const DAY = 86_400_000;

/* ---------- состояние и защитные проверки ---------- */

export interface ClosureState {
  active: boolean; endsAt: Date | null; reason: string; altText: string; altUrl: string; announcedAt: Date | null; mode: 'auto' | 'manual'; msLeft: number | null;
}

export async function closureState(): Promise<ClosureState> {
  const c = await getSettings('closure');
  const endsAt = c.ends_at ? new Date(c.ends_at) : null;
  return {
    active: c.active, endsAt, reason: c.reason, altText: c.alt_text, altUrl: c.alt_url,
    announcedAt: c.announced_at ? new Date(c.announced_at) : null, mode: c.ends_mode,
    msLeft: c.active && endsAt ? Math.max(0, endsAt.getTime() - Date.now()) : null,
  };
}

export async function isClosing(): Promise<boolean> {
  return (await getSettings('closure')).active;
}

/** Продажи, пополнения, пробные периоды, награды и промокоды закрыты с момента объявления. */
export async function assertSalesOpen(): Promise<void> {
  if (await isClosing()) throw conflict('Проект закрывается: продажи закрыты. Действующие подписки работают до окончания срока.', 'sales_closed');
}

export async function assertRegistrationOpen(): Promise<void> {
  if (await isClosing()) throw new HttpError(403, 'Проект закрывается, регистрация закрыта.', 'registration_closed');
}

/** Для публичного /config: всё, что нужно клиентам для таймера. */
export async function publicClosure() {
  const s = await closureState();
  if (!s.active) return { active: false as const };
  return { active: true as const, endsAt: s.endsAt?.toISOString() ?? null, serverNow: new Date().toISOString(), reason: s.reason, altText: s.altText, altUrl: s.altUrl };
}

export function formatLeft(ms: number): string {
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d} дн. ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${Math.max(m, 0)} мин`;
}

export const MSK = (d: Date) => d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (МСК)';

/* ---------- поиск последнего оплатившего через ЮKassa ---------- */

export interface PaidSegment { paymentId: string; externalId: string | null; paidAt: Date; amount: number; days: number; start: Date; end: Date }
export interface PaidUser { userId: string; tgId: string | null; username: string | null; firstName: string | null; expiresAt: Date; paidUntil: Date; effective: Date; segments: PaidSegment[] }

/**
 * Оплаченный срок считается цепочкой: каждая успешная оплата тарифа через ЮKassa продлевает срок на свои дни
 * (начиная с max(текущий конец, момент оплаты)). Дни, выданные вручную, подарки, промокоды, бонусы и пробные
 * периоды в цепочку не входят. Итог = min(цепочка, фактическое окончание подписки).
 */
export async function paidUsers(skip: string[] = []): Promise<PaidUser[]> {
  const rows = await sql()`
    select p.id, p.external_id, p.user_id, p.paid_at, p.amount,
      coalesce((p.payload->'plan'->>'days')::int, pl.duration_days) as days,
      u.tg_id, u.username, u.first_name, s.expires_at
    from payments p
    join subscriptions s on s.user_id = p.user_id and s.expires_at > now() and not s.is_trial
    join users u on u.id = p.user_id
    left join plans pl on pl.id = p.plan_id
    where p.provider = 'yookassa' and p.status = 'succeeded' and p.purpose = 'plan' and p.amount > 0
      and coalesce(p.payload->>'gift', '') = '' and p.paid_at is not null
      and p.user_id <> all(${skip}::uuid[])
    order by p.user_id, p.paid_at`;
  const byUser = new Map<string, PaidUser>();
  for (const r of rows as any[]) {
    const days = Number(r.days ?? 0);
    if (!(days > 0)) continue;
    let u = byUser.get(r.user_id);
    if (!u) { u = { userId: r.user_id, tgId: r.tg_id ? String(r.tg_id) : null, username: r.username, firstName: r.first_name, expiresAt: r.expires_at, paidUntil: new Date(0), effective: new Date(0), segments: [] }; byUser.set(r.user_id, u); }
    const paidAt = r.paid_at as Date;
    const start = new Date(Math.max(u.paidUntil.getTime(), paidAt.getTime()));
    const end = new Date(start.getTime() + days * DAY);
    u.segments.push({ paymentId: r.id, externalId: r.external_id, paidAt, amount: Number(r.amount), days, start, end });
    u.paidUntil = end;
  }
  const out = [...byUser.values()];
  for (const u of out) u.effective = new Date(Math.min(u.paidUntil.getTime(), u.expiresAt.getTime()));
  return out.filter((u) => u.effective.getTime() > Date.now()).sort((a, b) => b.effective.getTime() - a.effective.getTime());
}

export async function lastPaidUser(skip: string[] = []): Promise<PaidUser | null> {
  return (await paidUsers(skip))[0] ?? null;
}

const view = (u: PaidUser | null) => u && { userId: u.userId, tgId: u.tgId, username: u.username, firstName: u.firstName, expiresAt: u.expiresAt.toISOString(), paidUntil: u.paidUntil.toISOString(), effective: u.effective.toISOString() };

/** Данные для админки: кто сейчас «последний», кого пропустили, что отправлено. */
export async function closureOverview() {
  const c = await getSettings('closure');
  const s = await closureState();
  const last = await lastPaidUser(c.skip_user_ids);
  const skipped = c.skip_user_ids.length ? await sql()`select id, tg_id, username, first_name from users where id = any(${c.skip_user_ids}::uuid[])` : [];
  const sent = await sql()`select step, count(*)::int as n from bot_funnel_sent where step like 'closure_%' group by step order by step`;
  const [cnt] = await sql()`select count(distinct s.user_id)::int as n from subscriptions s where s.expires_at > now() and not s.is_trial`;
  return {
    active: s.active, endsAt: s.endsAt?.toISOString() ?? null, mode: s.mode, announcedAt: s.announcedAt?.toISOString() ?? null,
    reason: c.reason, altText: c.alt_text, altUrl: c.alt_url, remindDays: c.remind_days, farewell: c.farewell,
    lastPaid: view(last), activeSubscribers: cnt!.n,
    skipped: skipped.map((u: any) => ({ userId: u.id, tgId: u.tg_id ? String(u.tg_id) : null, username: u.username, firstName: u.first_name })),
    sent: Object.fromEntries(sent.map((r: any) => [r.step, r.n])),
  };
}

/* ---------- управление ---------- */

export interface AnnounceInput { reason?: string; altText?: string; altUrl?: string; mode: 'auto' | 'manual'; endsAt?: Date; channelPost?: boolean; remindDays?: number[]; farewell?: boolean; by?: string | null }

async function resolveEnd(mode: 'auto' | 'manual', manual: Date | undefined, skip: string[]): Promise<Date> {
  if (mode === 'manual') {
    if (!manual || manual.getTime() < Date.now() + 60_000) throw badRequest('Укажите дату закрытия в будущем');
    return manual;
  }
  const last = await lastPaidUser(skip);
  if (!last) throw badRequest('Не найдено ни одной действующей подписки, оплаченной через ЮKassa. Укажите дату вручную.', 'no_paid_users');
  return last.effective;
}

/** Объявить закрытие: закрывает продажи и регистрацию, отключает автопродление, ставит таймер. Рассылку делает воркер. */
export async function announceClosure(i: AnnounceInput): Promise<{ endsAt: Date; postStatus: string; postError: string }> {
  const cur = await getSettings('closure');
  if (cur.active) throw conflict('Закрытие уже объявлено. Измените дату или отмените его.');
  const endsAt = await resolveEnd(i.mode, i.endsAt, cur.skip_user_ids);
  await setSettings('closure', {
    ...cur, active: true, announced_at: new Date().toISOString(), ends_at: endsAt.toISOString(), ends_mode: i.mode,
    reason: i.reason?.trim() || cur.reason, alt_text: i.altText ?? cur.alt_text, alt_url: i.altUrl ?? cur.alt_url,
    remind_days: i.remindDays ?? cur.remind_days, farewell: i.farewell ?? cur.farewell,
  } as any);
  clearSettingsCache();
  await sql()`update users set auto_renew = false where auto_renew`;
  // чтобы рассылки, записанные до закрытия, не продолжали предлагать покупки
  await sql()`update campaigns set is_active = false where is_active`.catch(() => {});
  let postStatus = 'skipped', postError = '';
  if (i.channelPost) {
    try {
      const st = await closureState();
      const r = await createPost({ kind: 'custom', text: channelText(st, endsAt), by: i.by ?? null }, true);
      postStatus = r.status; postError = r.error;
    } catch (e) { postStatus = 'failed'; postError = (e as Error).message; }
  }
  return { endsAt, postStatus, postError };
}

const channelText = (s: ClosureState, endsAt: Date) => `😢 <b>Проект закрывается</b>\n\n${escapeHtml(s.reason)}\n\n🚫 Продажи и регистрация закрыты.\n💙 Действующие подписки работают до окончания срока, а сервис полностью завершит работу <b>${MSK(endsAt)}</b> ⏳${s.altText ? `\n\n🧭 ${escapeHtml(s.altText)}` : ''}`;

/** Правка даты/режима/пропусков, пока закрытие активно (и подготовка пропусков до запуска). */
export async function editClosure(p: { mode?: 'auto' | 'manual'; endsAt?: Date; skipAdd?: string; skipRemove?: string; reason?: string; altText?: string; altUrl?: string; remindDays?: number[]; farewell?: boolean }): Promise<void> {
  const cur = await getSettings('closure');
  let skip = cur.skip_user_ids;
  if (p.skipAdd && !skip.includes(p.skipAdd)) skip = [...skip, p.skipAdd];
  if (p.skipRemove) skip = skip.filter((x) => x !== p.skipRemove);
  const mode = p.mode ?? cur.ends_mode;
  let ends = cur.ends_at;
  if (cur.active) {
    if (mode === 'manual') { if (p.endsAt || !cur.ends_at) ends = (await resolveEnd('manual', p.endsAt, skip)).toISOString(); }
    else if (p.mode || p.skipAdd || p.skipRemove) ends = (await resolveEnd('auto', undefined, skip)).toISOString();
  }
  await setSettings('closure', { ...cur, skip_user_ids: skip, ends_mode: mode, ends_at: ends, reason: p.reason ?? cur.reason, alt_text: p.altText ?? cur.alt_text, alt_url: p.altUrl ?? cur.alt_url, remind_days: p.remindDays ?? cur.remind_days, farewell: p.farewell ?? cur.farewell } as any);
  clearSettingsCache();
}

export async function cancelClosure(notify: boolean): Promise<number> {
  const cur = await getSettings('closure');
  if (!cur.active) throw conflict('Закрытие не объявлено');
  await setSettings('closure', { ...cur, active: false, announced_at: '', ends_at: '' } as any);
  clearSettingsCache();
  // получатели «закрытие отменено» — те, кому уходило объявление; метки сбрасываем, чтобы возможное новое закрытие шло с нуля
  const ids = notify ? (await sql()`select user_id from bot_funnel_sent where step = 'closure_announce'`).map((r) => r.user_id as string) : [];
  await sql()`delete from bot_funnel_sent where step like 'closure\_%'`;
  // отправка в фоне: на тысячи пользователей запрос иначе не успеет ответить
  void (async () => {
    for (const id of ids) {
      await notifyUser(id, '✅ <b>Хорошие новости: закрытие проекта отменено.</b>\nСервис продолжает работу, продажи и регистрация снова открыты.', [openAppButton()]).catch(() => {});
      await new Promise((r) => setTimeout(r, 45));
    }
  })();
  return ids.length;
}

/* ---------- рассылки по таймеру ---------- */

const BATCH = 300;

async function sendStep(step: string, rows: readonly Record<string, unknown>[], text: (r: Record<string, unknown>) => string): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const id = r.id as string;
    const mark = await sql()`insert into bot_funnel_sent (user_id, step) values (${id}, ${step}) on conflict do nothing returning 1`;
    if (!mark.length) continue;
    await notifyUser(id, text(r), [openAppButton('Открыть приложение')]);
    n++;
    await new Promise((res) => setTimeout(res, 45));
  }
  return n;
}

export const announcementText = (s: ClosureState, subExpires: Date | null): string => {
  const end = s.endsAt!;
  const left = formatLeft(Math.max(0, end.getTime() - Date.now()));
  return [
    '😢 <b>Проект закрывается</b>', '',
    escapeHtml(s.reason), '',
    `⏳ До закрытия осталось: <b>${left}</b> (до ${MSK(end)})`,
    '🚫 Продажи и регистрация новых пользователей закрыты.',
    subExpires ? `💙 Ваша подписка не слетит: она будет работать до ${MSK(subExpires)}.` : '😔 У вас нет активной подписки, поэтому оформить её уже нельзя.',
    s.altText ? `\n🧭 ${escapeHtml(s.altText)}` : '',
  ].filter((x) => x !== '').join('\n');
};

export async function closureTick(): Promise<number> {
  const c = await getSettings('closure');
  if (!c.active || !c.ends_at) return 0;
  const s = await closureState();
  const end = s.endsAt!;
  let n = 0;
  // 1) объявление — всем, у кого есть чат с ботом
  const ann = await sql()`select u.id, (select max(x.expires_at) from subscriptions x where x.user_id = u.id and x.expires_at > now()) as exp
    from users u where u.tg_id is not null and not u.bot_blocked and u.status = 'active'
      and not exists (select 1 from bot_funnel_sent f where f.user_id = u.id and f.step = 'closure_announce') order by u.created_at limit ${BATCH}`;
  n += await sendStep('closure_announce', ann, (r) => announcementText(s, (r.exp as Date | null) ?? null));
  if (ann.length) return n; // дорассылаем в следующих тиках, напоминания — после
  // 2) напоминания владельцам подписки: только ближайший пройденный порог
  const left = end.getTime() - Date.now();
  if (left > 0) {
    const passed = [...c.remind_days].sort((a, b) => a - b).find((d) => left <= d * DAY);
    if (passed !== undefined) {
      const step = `closure_d${passed}`;
      const subs2 = await sql()`select u.id, max(x.expires_at) as exp from users u join subscriptions x on x.user_id = u.id and x.expires_at > now()
        where u.tg_id is not null and not u.bot_blocked and u.status = 'active'
          and not exists (select 1 from bot_funnel_sent f where f.user_id = u.id and f.step = ${step})
          and exists (select 1 from bot_funnel_sent f where f.user_id = u.id and f.step = 'closure_announce' and f.sent_at < now() - interval '1 day')
        group by u.id limit ${BATCH}`;
      n += await sendStep(step, subs2, (r) => `⏳😔 <b>До закрытия проекта осталось ${formatLeft(Math.max(0, end.getTime() - Date.now()))}</b>\n\nСервис завершит работу ${MSK(end)} 💔\n${r.exp ? `💙 Ваша подписка действует до ${MSK(r.exp as Date)}.\n` : ''}Пожалуйста, заранее подберите замену: нам очень жаль, что так вышло 🥀${s.altText ? `\n\n🧭 ${escapeHtml(s.altText)}` : ''}`);
    }
  } else if (c.farewell) {
    const all = await sql()`select u.id from users u where u.tg_id is not null and not u.bot_blocked and u.status = 'active'
      and not exists (select 1 from bot_funnel_sent f where f.user_id = u.id and f.step = 'closure_farewell') order by u.created_at limit ${BATCH}`;
    n += await sendStep('closure_farewell', all, () => `🕊 <b>Спасибо, что были с нами</b> 💔\n\nСегодня сервис завершает работу. Нам очень грустно прощаться 😢 Мы безмерно благодарны вам за доверие, поддержку и тёплые слова 🙏\n\nЖелаем вам стабильного интернета и всего самого доброго ✨${s.altText ? `\n\n🧭 ${escapeHtml(s.altText)}` : ''}`);
  }
  return n;
}

/* ---------- список для возвратов ---------- */

export interface RefundRow { tgId: string | null; username: string | null; paymentId: string; externalId: string | null; paidAt: string; amountRub: number; days: number; daysLeft: number; unusedRub: number; expiresAt: string }

/** Оценка неиспользованного остатка по каждой оплате ЮKassa пропорционально оставшимся дням. Это ориентир для ручных возвратов. */
export async function refundList(): Promise<RefundRow[]> {
  const out: RefundRow[] = [];
  for (const u of await paidUsers([])) {
    for (const seg of u.segments) {
      const total = seg.end.getTime() - seg.start.getTime();
      const remain = Math.max(0, Math.min(seg.end.getTime(), u.expiresAt.getTime()) - Math.max(Date.now(), seg.start.getTime()));
      if (remain <= 0) continue;
      out.push({ tgId: u.tgId, username: u.username, paymentId: seg.paymentId, externalId: seg.externalId, paidAt: seg.paidAt.toISOString(), amountRub: seg.amount / 100, days: seg.days, daysLeft: Math.ceil(remain / DAY), unusedRub: Math.round((seg.amount / 100) * (remain / total) * 100) / 100, expiresAt: u.expiresAt.toISOString() });
    }
  }
  return out;
}

export function refundCsv(rows: RefundRow[]): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['tg_id', 'username', 'id платежа', 'id в ЮKassa', 'оплачено', 'сумма, ₽', 'дней в оплате', 'осталось дней', 'ориентир остатка, ₽', 'подписка до'];
  return '﻿' + [head, ...rows.map((r) => [r.tgId, r.username ? '@' + r.username : '', r.paymentId, r.externalId, r.paidAt, r.amountRub, r.days, r.daysLeft, r.unusedRub, r.expiresAt])].map((l) => l.map(esc).join(';')).join('\n');
}
