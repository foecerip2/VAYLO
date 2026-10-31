import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { resolveOperator } from './netprobe.js';

/** Стартовые веса — гипотеза, не эмпирический оптимум. */
export const WEIGHTS = { availability: 0.45, latency: 0.2, stability: 0.15, freshness: 0.1, load: 0.1 };
export const FRESH_MIN = 60;

export interface Evidence { ok: boolean; ms: number | null; ageMin: number }
export interface Candidate { nodeId: string; label: string; samples: Evidence[]; confirmedIncident: boolean }
export interface Ranked { nodeId: string; label: string; quality: 'high' | 'medium' | 'unknown'; score: number | null; confidence: number; evidenceCount: number; checkedAt: string | null; reasons: string[] }

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** Чистая функция: оценка кандидатов только по реальным замерам Xray. Недоступные/без данных не получают «победителя». */
export function rankNodes(cands: Candidate[], now = Date.now()): { recommendedNodeId?: string; ranked: Ranked[]; mode: 'evidence' | 'fallback' } {
  const ranked: Ranked[] = cands.filter((c) => !c.confirmedIncident).map((c) => {
    const s = c.samples;
    const n = s.length;
    const base = { nodeId: c.nodeId, label: c.label, evidenceCount: n };
    const newest = n ? Math.min(...s.map((x) => x.ageMin)) : null;
    const checkedAt = newest == null ? null : new Date(now - newest * 60_000).toISOString();
    if (n < 5 || newest! > FRESH_MIN) return { ...base, quality: 'unknown' as const, score: null, confidence: 0, checkedAt, reasons: [n < 5 ? 'мало свежих проверок' : 'проверки устарели'] };
    const avail = s.filter((x) => x.ok).length / n;
    const ms = s.filter((x) => x.ok && x.ms != null).map((x) => x.ms!).sort((a, b) => a - b);
    const p50 = ms.length ? ms[Math.floor(ms.length / 2)]! : null;
    const latency = p50 == null ? 0 : clamp(1 - (p50 - 150) / 1850);
    const ordered = [...s].sort((a, b) => a.ageMin - b.ageMin);
    let flips = 0;
    for (let i = 1; i < ordered.length; i++) if (ordered[i]!.ok !== ordered[i - 1]!.ok) flips++;
    const stability = clamp(1 - flips / Math.max(1, n - 1));
    const freshness = clamp(1 - newest! / FRESH_MIN);
    const load = 0.5; // данных о нагрузке нет: нейтрально, не «идеально»
    const score = WEIGHTS.availability * avail + WEIGHTS.latency * latency + WEIGHTS.stability * stability + WEIGHTS.freshness * freshness + WEIGHTS.load * load;
    const confidence = clamp(n / 30) * freshness;
    const quality = avail >= 0.9 && n >= 10 ? ('high' as const) : avail >= 0.8 ? ('medium' as const) : ('unknown' as const);
    return { ...base, quality, score: Math.round(score * 1000) / 1000, confidence: Math.round(confidence * 100) / 100, checkedAt, reasons: [`успешно ${Math.round(avail * 100)}% из ${n} проверок`, p50 != null ? `медианная задержка ${p50} мс` : 'задержка не измерена'] };
  });
  ranked.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const best = ranked[0];
  const ok = best && best.score != null && best.quality !== 'unknown';
  return { recommendedNodeId: ok ? best.nodeId : undefined, ranked, mode: ok ? 'evidence' : 'fallback' };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Для админки: рейтинг всех видимых локаций без привязки к тарифу пользователя. Только просмотр. */
export async function rankingOverview() {
  if (!config().NODE_RECOMMENDATIONS_ENABLED) return { enabled: false as const };
  const servers = await sql()`select id, title from status_servers where visible and grp = 'location' order by sort, title`;
  const rows = await sql()`select target, ok, ms, extract(epoch from now() - at) / 60 as age from net_probes where source = 'probe' and evidence = 'real_xray_probe' and at > now() - interval '3 hours' limit 5000`;
  const inc = await sql()`select target from network_incidents where state = 'confirmed'`;
  const bad = new Set(inc.map((i) => norm(i.target as string)));
  const cands: Candidate[] = servers.map((sv) => {
    const key = norm(String(sv.title).replace(/^[^\p{L}\p{N}]+/u, ''));
    return { nodeId: sv.id as string, label: sv.title as string, confirmedIncident: bad.has(key), samples: rows.filter((r) => norm(r.target as string) === key).map((r) => ({ ok: r.ok as boolean, ms: r.ms as number | null, ageMin: Number(r.age) })) };
  });
  return { enabled: true as const, weights: WEIGHTS, excludedByIncident: cands.filter((c) => c.confirmedIncident).map((c) => c.label), ...rankNodes(cands) };
}

/** Рекомендации ТОЛЬКО среди локаций, доступных пользователю по его тарифу (статус-серверы: visible + plan_ids). Ничего не переключает. */
export async function recommendForUser(user: UserRow, ip: string) {
  if (!config().NODE_RECOMMENDATIONS_ENABLED) return { enabled: false as const };
  const [sub] = await sql()`select plan_id from subscriptions where user_id = ${user.id} and expires_at > now()`;
  const servers = await sql()`select id, title, grp, plan_ids from status_servers where visible and grp = 'location' and (plan_ids is null or cardinality(plan_ids) = 0 or ${sub?.plan_id ?? null}::uuid = any(plan_ids))`;
  const { operator } = await resolveOperator(ip);
  const rows = await sql()`select target, operator as op, ok, ms, extract(epoch from now() - at) / 60 as age from net_probes
    where source = 'probe' and evidence = 'real_xray_probe' and at > now() - interval '3 hours' order by at desc limit 3000`;
  const inc = await sql()`select target from network_incidents where state = 'confirmed'`;
  const bad = new Set(inc.map((i) => norm(i.target as string)));
  const cands: Candidate[] = servers.map((sv) => {
    const key = norm(String(sv.title).replace(/^[^\p{L}\p{N}]+/u, ''));
    const mine = rows.filter((r) => norm(r.target as string) === key);
    const same = mine.filter((r) => r.op === operator);
    const use = same.length >= 5 ? same : mine;
    return { nodeId: sv.id as string, label: sv.title as string, confirmedIncident: bad.has(key), samples: use.map((r) => ({ ok: r.ok as boolean, ms: r.ms as number | null, ageMin: Number(r.age) })) };
  });
  return { enabled: true as const, ...rankNodes(cands) };
}
