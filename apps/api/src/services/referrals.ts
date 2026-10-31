import { pluralDays } from '@vpn/shared';
import { config } from '../config.js';
import { sql, type TxSql } from '../db/index.js';
import type { PaymentRow, UserRow } from '../db/types.js';
import { notifyUser, openAppButton } from './notify.js';
import { getSettings } from './settings.js';
import { grantAccess } from './subscriptions.js';

export interface RankRow {
  id: string;
  name: string;
  min_paid: number;
  percent: number;
  extra_days: number;
  sort: number;
}

export async function listRanks(db: TxSql | ReturnType<typeof sql> = sql()): Promise<RankRow[]> {
  return db<RankRow[]>`select * from referral_ranks order by min_paid, sort`;
}

/** Сколько приглашённых оплатили (уровень 1) */
async function paidCount(db: TxSql | ReturnType<typeof sql>, userId: string): Promise<number> {
  const [r] = await db`select count(distinct referee_id)::int as n from referral_rewards where referrer_id = ${userId} and level = 1 and kind = 'payment'`;
  return r!.n as number;
}

export function rankFor(ranks: RankRow[], paid: number): RankRow | null {
  let cur: RankRow | null = null;
  for (const r of ranks) if (paid >= r.min_paid) cur = r;
  return cur;
}

interface Granted {
  userId: string;
  level: number;
  days: number;
  balance: number;
  /** деньги зачислены на реферальный счёт (иначе — на основной баланс) */
  ref: boolean;
}

/**
 * Награды за оплату тарифа приглашённым.
 * Уровень 1: дни и/или % (+ бонус ранга) за первую оплату (или за каждую, если включено «recurring»).
 * Уровень 2: % для того, кто пригласил пригласившего. Идемпотентно: unique(payment_id, level).
 */
export async function rewardReferrer(paymentId: string): Promise<boolean> {
  const cfg = await getSettings('referral');
  if (!cfg.enabled) return false;
  const granted: Granted[] = [];

  await sql().begin(async (tx) => {
    const [p] = await tx<PaymentRow[]>`select * from payments where id = ${paymentId} and status = 'succeeded' and purpose = 'plan' and provider <> 'promo'`;
    if (!p || p.amount <= 0) return;
    const [referee] = await tx<UserRow[]>`select * from users where id = ${p.user_id}`;
    if (!referee?.referrer_id) return;
    const [l1] = await tx<UserRow[]>`select * from users where id = ${referee.referrer_id} for update`;
    if (!l1 || l1.status === 'banned') return;

    const [earlier] = await tx`select 1 from referral_rewards where referee_id = ${referee.id} and level = 1 and kind = 'payment' and payment_id <> ${p.id}`;
    const first = !earlier;
    const eligible = first || cfg.recurring;

    // уровень 1
    const ranks = await listRanks(tx);
    const paid = (await paidCount(tx, l1.id)) + (first ? 1 : 0);
    const rank = rankFor(ranks, paid);
    // режим награды выбирает сам пригласивший: дни ИЛИ деньги (если выбор включён), иначе — и то и другое
    const mode = cfg.choice_enabled ? l1.referral_mode : 'both';
    const pct = eligible && mode !== 'days' ? Math.min(100, cfg.percent + (rank?.percent ?? 0)) : 0;
    const days = first && mode !== 'balance' ? cfg.days + (rank?.extra_days ?? 0) : 0;
    const balance = Math.floor((p.amount * pct) / 100);
    const claimed = await tx`
      insert into referral_rewards (referrer_id, referee_id, payment_id, days, balance, level, kind)
      values (${l1.id}, ${referee.id}, ${p.id}, ${days}, ${balance}, 1, 'payment') on conflict (payment_id, level) where payment_id is not null do nothing returning 1`;
    if (claimed.length) {
      await pay(tx, l1.id, days, balance, p.id, 'Реферальное вознаграждение', cfg.choice_enabled);
      if (days || balance) granted.push({ userId: l1.id, level: 1, days, balance, ref: cfg.choice_enabled });
    }

    // уровень 2: тот, кто пригласил пригласившего. Дни — за первую оплату, процент — с оплаты (с каждой, если включено «recurring»);
    // что именно получает — по выбору самого человека (дни / деньги), при выключенном выборе — и то и другое
    if ((cfg.level2_percent > 0 || cfg.level2_days > 0) && l1.referrer_id) {
      const [l2] = await tx<UserRow[]>`select * from users where id = ${l1.referrer_id} for update`;
      if (l2 && l2.status !== 'banned') {
        const m2 = cfg.choice_enabled ? l2.referral_mode : 'both';
        const d2 = first && m2 !== 'balance' ? cfg.level2_days : 0;
        const b2 = eligible && m2 !== 'days' ? Math.floor((p.amount * cfg.level2_percent) / 100) : 0;
        if (d2 > 0 || b2 > 0) {
          const c2 = await tx`
            insert into referral_rewards (referrer_id, referee_id, payment_id, days, balance, level, kind)
            values (${l2.id}, ${referee.id}, ${p.id}, ${d2}, ${b2}, 2, 'payment') on conflict (payment_id, level) where payment_id is not null do nothing returning 1`;
          if (c2.length) {
            await pay(tx, l2.id, d2, b2, p.id, 'Вознаграждение 2 уровня', cfg.choice_enabled);
            granted.push({ userId: l2.id, level: 2, days: d2, balance: b2, ref: cfg.choice_enabled });
          }
        }
      }
    }
  });

  for (const g of granted) {
    const parts: string[] = [];
    if (g.days) parts.push(`+${g.days} ${pluralDays(g.days)} подписки`);
    if (g.balance) parts.push(`+${(g.balance / 100).toFixed(2)} ₽ ${g.ref ? 'на реферальный счёт' : 'на баланс'}`);
    const head = g.level === 1 ? '🎁 <b>Ваш друг оформил подписку!</b>' : '🎁 <b>Подписку оформил друг вашего друга!</b>';
    await notifyUser(g.userId, `${head}\nВам начислено: ${parts.join(' и ')}.`, [openAppButton()]).catch(() => {});
  }
  return granted.length > 0;
}

async function pay(tx: TxSql, userId: string, days: number, balance: number, paymentId: string | null, note: string, toRef = false) {
  if (days > 0) await grantAccess(tx, userId, { days });
  if (balance > 0 && toRef) {
    const [u] = await tx`update users set ref_balance = ref_balance + ${balance} where id = ${userId} returning ref_balance`;
    await tx`insert into ref_ledger (user_id, type, amount, balance_after, note) values (${userId}, 'reward', ${balance}, ${u!.ref_balance}, ${note})`;
  } else if (balance > 0) {
    const [u] = await tx`update users set balance = balance + ${balance} where id = ${userId} returning balance`;
    await tx`insert into transactions (user_id, type, amount, balance_after, payment_id, note) values (${userId}, 'referral', ${balance}, ${u!.balance}, ${paymentId}, ${note})`;
  }
}

/** Бонусы при регистрации по реферальной ссылке (на баланс) */
export async function giveSignupBonuses(user: UserRow): Promise<void> {
  const cfg = await getSettings('referral');
  if (!cfg.enabled || !user.referrer_id || user.signup_bonus_done) return;
  if (!cfg.signup_bonus_invitee && !cfg.signup_bonus_referrer) return;
  const done = await sql().begin(async (tx) => {
    const [u] = await tx`update users set signup_bonus_done = true where id = ${user.id} and signup_bonus_done = false returning id`;
    if (!u) return false;
    if (cfg.signup_bonus_invitee) {
      const [b] = await tx`update users set balance = balance + ${cfg.signup_bonus_invitee} where id = ${user.id} returning balance`;
      await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${user.id}, 'bonus', ${cfg.signup_bonus_invitee}, ${b!.balance}, 'Приветственный бонус')`;
    }
    if (cfg.signup_bonus_referrer) {
      const [b] = await tx`update users set balance = balance + ${cfg.signup_bonus_referrer} where id = ${user.referrer_id} returning balance`;
      await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${user.referrer_id}, 'bonus', ${cfg.signup_bonus_referrer}, ${b!.balance}, 'Друг зарегистрировался по вашей ссылке')`;
    }
    return true;
  });
  if (done) {
    if (cfg.signup_bonus_invitee) await notifyUser(user.id, `🎁 Приветственный бонус: <b>+${(cfg.signup_bonus_invitee / 100).toFixed(0)} ₽</b> на баланс.`, [openAppButton()]).catch(() => {});
    if (cfg.signup_bonus_referrer) await notifyUser(user.referrer_id, `👋 По вашей ссылке зарегистрировался друг. <b>+${(cfg.signup_bonus_referrer / 100).toFixed(0)} ₽</b> на баланс.`, [openAppButton()]).catch(() => {});
  }
}

export async function referralStats(user: UserRow) {
  const db = sql();
  const cfg = await getSettings('referral');
  const [a] = await db`select count(*)::int as invited from users where referrer_id = ${user.id}`;
  const [a2] = await db`select count(*)::int as n from users where referrer_id in (select id from users where referrer_id = ${user.id})`;
  const [b] = await db`
    select count(distinct referee_id) filter (where level = 1)::int as paid,
           coalesce(sum(days),0)::int as days,
           coalesce(sum(balance) filter (where level = 1),0)::bigint as bal1,
           coalesce(sum(balance) filter (where level = 2),0)::bigint as bal2
    from referral_rewards where referrer_id = ${user.id}`;
  const wcfg = await getSettings('withdraw');
  const [wallet] = await db`select ref_balance from users where id = ${user.id}`;
  const [pend] = await db`select coalesce(sum(amount),0)::bigint as n from withdrawals where user_id = ${user.id} and status = 'pending'`;
  const [paidOut] = await db`select coalesce(sum(amount),0)::bigint as n from withdrawals where user_id = ${user.id} and status = 'paid'`;
  const ranks = await listRanks();
  const paid = (b!.paid as number) ?? 0;
  const rank = rankFor(ranks, paid);
  const next = ranks.find((r) => r.min_paid > paid) ?? null;
  const partners = await db`select id, code, name, clicks, is_active from partner_links where owner_user_id = ${user.id} order by created_at`;
  const bot = config().BOT_USERNAME;
  const mk = (code: string) => ({ link: bot ? `https://t.me/${bot}?start=ref_${code}` : null, webLink: `${config().APP_URL}/?ref=${code}` });
  const plinks = [] as any[];
  for (const l of partners) {
    const [st] = await db`select count(*)::int as regs from users where partner_link_id = ${l.id}`;
    plinks.push({ id: l.id, name: l.name, code: l.code, clicks: l.clicks, registrations: st!.regs, active: l.is_active, ...mk(l.code) });
  }
  return {
    code: user.referral_code,
    ...mk(user.referral_code),
    enabled: cfg.enabled,
    invited: a!.invited as number,
    invitedLevel2: a2!.n as number,
    paid,
    earnedDays: b!.days as number,
    earnedBalance: Number(b!.bal1) + Number(b!.bal2),
    earnedLevel2: Number(b!.bal2),
    mode: cfg.choice_enabled ? user.referral_mode : ('both' as const),
    choiceEnabled: cfg.choice_enabled,
    refBalance: Number(wallet!.ref_balance),
    withdrawPending: Number(pend!.n),
    withdrawn: Number(paidOut!.n),
    withdraw: { enabled: wcfg.enabled, min: wcfg.min, feePercent: wcfg.fee_percent, transferBonusPercent: wcfg.transfer_bonus_percent, methods: wcfg.methods },
    rewardDays: cfg.days,
    rewardPercent: cfg.percent,
    level2Percent: cfg.level2_percent,
    level2Days: cfg.level2_days,
    recurring: cfg.recurring,
    signupBonus: cfg.signup_bonus_invitee,
    rank: rank ? { name: rank.name, percent: rank.percent, extraDays: rank.extra_days } : null,
    nextRank: next ? { name: next.name, minPaid: next.min_paid, left: next.min_paid - paid } : null,
    ranks: ranks.map((r) => ({ name: r.name, minPaid: r.min_paid, percent: r.percent, extraDays: r.extra_days })),
    partnerLinks: plinks,
  };
}

const nameOf = (u: { first_name: string | null; username: string | null }) => u.first_name || (u.username ? '@' + u.username : null) || 'Без имени';

export interface RefNode {
  id: string;
  name: string;
  username: string | null;
  tgId: number | null;
  joinedAt: string;
  sub: 'active' | 'trial' | 'expired' | 'none';
  paid: boolean;
  firstPaidAt: string | null;
  earnedBalance: number;
  earnedDays: number;
  invited: number;
  via?: { id: string; name: string } | null;
}

/** Реферальное дерево пользователя для админов: кто его пригласил, кого привёл он (1 и 2 уровень), сколько заработал. */
export async function referralTree(userId: string) {
  const db = sql();
  const [me] = await db`select u.id, u.first_name, u.username, u.tg_id, u.created_at, u.referral_code, u.referrer_id from users u where u.id = ${userId}`;
  if (!me) return null;
  const referrer = me.referrer_id
    ? (await db`select id, first_name, username, tg_id, created_at from users where id = ${me.referrer_id}`)[0] ?? null
    : null;
  const rows = await db`
    select x.id, x.first_name, x.username, x.tg_id, x.created_at, x.referrer_id,
      case when s.user_id is null then 'none' when s.expires_at <= now() then 'expired' when s.is_trial then 'trial' else 'active' end as sub,
      (select min(r.created_at) from referral_rewards r where r.referee_id = x.id and r.level = 1 and r.kind = 'payment') as first_paid_at,
      coalesce((select sum(r.balance) from referral_rewards r where r.referee_id = x.id and r.referrer_id = ${userId}), 0)::bigint as earned_balance,
      coalesce((select sum(r.days) from referral_rewards r where r.referee_id = x.id and r.referrer_id = ${userId}), 0)::int as earned_days,
      (select count(*)::int from users y where y.referrer_id = x.id) as invited
    from users x left join subscriptions s on s.user_id = x.id
    where x.referrer_id = ${userId} or x.referrer_id in (select id from users where referrer_id = ${userId})
    order by x.created_at desc limit 400`;
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const toNode = (r: any): RefNode => ({
    id: r.id, name: nameOf(r), username: r.username, tgId: r.tg_id, joinedAt: r.created_at.toISOString(), sub: r.sub,
    paid: Boolean(r.first_paid_at), firstPaidAt: r.first_paid_at ? r.first_paid_at.toISOString() : null,
    earnedBalance: Number(r.earned_balance), earnedDays: r.earned_days, invited: r.invited,
  });
  const level1 = rows.filter((r) => r.referrer_id === userId).map(toNode);
  const level2 = rows.filter((r) => r.referrer_id !== userId).map((r) => {
    const via = byId.get(r.referrer_id);
    return { ...toNode(r), via: via ? { id: via.id as string, name: nameOf(via as any) } : null };
  });
  const [tot] = await db`select coalesce(sum(balance),0)::bigint as b, coalesce(sum(days),0)::int as d from referral_rewards where referrer_id = ${userId}`;
  const [cnt] = await db`select count(*)::int as c1, (select count(*)::int from users where referrer_id in (select id from users where referrer_id = ${userId})) as c2 from users where referrer_id = ${userId}`;
  return {
    user: { id: me.id as string, name: nameOf(me as any), username: me.username as string | null, tgId: me.tg_id as number | null, joinedAt: me.created_at.toISOString(), code: me.referral_code as string },
    referrer: referrer ? { id: referrer.id as string, name: nameOf(referrer as any), username: referrer.username as string | null, tgId: referrer.tg_id as number | null, joinedAt: referrer.created_at.toISOString() } : null,
    totals: { level1: cnt!.c1 as number, level2: cnt!.c2 as number, paid: level1.filter((n) => n.paid).length, earnedBalance: Number(tot!.b), earnedDays: tot!.d as number },
    level1,
    level2,
  };
}

/** Лента последних регистраций по реферальным ссылкам: кто кого привёл и когда */
export async function referralFeed(limit = 50) {
  const rows = await sql()`
    select x.id, x.first_name, x.username, x.created_at, r.id as rid, r.first_name as rfn, r.username as run,
      case when s.user_id is null then 'none' when s.expires_at <= now() then 'expired' when s.is_trial then 'trial' else 'active' end as sub,
      exists (select 1 from referral_rewards w where w.referee_id = x.id and w.level = 1 and w.kind = 'payment') as paid
    from users x join users r on r.id = x.referrer_id left join subscriptions s on s.user_id = x.id
    order by x.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string, name: nameOf(r as any), username: r.username as string | null, joinedAt: (r.created_at as Date).toISOString(),
    sub: r.sub as string, paid: Boolean(r.paid),
    referrer: { id: r.rid as string, name: nameOf({ first_name: r.rfn as string | null, username: r.run as string | null }), username: r.run as string | null },
  }));
}


// ---------------------------------------------------------------- дерево для самого пользователя

/** Имя без лишних подробностей: приглашённый видит только имя; username частично скрыт (@al•••) */
function maskedName(u: { first_name: string | null; username: string | null }): { name: string; handle: string | null } {
  const handle = u.username ? '@' + u.username.slice(0, Math.min(2, Math.max(1, u.username.length - 1))) + '•••' : null;
  return { name: (u.first_name ?? '').trim().slice(0, 24) || handle || 'Без имени', handle };
}

export interface MyRefNode {
  id: string;
  name: string;
  handle: string | null;
  joinedAt: string;
  /** оплатил ли подписку и в каком состоянии подписка */
  paid: boolean;
  sub: 'active' | 'trial' | 'expired' | 'none';
  /** сколько получил от этого человека лично пользователь */
  earnedBalance: number;
  earnedDays: number;
  invited: number;
  children: MyRefNode[];
}

/** Дерево приглашённых для самого пользователя: 1 уровень (прямые) и под каждым — 2 уровень, с наградами за каждого */
export async function myReferralTree(user: UserRow) {
  const db = sql();
  const cfg = await getSettings('referral');
  const rows = await db`
    select x.id, x.first_name, x.username, x.created_at, x.referrer_id,
      case when s.user_id is null then 'none' when s.expires_at <= now() then 'expired' when s.is_trial then 'trial' else 'active' end as sub,
      exists (select 1 from referral_rewards r where r.referee_id = x.id and r.level = 1 and r.kind = 'payment') as paid,
      coalesce((select sum(r.balance) from referral_rewards r where r.referee_id = x.id and r.referrer_id = ${user.id}), 0)::bigint as earned_balance,
      coalesce((select sum(r.days) from referral_rewards r where r.referee_id = x.id and r.referrer_id = ${user.id}), 0)::int as earned_days,
      (select count(*)::int from users y where y.referrer_id = x.id) as invited
    from users x left join subscriptions s on s.user_id = x.id
    where x.referrer_id = ${user.id} or x.referrer_id in (select id from users where referrer_id = ${user.id})
    order by x.created_at desc limit 500`;
  const node = (r: any): MyRefNode => ({
    id: r.id, ...maskedName(r), joinedAt: r.created_at.toISOString(), paid: Boolean(r.paid), sub: r.sub,
    earnedBalance: Number(r.earned_balance), earnedDays: r.earned_days, invited: r.invited, children: [],
  });
  const l1 = rows.filter((r) => r.referrer_id === user.id).map(node);
  const byId = new Map(l1.map((n) => [n.id, n]));
  let l2count = 0;
  for (const r of rows) {
    if (r.referrer_id === user.id) continue;
    const parent = byId.get(r.referrer_id);
    if (parent) { parent.children.push(node(r)); l2count++; }
  }
  const [tot] = await db`select coalesce(sum(balance) filter (where level = 1),0)::bigint as b1, coalesce(sum(balance) filter (where level = 2),0)::bigint as b2,
    coalesce(sum(days) filter (where level = 1),0)::int as d1, coalesce(sum(days) filter (where level = 2),0)::int as d2 from referral_rewards where referrer_id = ${user.id}`;
  return {
    enabled: cfg.enabled,
    mode: cfg.choice_enabled ? user.referral_mode : ('both' as const),
    scheme: { days: cfg.days, percent: cfg.percent, level2Days: cfg.level2_days, level2Percent: cfg.level2_percent, recurring: cfg.recurring },
    totals: {
      level1: l1.length, level2: l2count, paid: l1.filter((n) => n.paid).length + l1.reduce((a, n) => a + n.children.filter((c) => c.paid).length, 0),
      earnedBalance: Number(tot!.b1) + Number(tot!.b2), earnedDays: (tot!.d1 as number) + (tot!.d2 as number),
      earnedBalanceL2: Number(tot!.b2), earnedDaysL2: tot!.d2 as number,
    },
    nodes: l1,
  };
}
