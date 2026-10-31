import type { LteActivityDTO, LteActivityHistoryDTO, LteActivityUserDTO } from '@vpn/shared';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { lteDb, lteEnabled } from './lte.js';
import { rwUsernameFor } from './subscriptions.js';

export const LTE_ACTIVE_SECONDS = 300;
export interface LteActivityQuery { days: number; page: number; limit: number; q: string; mode: 'active' | 'history' }
const iso = (value: unknown): string | null => value ? new Date(String(value)).toISOString() : null;
const pattern = (q: string) => '%' + q.replace(/[\\%_]/g, '\\$&') + '%';

async function context(days: number) {
  const db = lteDb();
  const [[clock], columns] = await Promise.all([
    db`select (now() at time zone 'UTC')::date::text as today,
       greatest((now() at time zone 'UTC')::date - ${days - 1}::int,${config().LTE_ACTIVITY_START_DATE}::date)::text as first_day`,
    db`select data_type from information_schema.columns where table_schema='public'
       and table_name='nodes_user_usage_history' and column_name='updated_at'`,
  ]);
  const type = columns[0]?.data_type;
  // Prisma stores updated_at without an offset, in UTC. Older schemas can lack it entirely.
  const seen = !type ? db`null::timestamptz`
    : type === 'timestamp without time zone' ? db`h.updated_at at time zone 'UTC'` : db`h.updated_at`;
  return { db, seen, from: String(clock.first_day), to: String(clock.today), precision: type ? 'updated-at' as const : 'day' as const };
}

async function searchProfiles(search: string) {
  if (!search) return [];
  const db = sql(), like = pattern(search);
  return db<Pick<UserRow, 'id' | 'tg_id' | 'rw_id' | 'rw_username'>[]>`
    select id,tg_id,rw_id,rw_username from users where username ilike ${like}
    or first_name ilike ${like} or tg_id::text=${search} or id::text=${search}`;
}

/** One bounded, indexed node/day scan; no per-user HTTP requests or updates in Remnawave. */
async function report(query: LteActivityQuery, rwId?: number) {
  const c = await context(query.days), { db, seen, from, to } = c;
  const search = query.q.trim().replace(/^@/, '');
  const matches = await searchProfiles(search);
  const ids = matches.filter(u => u.rw_id != null).map(u => String(u.rw_id));
  const names = matches.filter(u => u.rw_id == null).map(u => u.rw_username ?? rwUsernameFor(u));
  const searchWhere = search ? db`(u.username ilike ${pattern(search)} or u.id::text=${search}
    or u.id=any(${ids}::bigint[]) or u.username=any(${names}::text[]))` : db`true`;
  const active = c.precision === 'updated-at'
    ? db`a.last_seen_at>=now()-${LTE_ACTIVE_SECONDS}*interval '1 second' and a.last_seen_at<=now()+interval '30 seconds'`
    : db`null::boolean`;
  const rows = await db`
    with usage as (
      select h.user_id,
        coalesce(sum(h.total_bytes) filter(where h.created_at::date between ${from}::date and ${to}::date),0) as period_bytes,
        count(distinct h.created_at::date) filter(where h.created_at::date between ${from}::date and ${to}::date)::int as days_used,
        max(h.created_at::date) filter(where h.created_at::date between ${from}::date and ${to}::date)::text as last_usage_day,
        max(${seen}) as last_seen_at,
        coalesce(sum(h.total_bytes) filter(where h.created_at>=greatest(date '2026-10-26',${to}::date-29)),0) as used_bytes
      from nodes_user_usage_history h where h.node_id=${config().LTE_NODE_ID} and h.total_bytes>0
        and h.created_at>=${config().LTE_ACTIVITY_START_DATE}::date
        and h.created_at>=least(${from}::date,${to}::date-29) and h.created_at<${to}::date+1
        ${rwId !== undefined ? db`and h.user_id=${rwId}` : db``}
      group by h.user_id
    ), report as (
      select u.id,u.username,u.status,a.*,(${active}) as active from usage a join users u on u.id=a.user_id
      where ${searchWhere}
    ), visible as (
      select * from report where ${query.mode === 'active' ? db`active is true` : db`period_bytes>0`}
    ), selected as (
      select * from visible order by active desc nulls last,last_seen_at desc nulls last,last_usage_day desc,id
      limit ${query.limit} offset ${(query.page - 1) * query.limit}
    ), enriched as (
      select s.*,
        coalesce((select sum(x.bytes) from vaylo_lte_extra x where x.user_id=s.id and x.granted_on>=${to}::date-29),0) as extra_bytes,
        exists(select 1 from internal_squad_members m join internal_squads g on g.uuid=m.internal_squad_uuid
          where m.user_id=s.id and g.name='LTE') as in_squad
      from selected s
    )
    select json_build_object(
      'stats',json_build_object('activeUsers',${c.precision === 'updated-at' ? db`(select count(*)::int from report where active is true)` : db`null::int`},
        'periodUsers',(select count(*)::int from report where period_bytes>0),
        'periodBytes',coalesce((select sum(period_bytes)::text from report),'0')),
      'total',(select count(*)::int from visible),
      'items',coalesce((select json_agg(e order by active desc nulls last,last_seen_at desc nulls last,last_usage_day desc,id) from enriched e),'[]'::json)
    ) as result`;
  return { ...c, result: rows[0].result as { stats: { activeUsers: number | null; periodUsers: number; periodBytes: string }; total: number; items: Record<string, any>[] } };
}

async function attachLocal(rows: Record<string, any>[]): Promise<LteActivityUserDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => String(r.id)), names = rows.map(r => String(r.username));
  const users = await sql()<UserRow[]>`select id,tg_id,first_name,username,rw_id,rw_username from users
    where rw_id=any(${ids}::bigint[]) or (rw_id is null and
      coalesce(rw_username,case when tg_id is not null then 'tg_'||tg_id::text else 'u_'||left(replace(id::text,'-',''),12) end)=any(${names}::text[]))`;
  return rows.map(r => {
    const local = users.find(u => u.rw_id != null && String(u.rw_id) === String(r.id))
      ?? users.find(u => u.rw_id == null && (u.rw_username ?? rwUsernameFor(u)) === r.username);
    const limit = 5 * 1024 ** 3 + Number(r.extra_bytes);
    return {
      id: Number(r.id), rwId: Number(r.id), rwUsername: String(r.username), localUserId: local?.id ?? null,
      name: local?.first_name ?? null, username: local?.username ?? null, tgId: local?.tg_id ?? null,
      active: r.active == null ? null : Boolean(r.active), lastSeenAt: iso(r.last_seen_at), lastUsageDay: r.last_usage_day,
      periodBytes: Number(r.period_bytes), daysUsed: Number(r.days_used), usedBytes: Number(r.used_bytes),
      limitBytes: limit, remainingBytes: Math.max(0, limit - Number(r.used_bytes)), inSquad: Boolean(r.in_squad), remoteStatus: String(r.status),
    };
  });
}

export async function lteActivity(query: LteActivityQuery): Promise<LteActivityDTO> {
  const base = { state: 'disabled' as const, checkedAt: null, precision: 'day' as const,
    nodeId: config().LTE_NODE_ID, activeWindowSeconds: LTE_ACTIVE_SECONDS,
    from: null, to: null, page: query.page, limit: query.limit, total: 0, stats: null, items: [] };
  if (!lteEnabled()) return base;
  try {
    const r = await report(query);
    return { ...base, state: 'ready', checkedAt: new Date().toISOString(), precision: r.precision, from: r.from, to: r.to,
      stats: { ...r.result.stats, periodBytes: Number(r.result.stats.periodBytes) }, total: r.result.total, items: await attachLocal(r.result.items) };
  } catch {
    return { ...base, state: 'unavailable' };
  }
}

export async function lteActivityHistory(rwId: number, query: Pick<LteActivityQuery, 'days' | 'page' | 'limit'>): Promise<LteActivityHistoryDTO> {
  const base = { state: 'disabled' as const, checkedAt: null, precision: 'day' as const, nodeId: config().LTE_NODE_ID,
    from: null, to: null, user: null, page: query.page, limit: query.limit, total: 0, items: [] };
  if (!lteEnabled()) return base;
  try {
    const r = await report({ ...query, page: 1, limit: 1, q: '', mode: 'history' }, rwId);
    const { db, seen } = r;
    const [count] = await db`select count(distinct created_at::date)::int as total from nodes_user_usage_history
      where node_id=${config().LTE_NODE_ID} and user_id=${rwId} and total_bytes>0
        and created_at>=${r.from}::date and created_at<${r.to}::date+1`;
    const rows = await db`select h.created_at::date::text as day,sum(h.total_bytes)::text as bytes,max(${seen}) as last_seen_at
      from nodes_user_usage_history h where h.node_id=${config().LTE_NODE_ID} and h.user_id=${rwId} and h.total_bytes>0
        and h.created_at>=${r.from}::date and h.created_at<${r.to}::date+1
      group by h.created_at::date order by h.created_at::date desc limit ${query.limit} offset ${(query.page - 1) * query.limit}`;
    const [user] = await attachLocal(r.result.items);
    return { ...base, state: 'ready', precision: r.precision, checkedAt: new Date().toISOString(), from: r.from, to: r.to,
      user: user ?? null, total: Number(count.total), items: rows.map(v => ({ day: String(v.day), bytes: Number(v.bytes), lastSeenAt: iso(v.last_seen_at) })) };
  } catch {
    return { ...base, state: 'unavailable' };
  }
}
