import { sql } from '../db/index.js';

export interface Period { from: Date; to: Date }

/** Выручка по платежам (источник истины). Суммы в копейках, по каждой валюте отдельно. fees недоступны → null. */
export async function revenue(p: Period, granularity: 'day' | 'month' = 'day') {
  const rows = await sql()`
    select date_trunc(${granularity}, coalesce(paid_at, created_at)) as bucket, currency,
           coalesce(sum(amount) filter (where status in ('succeeded','refunded') and amount > 0), 0)::bigint as gross,
           coalesce(sum(amount) filter (where status = 'refunded'), 0)::bigint as refunds,
           count(*) filter (where status = 'succeeded' and amount > 0)::int as payments,
           count(distinct user_id) filter (where status in ('succeeded','refunded') and amount > 0)::int as payers
    from payments where coalesce(paid_at, created_at) >= ${p.from} and coalesce(paid_at, created_at) < ${p.to} and (status in ('succeeded','refunded'))
    group by 1, 2 order by 1, 2`;
  const series = rows.map((r) => ({ bucket: (r.bucket as Date).toISOString(), currency: r.currency as string, gross: Number(r.gross), refunds: Number(r.refunds), net: Number(r.gross) - Number(r.refunds), payments: r.payments as number, payers: r.payers as number }));
  const totals: Record<string, { gross: number; refunds: number; net: number; fees: null }> = {};
  for (const s of series) {
    const t = (totals[s.currency] ??= { gross: 0, refunds: 0, net: 0, fees: null });
    t.gross += s.gross; t.refunds += s.refunds; t.net += s.net;
  }
  const [payers] = await sql()`select count(distinct user_id)::int as n from payments where status = 'succeeded' and amount > 0 and paid_at >= ${p.from} and paid_at < ${p.to}`;
  const arppu: Record<string, number | null> = {};
  for (const [cur, t] of Object.entries(totals)) arppu[cur] = payers!.n ? Math.round(t.net / (payers!.n as number)) : null;
  return { period: { from: p.from.toISOString(), to: p.to.toISOString() }, granularity, series, totals, payingUsers: payers!.n as number, arppu, definitions: { gross: 'сумма подтверждённых платежей за период до возвратов', net: 'gross минус возвраты; комиссии провайдеров не учтены', arppu: 'net / число платящих в периоде', unit: 'копейки' }, dataAsOf: new Date().toISOString() };
}

/** MRR — оценка: последний оплаченный тариф каждой активной платной подписки, приведённый к 30 дням. Не бухгалтерская выручка. */
export async function mrrEstimate() {
  const rows = await sql()`
    select p.currency, round(sum(p.amount::numeric * 30 / greatest(pl.duration_days, 1)))::bigint as mrr, count(*)::int as subs
    from subscriptions s
    join lateral (select amount, currency, plan_id from payments where user_id = s.user_id and status = 'succeeded' and purpose = 'plan' and amount > 0 order by paid_at desc limit 1) p on true
    join plans pl on pl.id = p.plan_id
    where s.expires_at > now() and not s.is_trial group by p.currency`;
  return { estimate: true, byCurrency: Object.fromEntries(rows.map((r) => [r.currency as string, { mrr: Number(r.mrr), subscriptions: r.subs as number }])) };
}

export async function funnel(p: Period, campaign?: string) {
  const ev = async (name: string) => {
    const [r] = await sql()`select count(distinct coalesce(user_id::text, session_id))::int as n from product_events where event_name = ${name} and occurred_at >= ${p.from} and occurred_at < ${p.to} ${campaign ? sql()`and campaign_id = ${campaign}` : sql()``}`;
    return r!.n as number;
  };
  const cnt = async (q: Promise<{ n: number }[]>) => (await q)[0]!.n as number;
  const stages = [
    { stage: 'bot_start', users: await ev('bot_start'), source: 'events' },
    { stage: 'miniapp_open', users: await ev('miniapp_open'), source: 'events' },
    { stage: 'trial_started', users: await cnt(sql()`select count(*)::int as n from subscriptions where is_trial and started_at >= ${p.from} and started_at < ${p.to}` as any), source: 'subscriptions' },
    { stage: 'checkout_started', users: await cnt(sql()`select count(distinct user_id)::int as n from payments where purpose in ('plan','addon') and created_at >= ${p.from} and created_at < ${p.to}` as any), source: 'payments' },
    { stage: 'payment_succeeded', users: await cnt(sql()`select count(distinct user_id)::int as n from payments where status = 'succeeded' and amount > 0 and paid_at >= ${p.from} and paid_at < ${p.to}` as any), source: 'payments' },
    { stage: 'access_fulfilled', users: await cnt(sql()`select count(distinct user_id)::int as n from payments where status = 'succeeded' and amount > 0 and fulfilled_at is not null and paid_at >= ${p.from} and paid_at < ${p.to}` as any), source: 'payments' },
    { stage: 'renewed', users: await cnt(sql()`select count(*)::int as n from (select user_id from payments where status = 'succeeded' and purpose = 'plan' and amount > 0 group by user_id having count(*) >= 2 and max(paid_at) >= ${p.from} and max(paid_at) < ${p.to}) t` as any), source: 'payments' },
  ];
  return { period: { from: p.from.toISOString(), to: p.to.toISOString() }, stages, note: 'Стадии считаются независимо по разным источникам; это не строгая воронка одной когорты. Источник «events» — только если включена аналитика событий.', dataAsOf: new Date().toISOString() };
}

/** Когорты по месяцу первой оплаты тарифа; retention — доля когорты с оплатой в месяце k (UTC). */
export async function cohorts(months = 6) {
  const rows = await sql()`
    with first as (select user_id, date_trunc('month', min(paid_at)) as m from payments where status = 'succeeded' and purpose = 'plan' and amount > 0 group by user_id),
    pay as (select distinct user_id, date_trunc('month', paid_at) as pm from payments where status = 'succeeded' and purpose = 'plan' and amount > 0)
    select f.m, (extract(year from age(p.pm, f.m)) * 12 + extract(month from age(p.pm, f.m)))::int as k, count(*)::int as n,
           (select count(*) from first f2 where f2.m = f.m)::int as size
    from first f join pay p using (user_id)
    where f.m >= date_trunc('month', now()) - make_interval(months => ${months}) group by f.m, k order by f.m, k`;
  const map = new Map<string, { cohort: string; size: number; retention: (number | null)[] }>();
  for (const r of rows) {
    const key = (r.m as Date).toISOString().slice(0, 7);
    const c = map.get(key) ?? { cohort: key, size: r.size as number, retention: Array(months + 1).fill(null) };
    if ((r.k as number) <= months) c.retention[r.k as number] = Math.round((1000 * (r.n as number)) / c.size) / 10;
    map.set(key, c);
  }
  return { method: 'доля пользователей когорты (первая оплата тарифа), оплативших в месяце k; null — месяц ещё не наступил или нет данных', cohorts: [...map.values()], dataAsOf: new Date().toISOString() };
}
