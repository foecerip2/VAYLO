import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { conflict, notFound } from '../lib/errors.js';
import { inChannels } from './gate.js';
import { assertSalesOpen } from './closure.js';
import { getSettings } from './settings.js';
import { grantAccess } from './subscriptions.js';

export interface QuestRow {
  id: string;
  title: string;
  description: string;
  type: string;
  target: number;
  reward_type: 'days' | 'balance';
  reward_value: number;
  repeat: 'once' | 'daily';
  config: Record<string, any>;
  sort: number;
  is_active: boolean;
}

/** Каталог достижений: условие по числу полученных наград, серии заходов или закрытию всех разовых заданий; бонус — дни подписки */
export interface AchievementDef { code: string; title: string; text: string; icon: string; kind: 'claims' | 'streak' | 'all_once'; need: number; days: number }
export const ACHIEVEMENTS: AchievementDef[] = [
  { code: 'claims_1', title: 'Первый шаг', text: 'Заберите первую награду за задание', icon: '🎯', kind: 'claims', need: 1, days: 1 },
  { code: 'claims_5', title: 'Набираем ход', text: 'Заберите 5 наград за задания', icon: '⚡', kind: 'claims', need: 5, days: 2 },
  { code: 'claims_15', title: 'Охотник за наградами', text: 'Заберите 15 наград за задания', icon: '🏹', kind: 'claims', need: 15, days: 3 },
  { code: 'claims_40', title: 'Легенда', text: 'Заберите 40 наград за задания', icon: '👑', kind: 'claims', need: 40, days: 7 },
  { code: 'streak_3', title: 'Три дня подряд', text: 'Серия заходов из 3 дней', icon: '🔥', kind: 'streak', need: 3, days: 1 },
  { code: 'streak_7', title: 'Неделя без пропусков', text: 'Серия заходов из 7 дней', icon: '🌟', kind: 'streak', need: 7, days: 3 },
  { code: 'streak_30', title: 'Железная привычка', text: 'Серия заходов из 30 дней', icon: '💎', kind: 'streak', need: 30, days: 7 },
  { code: 'all_once', title: 'Чистый лист', text: 'Выполните все разовые задания', icon: '🏆', kind: 'all_once', need: 1, days: 5 },
];

const dstr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function today(): Promise<string> {
  const [r] = await sql()`select to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD') as d`;
  return r!.d as string;
}

async function progressOf(user: UserRow, q: QuestRow, day: string): Promise<number> {
  const db = sql();
  switch (q.type) {
    case 'daily_checkin':
      return user.last_checkin && dstr(user.last_checkin) === day ? 1 : 0;
    case 'join_channel':
      return (await inChannels(user)) ? 1 : 0;
    case 'invite_friends': {
      const [r] = await db`select count(*)::int as n from users where referrer_id = ${user.id}`;
      return r!.n;
    }
    case 'first_payment': {
      const [r] = await db`select count(*)::int as n from payments where user_id = ${user.id} and status = 'succeeded' and purpose = 'plan' and amount > 0`;
      return r!.n;
    }
    case 'topup_total': {
      const [r] = await db`select coalesce(sum(amount),0)::bigint as n from payments where user_id = ${user.id} and status = 'succeeded' and purpose = 'topup'`;
      return Number(r!.n);
    }
    case 'spend_total': {
      const [r] = await db`select coalesce(sum(amount),0)::bigint as n from payments where user_id = ${user.id} and status = 'succeeded' and purpose in ('plan','addon')`;
      return Number(r!.n);
    }
    case 'have_subscription': {
      const [r] = await db`select 1 from subscriptions where user_id = ${user.id} and expires_at > now() and not is_trial`;
      return r ? 1 : 0;
    }
    case 'traffic_used': {
      const [r] = await db`select traffic_used_bytes from subscriptions where user_id = ${user.id}`;
      return Number(r?.traffic_used_bytes ?? 0);
    }
    case 'open_link':
      return 1;
    default:
      return 0;
  }
}

/** Выдаёт достижения, которые пользователь уже заслужил (в т.ч. за задания, выполненные до появления системы); безопасно при параллельных вызовах */
export async function syncAchievements(userId: string): Promise<AchievementDef[]> {
  return sql().begin(async (tx) => {
    await tx`select 1 from users where id = ${userId} for update`;
    return awardAchievements(tx, userId);
  });
}

export async function listQuests(user: UserRow) {
  const cfg = await getSettings('quests');
  if (!cfg.enabled) return { enabled: false, streak: 0, quests: [], achievements: [], newAchievements: [] };
  const fresh = cfg.achievements === false ? [] : await syncAchievements(user.id);
  if (fresh.length) {
    const [u] = await sql()<UserRow[]>`select * from users where id = ${user.id}`;
    if (u) user = u;
  }
  const day = await today();
  const quests = await sql()<QuestRow[]>`select * from quests where is_active order by sort, created_at`;
  const claims = await sql()<{ quest_id: string; period: string }[]>`select quest_id, period from quest_claims where user_id = ${user.id} and (period = 'once' or period = ${day})`;
  const out = [];
  for (const q of quests) {
    const progress = Number(await progressOf(user, q, day));
    const claimed = claims.some((c) => c.quest_id === q.id && c.period === (q.repeat === 'daily' ? day : 'once'));
    const target = Number(q.target);
    out.push({
      id: q.id,
      title: q.title,
      description: q.description,
      type: q.type,
      target,
      progress: Math.min(progress, target),
      rewardType: q.reward_type,
      rewardValue: Number(q.reward_value),
      repeat: q.repeat,
      claimed,
      claimable: !claimed && (q.type === 'daily_checkin' || progress >= target),
      url: q.type === 'open_link' ? String(q.config?.url ?? '') : null,
    });
  }
  const yesterday = new Date(Date.parse(day + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
  const last = user.last_checkin ? dstr(user.last_checkin) : null;
  const streak = last === day || last === yesterday ? user.checkin_streak : 0;
  const achievements = cfg.achievements === false ? [] : await listAchievements(user.id, user.checkin_streak, out);
  return { enabled: true, streak, quests: out, achievements, newAchievements: fresh.map((a) => ({ code: a.code, title: a.title, icon: a.icon, days: a.days })) };
}

async function listAchievements(userId: string, streak: number, quests: { repeat: string; claimed: boolean }[]) {
  const db = sql();
  const owned = await db<{ code: string; earned_at: Date }[]>`select code, earned_at from user_achievements where user_id = ${userId}`;
  const [c] = await db`select count(*)::int as n from quest_claims where user_id = ${userId}`;
  const once = quests.filter((x) => x.repeat === 'once');
  return ACHIEVEMENTS.map((a) => {
    const got = owned.find((o) => o.code === a.code);
    const value = a.kind === 'claims' ? Number(c!.n) : a.kind === 'streak' ? streak : once.filter((x) => x.claimed).length;
    const need = a.kind === 'all_once' ? Math.max(1, once.length) : a.need;
    return { code: a.code, title: a.title, text: a.text, icon: a.icon, days: a.days, earned: !!got, earnedAt: got ? got.earned_at.toISOString() : null, progress: Math.min(value, need), target: need };
  });
}

/** Проверяет и выдаёт новые достижения внутри транзакции получения награды; бонус зачисляется днями подписки */
async function awardAchievements(tx: any, userId: string): Promise<AchievementDef[]> {
  // серия — реально достигнутая (хранится в профиле), поэтому прошлые заслуги засчитываются
  const streak: number = (await tx`select checkin_streak from users where id = ${userId}`)[0]?.checkin_streak ?? 0;
  const owned = new Set<string>((await tx`select code from user_achievements where user_id = ${userId}`).map((r: any) => r.code));
  const [c] = await tx`select count(*)::int as n from quest_claims where user_id = ${userId}`;
  const [o] = await tx`select count(*)::int as total, count(*) filter (where exists (select 1 from quest_claims c where c.quest_id = q.id and c.user_id = ${userId}))::int as done from quests q where q.is_active and q.repeat = 'once'`;
  const fresh: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (owned.has(a.code)) continue;
    const ok = a.kind === 'claims' ? c!.n >= a.need : a.kind === 'streak' ? streak >= a.need : o!.total > 0 && o!.done >= o!.total;
    if (!ok) continue;
    const ins = await tx`insert into user_achievements (user_id, code) values (${userId}, ${a.code}) on conflict do nothing returning 1`;
    if (!ins.length) continue;
    await grantAccess(tx, userId, { days: a.days });
    fresh.push(a);
  }
  return fresh;
}

export async function claimQuest(user: UserRow, questId: string): Promise<{ rewardType: 'days' | 'balance'; rewardValue: number; streak?: number; achievements: { code: string; title: string; icon: string; days: number }[] }> {
  const cfg = await getSettings('quests');
  if (!cfg.enabled) throw conflict('Квесты отключены', 'quests_disabled');
  await assertSalesOpen();
  const [q] = await sql()<QuestRow[]>`select * from quests where id = ${questId} and is_active`;
  if (!q) throw notFound('Задание не найдено');
  const day = await today();
  const period = q.repeat === 'daily' ? day : 'once';
  const target = Number(q.target);

  // ежедневный чек-ин: само нажатие — выполнение
  if (q.type !== 'daily_checkin') {
    const p = await progressOf(user, q, day);
    if (Number(p) < target) throw conflict('Задание ещё не выполнено', 'quest_not_done');
  }

  return sql().begin(async (tx) => {
    const [u] = await tx<UserRow[]>`select * from users where id = ${user.id} for update`;
    const claimed = await tx`insert into quest_claims (user_id, quest_id, period) values (${user.id}, ${q.id}, ${period}) on conflict do nothing returning 1`;
    if (!claimed.length) throw conflict('Награда уже получена', 'quest_claimed');

    let value = Number(q.reward_value);
    let streak: number | undefined;
    if (q.type === 'daily_checkin') {
      const yesterday = new Date(Date.parse(day + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
      const last = u!.last_checkin ? dstr(u!.last_checkin) : null;
      streak = last === yesterday ? u!.checkin_streak + 1 : 1;
      await tx`update users set checkin_streak = ${streak}, last_checkin = ${day} where id = ${user.id}`;
      if (q.reward_type === 'balance') value += Math.min(streak - 1, 6) * cfg.streak_step;
    }
    if (q.reward_type === 'days') {
      await grantAccess(tx, user.id, { days: value });
    } else {
      const [b] = await tx`update users set balance = balance + ${value} where id = ${user.id} returning balance`;
      await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${user.id}, 'quest', ${value}, ${b!.balance}, ${'Задание: ' + q.title})`;
    }
    const fresh = cfg.achievements === false ? [] : await awardAchievements(tx, user.id);
    return { rewardType: q.reward_type, rewardValue: value, streak, achievements: fresh.map((a) => ({ code: a.code, title: a.title, icon: a.icon, days: a.days })) };
  });
}
