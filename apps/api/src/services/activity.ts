import { sql } from '../db/index.js';
import { log } from '../lib/log.js';
import { remnawave } from './remnawave.js';

export interface ActivityEvent {
  type: 'signup' | 'payment' | 'wheel' | 'quest';
  at: string;
  userId: string;
  name: string;
  detail: string;
  amount?: number;
}

/** Активность пользователей: онлайн сейчас, сколько заходило за период, динамика по дням, живая лента и последние визиты. */
export async function activityOverview() {
  const db = sql();
  const [a] = await db`
    select count(*) filter (where last_seen_at > now() - interval '1 hour')::int as h1,
      count(*) filter (where last_seen_at > now() - interval '1 day')::int as d1,
      count(*) filter (where last_seen_at > now() - interval '7 days')::int as d7,
      count(*) filter (where last_seen_at > now() - interval '30 days')::int as d30,
      count(*) filter (where created_at > now() - interval '1 day')::int as new1,
      count(*)::int as total
    from users`;
  const [paying] = await db`select count(distinct user_id)::int as n from payments where status = 'succeeded' and paid_at > now() - interval '30 days' and provider in ('yookassa','platega','rollypay')`;
  const [subs] = await db`select count(*)::int as n from subscriptions where expires_at > now()`;

  // онлайн в VPN прямо сейчас (по данным нод Remnawave); если панель недоступна — null
  let vpnOnline: number | null = null;
  try {
    const nodes = await remnawave.listNodes();
    vpnOnline = nodes.reduce((s, n) => s + (n.usersOnline ?? 0), 0);
  } catch (e) {
    log.warn('activity: нет данных онлайна из Remnawave', { error: String((e as Error).message ?? e) });
  }

  const series = await db`
    select to_char(d, 'YYYY-MM-DD') as day,
      (select count(*)::int from users u where date_trunc('day', u.created_at) = d) as signups,
      (select count(*)::int from payments p where p.status = 'succeeded' and p.provider in ('yookassa','platega','rollypay') and date_trunc('day', p.paid_at) = d) as payments,
      (select count(*)::int from wheel_spins w where date_trunc('day', w.created_at) = d)
        + (select count(*)::int from quest_claims c where date_trunc('day', c.claimed_at) = d) as engagement,
      (select count(*)::int from users u where date_trunc('day', u.last_seen_at) = d) as visitors
    from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
    order by d`;

  const nameSql = db`coalesce(nullif('@' || u.username, '@'), u.first_name, u.tg_id::text, 'пользователь')`;
  const events = await db<{ type: ActivityEvent['type']; at: Date; user_id: string; name: string; detail: string; amount: string | null }[]>`
    (select 'signup' as type, u.created_at as at, u.id as user_id, ${nameSql} as name, 'зарегистрировался' as detail, null::bigint as amount from users u order by u.created_at desc limit 30)
    union all
    (select 'payment', p.paid_at, u.id, ${nameSql}, case when p.purpose = 'topup' then 'пополнил баланс' else 'оплатил ' || coalesce(p.plan_name, 'тариф') end, p.amount
       from payments p join users u on u.id = p.user_id where p.status = 'succeeded' and p.paid_at is not null order by p.paid_at desc limit 30)
    union all
    (select 'wheel', w.created_at, u.id, ${nameSql}, 'крутил колесо: ' || w.prize_label, null from wheel_spins w join users u on u.id = w.user_id order by w.created_at desc limit 30)
    union all
    (select 'quest', c.claimed_at, u.id, ${nameSql}, 'выполнил задание «' || q.title || '»', null from quest_claims c join users u on u.id = c.user_id join quests q on q.id = c.quest_id order by c.claimed_at desc limit 30)
    order by at desc limit 40`;

  const recent = await db`
    select u.id, ${nameSql} as name, u.tg_id, u.last_seen_at, u.created_at, u.status,
      case when s.expires_at is null then 'none' when s.expires_at <= now() then 'expired' when s.is_trial then 'trial' else 'active' end as sub_state
    from users u left join subscriptions s on s.user_id = u.id
    order by u.last_seen_at desc limit 25`;

  return {
    summary: { online1h: a!.h1, active1d: a!.d1, active7d: a!.d7, active30d: a!.d30, new1d: a!.new1, total: a!.total, paying30d: paying!.n, activeSubs: subs!.n, vpnOnline },
    series: series.map((r) => ({ day: r.day as string, signups: r.signups as number, payments: r.payments as number, engagement: r.engagement as number, visitors: r.visitors as number })),
    events: events.map((e) => ({ type: e.type, at: e.at.toISOString(), userId: e.user_id, name: e.name, detail: e.detail, ...(e.amount !== null ? { amount: Number(e.amount) } : {}) })) satisfies ActivityEvent[],
    recent: recent.map((r) => ({ id: r.id as string, name: r.name as string, tgId: r.tg_id === null ? null : Number(r.tg_id), lastSeenAt: (r.last_seen_at as Date).toISOString(), createdAt: (r.created_at as Date).toISOString(), banned: r.status === 'banned', subState: r.sub_state as string })),
  };
}
