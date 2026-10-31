import { config } from '../config.js';
import { sql } from '../db/index.js';
import { escapeHtml } from '../lib/errors.js';
import { alertAdminsThrottled } from './alerts.js';
import { notifyUser, openAppButton } from './notify.js';
import { OPERATOR_LABEL, type Operator } from './netprobe.js';

export type IncidentState = 'suspected' | 'confirmed' | 'recovering' | 'resolved';
export interface Sample { ok: boolean; probe: string; at: number }

export const INCIDENT_RULES = { windowMin: 30, minFailures: 3, confirmProbes: 2, recoverSuccesses: 2, resolveSuccesses: 4 };

/**
 * Машина состояний инцидента по замерам РЕАЛЬНОГО Xray (newest first).
 * Нет замеров ≠ успех: без свежих данных состояние не меняется.
 * Подтверждение (confirmed) — только при отказах минимум от двух разных проб; одна проба остаётся suspected.
 */
export function nextState(current: IncidentState | null, samples: Sample[], rules = INCIDENT_RULES): IncidentState | null {
  if (!samples.length) return current === 'resolved' ? null : current;
  let cs = 0;
  for (const s of samples) { if (!s.ok) break; cs++; }
  const fails = samples.filter((s) => !s.ok);
  const failProbes = new Set(fails.map((s) => s.probe)).size;
  const open = current && current !== 'resolved' ? current : null;
  if (!open) return cs === 0 && fails.length >= rules.minFailures ? (failProbes >= rules.confirmProbes ? 'confirmed' : 'suspected') : null;
  if (open === 'recovering') {
    if (cs >= rules.resolveSuccesses) return 'resolved';
    if (cs === 0) return fails.length >= rules.minFailures && failProbes >= rules.confirmProbes ? 'confirmed' : 'suspected';
    return 'recovering';
  }
  if (cs >= rules.recoverSuccesses) return 'recovering';
  if (open === 'suspected' && cs === 0 && fails.length >= rules.minFailures && failProbes >= rules.confirmProbes) return 'confirmed';
  return open;
}

const severityOf = (s: IncidentState) => (s === 'confirmed' ? 'high' : s === 'recovering' ? 'low' : 'medium');

/** Раз в несколько минут. Работает только за флагом NETWORK_INTELLIGENCE_ENABLED. */
export async function incidentTick(): Promise<number> {
  if (!config().NETWORK_INTELLIGENCE_ENABLED) return 0;
  const win = INCIDENT_RULES.windowMin;
  const scopes = await sql()`select distinct target, operator from net_probes where source = 'probe' and evidence = 'real_xray_probe' and at > now() - make_interval(mins => ${win * 4})`;
  const openRows = await sql()`select target, operator from network_incidents where state <> 'resolved'`;
  const all = new Map<string, { target: string; operator: string }>();
  for (const r of [...scopes, ...openRows]) all.set(`${r.target}|${r.operator}`, { target: r.target as string, operator: r.operator as string });
  let changes = 0;
  for (const [hash, sc] of all) {
    const rows = await sql()`select ok, coalesce(probe_id::text, probe_name, 'unknown') as probe, at from net_probes
      where source = 'probe' and evidence = 'real_xray_probe' and target = ${sc.target} and operator = ${sc.operator} and at > now() - make_interval(mins => ${win})
      order by at desc limit 50`;
    const samples: Sample[] = rows.map((r) => ({ ok: r.ok as boolean, probe: r.probe as string, at: (r.at as Date).getTime() }));
    const [cur] = await sql()`select id, state, alerted_at from network_incidents where scope_hash = ${hash} and state <> 'resolved'`;
    const from = (cur?.state as IncidentState | undefined) ?? null;
    const to = nextState(from, samples);
    if (to === from) { if (cur) await sql()`update network_incidents set evidence_count = ${samples.length}, updated_at = now() where id = ${cur.id}`; continue; }
    changes++;
    const summary = `${samples.filter((s) => !s.ok).length} отказов из ${samples.length} за ${win} мин`;
    let id = cur?.id as string | undefined;
    if (!cur && to) {
      const [n] = await sql()`insert into network_incidents (scope_hash, target, operator, state, severity, evidence_count) values (${hash}, ${sc.target}, ${sc.operator}, ${to}, ${severityOf(to)}, ${samples.length}) returning id`;
      id = n!.id as string;
    } else if (cur && to) {
      await sql()`update network_incidents set state = ${to}, severity = ${severityOf(to)}, evidence_count = ${samples.length}, updated_at = now(), ended_at = ${to === 'resolved' ? new Date() : null} where id = ${cur.id}`;
    }
    if (!id || !to) continue;
    await sql()`insert into incident_events (incident_id, transition, summary) values (${id}, ${(from ?? 'none') + '→' + to}, ${summary})`;
    if (to === 'confirmed') void noticeUsers(id, 'down').catch(() => undefined);
    if (to === 'resolved') void noticeUsers(id, 'up').catch(() => undefined);
    if (config().NETWORK_INCIDENT_ALERTS_ENABLED && (to === 'confirmed' || to === 'resolved')) {
      const label = `<code>${escapeHtml(sc.target)}</code> · ${escapeHtml(sc.operator)}`;
      void alertAdminsThrottled(`incident:${hash}:${to}`, to === 'confirmed' ? `🔴 <b>Подтверждён сбой доступа по ключу</b>\n${label}\n${summary}` : `🟢 <b>Доступ по ключу восстановлен</b>\n${label}`, 1800);
    }
  }
  return changes;
}

export async function listIncidents(state: 'active' | 'all' = 'active') {
  const rows = state === 'active'
    ? await sql()`select * from network_incidents where state <> 'resolved' order by started_at desc limit 100`
    : await sql()`select * from network_incidents order by started_at desc limit 100`;
  return rows.map(incOut);
}
const incOut = (r: Record<string, any>) => ({ id: r.id as string, target: r.target as string, operator: r.operator as string, state: r.state as IncidentState, severity: r.severity as string, startedAt: (r.started_at as Date).toISOString(), endedAt: (r.ended_at as Date | null)?.toISOString() ?? null, evidenceCount: r.evidence_count as number, updatedAt: (r.updated_at as Date).toISOString() });

export async function incidentDetail(id: string) {
  const [i] = await sql()`select * from network_incidents where id = ${id}`;
  if (!i) return null;
  const ev = await sql()`select at, transition, summary, author_type, note from incident_events where incident_id = ${id} order by at`;
  const samples = await sql()`select at, ok, ms, detail, coalesce(probe_name, 'unknown') as probe from net_probes where source = 'probe' and target = ${i.target} and operator = ${i.operator} and at > ${i.started_at as Date}::timestamptz - interval '1 hour' order by at desc limit 50`;
  return {
    ...incOut(i),
    events: ev.map((e) => ({ at: (e.at as Date).toISOString(), transition: e.transition as string, summary: e.summary as string, author: e.author_type as string, note: e.note as string | null })),
    evidence: samples.map((s) => ({ at: (s.at as Date).toISOString(), ok: s.ok as boolean, ms: s.ms as number | null, probe: s.probe as string, detail: s.detail as string | null })),
  };
}

/** Ручное подтверждение администратором: suspected → confirmed (с записью автора). */
export async function ackIncident(id: string, note: string): Promise<boolean> {
  const [i] = await sql()`update network_incidents set state = 'confirmed', severity = 'high', updated_at = now() where id = ${id} and state in ('suspected','recovering') returning id`;
  if (!i) return false;
  await sql()`insert into incident_events (incident_id, transition, summary, author_type, note) values (${id}, 'manual→confirmed', 'Подтверждено администратором', 'admin', ${note.slice(0, 300) || null})`;
  return true;
}

/**
 * Сообщение пользователям бота, у которых за последние 7 дней были замеры из сети этого оператора (клиентские замеры Mini App),
 * когда сбой подтверждён, и когда он устранён. Один раз на инцидент. Флаг NETWORK_USER_NOTICES_ENABLED.
 */
export async function noticeUsers(incidentId: string, kind: 'down' | 'up'): Promise<number> {
  if (!config().NETWORK_USER_NOTICES_ENABLED) return 0;
  const [i] = await sql()`select id, target, operator, users_notified_at, recovery_notified_at from network_incidents where id = ${incidentId}`;
  if (!i || i.operator === 'other') return 0;
  if (kind === 'down' ? i.users_notified_at : i.recovery_notified_at || !i.users_notified_at) return 0;
  // помечаем до рассылки: повторные тики не продублируют
  await sql()`update network_incidents set ${kind === 'down' ? sql()`users_notified_at = now()` : sql()`recovery_notified_at = now()`} where id = ${incidentId}`;
  const users = await sql()`select distinct u.id from net_probes p join users u on u.id = p.user_id
    where p.source = 'client' and p.operator = ${i.operator} and p.at > now() - interval '7 days'
      and u.tg_id is not null and not u.bot_blocked and u.status = 'active' limit 2000`;
  const op = escapeHtml(OPERATOR_LABEL[i.operator as Operator] ?? String(i.operator));
  const text = kind === 'down'
    ? `⚠️ <b>Возможны перебои у оператора ${op}</b>\nМы видим проблемы с доступом к «${escapeHtml(String(i.target))}». Попробуйте другую локацию в приложении. Мы уже разбираемся.`
    : `✅ <b>Доступ у оператора ${op} восстановлен</b>\nЕсли что-то всё ещё не работает, откройте «Помощь» → «Не работает».`;
  let n = 0;
  for (const u of users) { if (await notifyUser(u.id as string, text, [openAppButton(kind === 'down' ? '🌐 Выбрать локацию' : '🛟 Помощь')])) n++; await new Promise((r) => setTimeout(r, 45)); }
  if (kind === 'down') await sql()`update network_incidents set users_notified = ${n} where id = ${incidentId}`;
  return n;
}
