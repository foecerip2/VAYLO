import { sql } from '../db/index.js';
import { escapeHtml } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { alertAdminsThrottled } from './alerts.js';
import { remnawave } from './remnawave.js';
import { getSettings } from './settings.js';
import { config } from '../config.js';

export type Operator = 'beeline' | 'mts' | 'megafon' | 'tele2' | 'rostelecom' | 'other';
export const OPERATOR_LABEL: Record<Operator, string> = { beeline: 'Билайн', mts: 'МТС', megafon: 'МегаФон / Yota', tele2: 'Tele2', rostelecom: 'Ростелеком', other: 'Другие сети' };

/** Оператор по номеру AS и названию владельца. Мобильную и домашнюю сеть одного оператора различить по AS нельзя. */
export function operatorOf(asn: number | null, holder: string): Operator {
  const h = holder.toLowerCase();
  if (asn && [3216, 16345, 8402].includes(asn)) return 'beeline';
  if (/vimpel|beeline|sovam|билайн/.test(h)) return 'beeline';
  if (asn && [8359, 8580].includes(asn)) return 'mts';
  if (/\bmts\b|mobile telesystems|мтс/.test(h)) return 'mts';
  if (asn && [31133, 25159].includes(asn)) return 'megafon';
  if (/megafon|мегафон|yota/.test(h)) return 'megafon';
  if (asn && [41330, 12958].includes(asn)) return 'tele2';
  if (/tele2|t2 mobile|т2/.test(h)) return 'tele2';
  if (asn === 12389 || /rostelecom|ростелеком/.test(h)) return 'rostelecom';
  return 'other';
}

export function osOf(ua: string): 'ios' | 'android' | 'other' {
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

/** Ключ кэша: IPv4 → /24, IPv6 → первые три группы. Полные адреса не сохраняются. */
export function prefixOf(ip: string): string {
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.0/24';
  return ip.split(':').slice(0, 3).join(':') + '::/48';
}

type Resolver = (ip: string) => Promise<{ asn: number | null; holder: string }>;
/** RIPEstat: бесплатно и без ключа. Для тестов подменяется через setAsnResolver. */
let resolver: Resolver = async (ip) => {
  const r = await fetch(`https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`RIPEstat ${r.status}`);
  const j = (await r.json()) as { data?: { asns?: { asn: number; holder: string }[] } };
  const a = j.data?.asns?.[0];
  return { asn: a?.asn ?? null, holder: a?.holder ?? '' };
};
export function setAsnResolver(fn: Resolver | null) {
  resolver = fn ?? resolver;
}

export async function resolveOperator(ip: string): Promise<{ asn: number | null; operator: Operator }> {
  const prefix = prefixOf(ip);
  const [hit] = await sql()`select asn, operator from asn_cache where prefix = ${prefix} and fetched_at > now() - interval '7 days'`;
  if (hit) return { asn: hit.asn as number | null, operator: hit.operator as Operator };
  try {
    const { asn, holder } = await resolver(ip);
    const operator = operatorOf(asn, holder);
    await sql()`insert into asn_cache (prefix, asn, holder, operator) values (${prefix}, ${asn}, ${holder.slice(0, 200)}, ${operator})
      on conflict (prefix) do update set asn = excluded.asn, holder = excluded.holder, operator = excluded.operator, fetched_at = now()`;
    return { asn, operator };
  } catch (e) {
    log.warn('asn lookup failed', { err: (e as Error).message });
    return { asn: null, operator: 'other' };
  }
}

export interface ProbeResult { target: string; kind: 'sub' | 'api' | 'host' | 'vless'; ok: boolean; ms?: number | null; detail?: string }

export async function recordClientProbes(input: { userId: string; ip: string; ua: string; results: ProbeResult[] }): Promise<{ operator: Operator; saved: number }> {
  const { asn, operator } = await resolveOperator(input.ip);
  const os = osOf(input.ua);
  for (const r of input.results) {
    await sql()`insert into net_probes (source, evidence, user_id, asn, operator, os, target, kind, ok, ms, detail)
      values ('client', 'browser_heuristic', ${input.userId}, ${asn}, ${operator}, ${os}, ${r.target.slice(0, 120)}, ${r.kind}, ${r.ok}, ${r.ms ?? null}, ${(r.detail ?? '').slice(0, 200) || null})`;
  }
  return { operator, saved: input.results.length };
}

/** Результаты проб по ключу (из сети, где запущен проб-скрипт). operator — подпись самой пробы, например «beeline» для телефона с SIM.
 *  evidence = real_xray_probe: настоящий тест через Xray, в отличие от браузерных эвристик клиентов. Повтор reportId не дублирует замеры. */
export async function recordServerProbes(input: { name: string; operator?: string; results: ProbeResult[]; probeId?: string | null; reportId?: string }): Promise<number> {
  const op = (['beeline', 'mts', 'megafon', 'tele2', 'rostelecom'] as const).find((o) => o === input.operator) ?? 'other';
  let saved = 0;
  for (const r of input.results) {
    const ms = r.ms == null ? null : Math.max(0, Math.round(r.ms));
    const ins = await sql()`insert into net_probes (source, probe_name, probe_id, report_id, evidence, operator, os, target, kind, ok, ms, detail)
      values ('probe', ${input.name.slice(0, 60)}, ${input.probeId ?? null}, ${input.reportId ?? null}, 'real_xray_probe', ${op}, 'other', ${r.target.slice(0, 120)}, ${r.kind}, ${r.ok}, ${ms}, ${(r.detail ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) || null})
      on conflict do nothing returning id`;
    saved += ins.length;
  }
  return saved;
}

/** Что именно нужно проверить клиенту: страница подписки, API и до 8 хостов подписки */
export async function probeTargets(): Promise<{ id: string; kind: 'sub' | 'api' | 'host'; url: string; label: string }[]> {
  const out: { id: string; kind: 'sub' | 'api' | 'host'; url: string; label: string }[] = [];
  const [s] = await sql()`select sub_url from subscriptions where sub_url is not null order by updated_at desc limit 1`;
  if (s?.sub_url) {
    try { out.push({ id: 'sub', kind: 'sub', url: new URL(s.sub_url as string).origin + '/', label: 'Страница подписки' }); } catch { /* ignore */ }
  }
  try { out.push({ id: 'api', kind: 'api', url: new URL(config().API_URL).origin + '/api/v1/health', label: 'API сервиса' }); } catch { /* ignore */ }
  try {
    if (await remnawave.isConfigured()) {
      const seen = new Set<string>();
      for (const h of await remnawave.listHosts()) {
        const port = Number((h as { port?: number }).port ?? 443);
        const addr = h.address;
        if (!addr || h.address.includes(' ') || seen.has(`${addr}:${port}`)) continue;
        seen.add(`${addr}:${port}`);
        out.push({ id: `host:${(h.remark ?? addr).slice(0, 40)}`, kind: 'host', url: `https://${addr}${port === 443 ? '' : ':' + port}/`, label: h.remark ?? addr });
        if (seen.size >= 8) break;
      }
    }
  } catch { /* панель недоступна — проверим хотя бы sub и api */ }
  return out;
}

export interface NetRow { operator: Operator; target: string; kind: string; os: string; samples: number; okPct: number; medianMs: number | null; lastAt: string }
export async function netStatus(windowMin = 30): Promise<NetRow[]> {
  const rows = await sql()`
    select operator, target, max(kind) as kind, os, count(*)::int as samples,
           round(100.0 * avg(case when ok then 1 else 0 end))::int as ok_pct,
           percentile_cont(0.5) within group (order by ms) filter (where ok and ms is not null) as med,
           max(at) as last_at
    from net_probes where at > now() - make_interval(mins => ${windowMin}) and source = 'client'
    group by operator, target, os order by operator, target, os`;
  return rows.map((r) => ({ operator: r.operator as Operator, target: r.target as string, kind: r.kind as string, os: r.os as string, samples: r.samples as number, okPct: r.ok_pct as number, medianMs: r.med == null ? null : Math.round(Number(r.med)), lastAt: (r.last_at as Date).toISOString() }));
}

export async function lastServerProbes() {
  const rows = await sql()`
    select distinct on (probe_name, target) probe_name, operator, target, ok, ms, detail, at
    from net_probes where source = 'probe' and at > now() - interval '24 hours' order by probe_name, target, at desc`;
  return rows.map((r) => ({ probe: r.probe_name as string, operator: r.operator as Operator, target: r.target as string, ok: r.ok as boolean, ms: r.ms as number | null, detail: r.detail as string | null, at: (r.at as Date).toISOString() }));
}

/**
 * Раз в несколько минут: ищем пары «оператор × цель» с массовыми неудачами за 30 минут.
 * Тревога только если замеров достаточно и раньше (за сутки) цель у этого оператора в основном работала — иначе это «всегда так».
 * Проблемы по пробам по ключу (source=probe): достаточно двух неудач подряд.
 */
export async function netTick(): Promise<number> {
  const cfg = await getSettings('netprobe');
  if (!cfg.enabled) return 0;
  const bad = await sql()`
    with recent as (
      select operator, target, count(*)::int as n, round(100.0 * avg(case when ok then 1 else 0 end))::int as pct
      from net_probes where at > now() - interval '30 minutes' and source = 'client' and operator <> 'other' group by operator, target
    ), base as (
      select operator, target, count(*)::int as n, round(100.0 * avg(case when ok then 1 else 0 end))::int as pct
      from net_probes where at between now() - interval '24 hours' and now() - interval '30 minutes' and source = 'client' group by operator, target
    )
    select r.operator, r.target, r.n, r.pct from recent r left join base b using (operator, target)
    where r.n >= ${cfg.min_samples} and r.pct < ${cfg.alert_below_pct} and (b.n is null or b.n < 5 or b.pct >= 70)`;
  const keys = new Set<string>();
  let alerts = 0;
  for (const b of bad) {
    keys.add(`${b.operator}|${b.target}`);
    const [i] = await sql()`
      insert into net_issues (operator, target, samples, ok_pct) values (${b.operator}, ${b.target}, ${b.n}, ${b.pct})
      on conflict (operator, target) do update set last_seen = now(), samples = excluded.samples, ok_pct = excluded.ok_pct, active = true,
        since = case when net_issues.active then net_issues.since else now() end
      returning alerted_at`;
    if (!i!.alerted_at) {
      await sql()`update net_issues set alerted_at = now() where operator = ${b.operator} and target = ${b.target}`;
      void alertAdminsThrottled(`net:${b.operator}:${b.target}`, `🔴 <b>Нет доступа у оператора ${escapeHtml(OPERATOR_LABEL[b.operator as Operator])}</b>\nЦель: <code>${escapeHtml(String(b.target))}</code>\nУспешных замеров: ${b.pct}% из ${b.n} за 30 минут.`, 3600);
      alerts++;
    }
  }
  // проблемы, которые прошли: нет свежих неудач 30 минут
  const active = await sql()`select operator, target from net_issues where active`;
  for (const a of active) {
    if (keys.has(`${a.operator}|${a.target}`)) continue;
    await sql()`update net_issues set active = false, alerted_at = null where operator = ${a.operator} and target = ${a.target}`;
    void alertAdminsThrottled(`net-ok:${a.operator}:${a.target}`, `🟢 <b>Доступ восстановился</b>: ${escapeHtml(OPERATOR_LABEL[a.operator as Operator] ?? String(a.operator))}, <code>${escapeHtml(String(a.target))}</code>`, 600);
  }
  await sql()`delete from net_probes where at < now() - interval '14 days'`;
  return alerts;
}

export async function activeNetIssues(): Promise<{ operator: Operator; target: string; since: string; okPct: number; samples: number }[]> {
  const rows = await sql()`select operator, target, since, ok_pct, samples from net_issues where active order by since`;
  return rows.map((r) => ({ operator: r.operator as Operator, target: r.target as string, since: (r.since as Date).toISOString(), okPct: r.ok_pct as number, samples: r.samples as number }));
}
