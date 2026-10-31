import { sql } from '../db/index.js';
import { escapeHtml } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { sendTelegramMessage, type TgButton } from '../lib/telegram.js';
import { alertAdminsThrottled } from './alerts.js';
import { notifyUser } from './notify.js';
import { remnawave, rwErrorToHttp } from './remnawave.js';
import { getSettings } from './settings.js';
import { grantAccess } from './subscriptions.js';

export type Group = 'location' | 'bridge' | 'lte';
export const GROUP_TITLE: Record<Group, string> = { location: '🌍 Локации', bridge: '🔀 Мосты (вход из РФ)', lte: '🗽 LTE для белых списков' };
export type State = 'up' | 'down' | 'unknown';

export interface ServerRow { id: string; node_uuid: string; title: string; grp: Group; sort: number; visible: boolean; plan_ids: string[] | null }

const STATUS_BUTTON: TgButton[] = [{ text: '🌐 Статус серверов', callback_data: 'status' }];

/** Эмодзи-флаг по коду страны (RU → 🇷🇺) */
export function flagOf(cc?: string | null): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
export function guessGroup(name: string): Group {
  if (/lte/i.test(name)) return 'lte';
  if (/➜|->|→|мост|bridge/i.test(name)) return 'bridge';
  return 'location';
}
const hasFlag = (s: string) => /[\u{1F1E6}-\u{1F1FF}]{2}/u.test(s);

/** Подтягивает ноды из Remnawave: новые добавляются в список статуса (название и раздел админ потом правит). Ничего не удаляет. */
export async function syncStatusServers(): Promise<number> {
  const nodes = await remnawave.listNodes();
  let added = 0;
  for (const n of nodes) {
    const [max] = await sql()`select coalesce(max(sort), 0)::int as m from status_servers`;
    const title = hasFlag(n.name) ? n.name : `${flagOf(n.countryCode)} ${n.name}`;
    const r = await sql()`insert into status_servers (node_uuid, title, grp, sort) values (${n.uuid}, ${title.slice(0, 80)}, ${guessGroup(n.name)}, ${max!.m + 10}) on conflict (node_uuid) do nothing returning 1`;
    if (r.length) added++;
  }
  return added;
}

export interface StatusItem { id: string; title: string; status: State }
export interface StatusGroup { key: Group; title: string; items: StatusItem[] }
export interface StatusDTO {
  overall: 'ok' | 'partial' | 'down' | 'unknown';
  summary: string;
  groups: StatusGroup[];
  compensate: { enabled: boolean; hours: number; days: number };
  updatedAt: string | null;
}

async function liveStates(): Promise<{ states: Map<string, { status: State; since: Date }>; panelDown: boolean; checkedAt: Date | null }> {
  const rows = await sql()`select target, status, since, checked_at from monitor_state where target like 'node:%' or target = 'remnawave'`;
  const states = new Map<string, { status: State; since: Date }>();
  let panelDown = false;
  let checkedAt: Date | null = null;
  for (const r of rows) {
    if (r.target === 'remnawave') { panelDown = r.status === 'down'; continue; }
    states.set((r.target as string).slice(5), { status: r.status as State, since: r.since as Date });
    if (r.checked_at && (!checkedAt || (r.checked_at as Date) > checkedAt)) checkedAt = r.checked_at as Date;
  }
  return { states, panelDown, checkedAt };
}

const plural = (n: number, a: string, b: string, c: string) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);

/** Данные страницы «Статус серверов» для пользователей */
export async function statusView(): Promise<StatusDTO> {
  const cfg = await getSettings('statuspage');
  const servers = await sql()<ServerRow[]>`select * from status_servers where visible order by sort, title`;
  const { states, panelDown, checkedAt } = await liveStates();
  const stateOf = (s: ServerRow): State => (panelDown ? 'unknown' : states.get(s.node_uuid)?.status ?? 'unknown');
  const groups: StatusGroup[] = [];
  for (const key of ['location', 'bridge', 'lte'] as Group[]) {
    const items = servers.filter((s) => s.grp === key).map((s) => ({ id: s.id, title: s.title, status: stateOf(s) }));
    if (items.length) groups.push({ key, title: key === 'lte' ? `🗽 ${cfg.lte_note}` : GROUP_TITLE[key], items });
  }
  const part = (key: Group, ok: string, bad: (n: number, t: number) => string) => {
    const g = groups.find((x) => x.key === key);
    if (!g) return null;
    const down = g.items.filter((i) => i.status === 'down').length;
    return down ? bad(down, g.items.length) : g.items.some((i) => i.status === 'unknown') ? null : ok;
  };
  const loc = groups.find((g) => g.key === 'location');
  const locDown = loc ? loc.items.filter((i) => i.status === 'down').length : 0;
  const anyDown = groups.some((g) => g.items.some((i) => i.status === 'down'));
  const anyUnknown = groups.some((g) => g.items.some((i) => i.status === 'unknown'));
  const parts = [
    part('location', 'Все локации работают', (n, t) => `недоступно ${n} из ${t} локаций`),
    part('bridge', 'мосты работают', (n) => `${n} ${plural(n, 'мост недоступен', 'моста недоступны', 'мостов недоступны')}`),
    part('lte', 'LTE работает', (n) => `LTE: недоступно ${n}`),
  ].filter(Boolean) as string[];
  const overall: StatusDTO['overall'] = !groups.length || (panelDown && !anyDown) ? 'unknown' : loc && locDown === loc.items.length ? 'down' : anyDown ? 'partial' : anyUnknown ? 'unknown' : 'ok';
  const summary = panelDown ? 'Не удалось получить актуальные данные, проверяем' : parts.length ? parts.join(' · ').replace(/^./, (c) => c.toUpperCase()) : 'Данные обновляются';
  return { overall, summary, groups, compensate: { enabled: cfg.compensate, hours: cfg.compensate_after_hours, days: cfg.compensate_days }, updatedAt: checkedAt?.toISOString() ?? null };
}

// ---------------------------------------------------------------- Рассылка и компенсации

function audienceSql(s: ServerRow, onlyActiveSub: boolean, notifyAll: boolean) {
  const db = sql();
  const base = db`u.status = 'active' and u.tg_id is not null and not u.bot_blocked`;
  const plans = s.plan_ids?.length ? db`and sub.plan_id = any(${s.plan_ids}::uuid[])` : db``;
  if (!onlyActiveSub && notifyAll && !s.plan_ids?.length) return base;
  return db`${base} and exists (select 1 from subscriptions sub where sub.user_id = u.id and sub.expires_at > now() ${plans})`;
}

async function sendToAudience(s: ServerRow, text: string, notifyAll: boolean): Promise<number> {
  const users = await sql()<{ id: string; tg_id: number }[]>`select u.id, u.tg_id from users u where ${audienceSql(s, false, notifyAll)} order by u.created_at limit 20000`;
  let sent = 0;
  for (const u of users) {
    const r = await sendTelegramMessage(u.tg_id, text, [STATUS_BUTTON]);
    if (r.ok) sent++;
    else if (r.blocked) await sql()`update users set bot_blocked = true where id = ${u.id}`;
    await new Promise((res) => setTimeout(res, 45)); // ~22 сообщения в секунду, лимит Telegram — 30
  }
  return sent;
}

const downText = (title: string, othersUp: boolean) =>
  `🔴 <b>Сервер ${escapeHtml(title)} недоступен</b>\n\nМы уже знаем о проблеме, ведутся технические работы.${othersUp ? ' Остальные локации работают — пока можно выбрать другую в приложении.' : ''}\n\nСообщим, когда всё заработает.`;
const upText = (title: string) => `🟢 <b>Сервер ${escapeHtml(title)} снова работает</b>\n\nСпасибо за терпение!`;

const running = new Set<string>();

/** Продление подписок за затянувшийся простой. Идемпотентно: один человек получает компенсацию за простой один раз и не чаще раза в сутки. */
export async function runCompensation(outageId: string): Promise<void> {
  if (running.has(outageId)) return;
  running.add(outageId);
  try {
    const [o] = await sql()`select o.*, s.id as sid from status_outages o join status_servers s on s.id = o.server_id where o.id = ${outageId}`;
    if (!o || o.comp_done) return;
    const [s] = await sql()<ServerRow[]>`select * from status_servers where id = ${o.server_id}`;
    if (!s) return;
    const days = o.comp_days as number;
    const users = await sql()<{ id: string }[]>`
      select u.id from users u where ${audienceSql(s, true, false)}
        and not exists (select 1 from status_compensations c where c.user_id = u.id and (c.outage_id = ${outageId} or c.at > now() - interval '24 hours'))
        order by u.created_at limit 20000`;
    for (const u of users) {
      try {
        const ok = await sql().begin(async (tx) => {
          const ins = await tx`insert into status_compensations (outage_id, user_id) values (${outageId}, ${u.id}) on conflict do nothing returning 1`;
          if (!ins.length) return false;
          await grantAccess(tx, u.id, { days });
          return true;
        }).catch(rwErrorToHttp);
        if (ok) {
          await sql()`update status_outages set comp_users = comp_users + 1 where id = ${outageId}`;
          void notifyUser(u.id, `🛡 <b>Компенсируем простой</b>\n\nСервер ${escapeHtml(o.title as string)} был недоступен дольше ${Math.floor((Date.now() - (o.started_at as Date).getTime()) / 3600_000)} ч. Мы сами продлили ваш VPN на <b>${days} ${plural(days, 'день', 'дня', 'дней')}</b> — заявок в поддержку не нужно. Извините за неудобства!`).catch(() => {});
          await new Promise((res) => setTimeout(res, 45));
        }
      } catch (e) {
        await sql()`update status_outages set comp_failed = comp_failed + 1 where id = ${outageId}`;
        log.warn('status compensation failed', { err: (e as Error).message, outage: outageId, user: u.id });
      }
    }
    await sql()`update status_outages set comp_done = true where id = ${outageId}`;
    void alertAdminsThrottled(`status-comp:${outageId}`, `🛡 <b>Компенсация за простой</b>: ${escapeHtml(o.title as string)}\nПродлено подписок: ${(await sql()`select comp_users from status_outages where id = ${outageId}`)[0]!.comp_users} (+${days} дн.)`, 60);
  } finally {
    running.delete(outageId);
  }
}

/** Раз в минуту: открывает и закрывает простои, рассылает оповещения, начисляет компенсацию */
export async function statusTick(): Promise<number> {
  const cfg = await getSettings('statuspage');
  if (!cfg.enabled) return 0;
  const servers = await sql()<ServerRow[]>`select * from status_servers where visible`;
  const { states, panelDown } = await liveStates();
  let actions = 0;
  for (const s of servers) {
    const st = states.get(s.node_uuid);
    const [open] = await sql()`select * from status_outages where server_id = ${s.id} and resolved_at is null`;
    if (st?.status === 'down' && !panelDown) {
      let o = open;
      if (!o) [o] = await sql()`insert into status_outages (server_id, title, started_at) values (${s.id}, ${s.title}, ${st.since}) returning *`;
      const mins = (Date.now() - (o!.started_at as Date).getTime()) / 60_000;
      if (cfg.notify_users && !o!.notified_at && mins >= cfg.notify_after_minutes) {
        const claimed = await sql()`update status_outages set notified_at = now() where id = ${o!.id} and notified_at is null returning 1`;
        if (claimed.length) {
          actions++;
          const othersUp = servers.some((x) => x.id !== s.id && x.grp === 'location' && states.get(x.node_uuid)?.status === 'up');
          void sendToAudience(s, downText(s.title, othersUp), cfg.notify_audience === 'all')
            .then((n) => sql()`update status_outages set notified_count = ${n} where id = ${o!.id}`)
            .catch((e) => log.error('status notify failed', { err: String(e) }));
        }
      }
      const hours = (Date.now() - (o!.started_at as Date).getTime()) / 3600_000;
      if (cfg.compensate && !o!.compensated_at && hours >= cfg.compensate_after_hours) {
        const claimed = await sql()`update status_outages set compensated_at = now(), comp_days = ${cfg.compensate_days} where id = ${o!.id} and compensated_at is null returning 1`;
        if (claimed.length) actions++;
      }
    } else if (st?.status === 'up' && open) {
      await sql()`update status_outages set resolved_at = now() where id = ${open.id}`;
      actions++;
      if (cfg.notify_users && cfg.notify_recovery && open.notified_at && !open.recovery_sent_at) {
        await sql()`update status_outages set recovery_sent_at = now() where id = ${open.id}`;
        void sendToAudience(s, upText(s.title), cfg.notify_audience === 'all').catch((e) => log.error('status recovery notify failed', { err: String(e) }));
      }
    }
  }
  // начатые, но не законченные компенсации (в том числе после перезапуска воркера)
  const pending = await sql()`select id from status_outages where compensated_at is not null and not comp_done`;
  for (const p of pending) void runCompensation(p.id as string).catch((e) => log.error('status compensation run failed', { err: String(e) }));
  return actions;
}

export async function recentOutages(limit = 30) {
  const rows = await sql()`select * from status_outages order by started_at desc limit ${limit}`;
  return rows.map((o) => ({ id: o.id as string, title: o.title as string, startedAt: (o.started_at as Date).toISOString(), resolvedAt: (o.resolved_at as Date | null)?.toISOString() ?? null, notifiedCount: o.notified_count as number, compensated: Boolean(o.compensated_at), compDays: o.comp_days as number, compUsers: o.comp_users as number, compFailed: o.comp_failed as number, compDone: o.comp_done as boolean }));
}
