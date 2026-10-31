import { sql } from '../db/index.js';


export async function overview() {
  const db = sql();
  const real = db`provider in ('yookassa','platega','rollypay')`;
  const [u] = await db`
    select count(*)::int as total,
      count(*) filter (where created_at > now() - interval '1 day')::int as new_1d,
      count(*) filter (where created_at > now() - interval '7 days')::int as new_7d,
      count(*) filter (where created_at > now() - interval '30 days')::int as new_30d,
      count(*) filter (where bot_blocked)::int as blocked
    from users`;
  const [s] = await db`
    select count(*) filter (where expires_at > now() and not is_trial)::int as active,
      count(*) filter (where expires_at > now() and is_trial)::int as trial,
      count(*) filter (where expires_at > now() and expires_at < now() + interval '3 days')::int as expiring,
      count(*) filter (where expires_at <= now())::int as expired
    from subscriptions`;
  const [r] = await db`
    select coalesce(sum(amount) filter (where paid_at > date_trunc('day', now())), 0)::bigint as today,
      coalesce(sum(amount) filter (where paid_at > now() - interval '7 days'), 0)::bigint as d7,
      coalesce(sum(amount) filter (where paid_at > now() - interval '30 days'), 0)::bigint as d30,
      coalesce(sum(amount), 0)::bigint as total,
      count(*) filter (where paid_at > now() - interval '30 days')::int as count30
    from payments where status = 'succeeded' and ${real}`;
  const [pending] = await db`select count(*)::int as n from payments where status = 'pending' and created_at > now() - interval '1 day'`;
  const [unfulfilled] = await db`select count(*)::int as n from payments where status = 'succeeded' and fulfilled_at is null`;
  const [conv] = await db`
    select count(*) filter (where u.trial_used)::int as trials,
      count(*) filter (where u.trial_used and exists (select 1 from payments p where p.user_id = u.id and p.status = 'succeeded' and p.purpose = 'plan' and p.amount > 0))::int as converted
    from users u`;
  const revenueSeries = await db`
    select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(p.amount), 0)::bigint as amount
    from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
    left join payments p on date_trunc('day', p.paid_at) = d and p.status = 'succeeded' and ${db`p.provider in ('yookassa','platega','rollypay')`}
    group by d order by d`;
  const signupsSeries = await db`
    select to_char(d, 'YYYY-MM-DD') as day, count(u.id)::int as count
    from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
    left join users u on date_trunc('day', u.created_at) = d
    group by d order by d`;
  const byProvider = await db`
    select provider, coalesce(sum(amount),0)::bigint as amount, count(*)::int as count
    from payments where status = 'succeeded' and paid_at > now() - interval '30 days' and ${real}
    group by provider order by amount desc`;
  const topPlans = await db`
    select coalesce(plan_name, '—') as name, count(*)::int as count, coalesce(sum(amount),0)::bigint as amount
    from payments where status = 'succeeded' and purpose = 'plan' and paid_at > now() - interval '30 days'
    group by plan_name order by count desc limit 6`;
  return {
    users: u,
    subscriptions: s,
    revenue: { today: Number(r!.today), d7: Number(r!.d7), d30: Number(r!.d30), total: Number(r!.total), count30: r!.count30 },
    pendingPayments: pending!.n,
    unfulfilledPayments: unfulfilled!.n,
    trialConversion: conv!.trials ? Math.round((conv!.converted / conv!.trials) * 1000) / 10 : 0,
    revenueSeries: revenueSeries.map((x) => ({ day: x.day, amount: Number(x.amount) })),
    signupsSeries: signupsSeries.map((x) => ({ day: x.day, count: x.count })),
    byProvider: byProvider.map((x) => ({ provider: x.provider, amount: Number(x.amount), count: x.count })),
    topPlans: topPlans.map((x) => ({ name: x.name, count: x.count, amount: Number(x.amount) })),
  };
}
