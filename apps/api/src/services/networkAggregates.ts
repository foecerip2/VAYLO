import { sql } from '../db/index.js';

export const MIN_SAMPLES = 10;
export const WINDOWS = { '30m': 30, '24h': 24 * 60, '7d': 7 * 24 * 60 } as const;
export type WindowKey = keyof typeof WINDOWS;

export interface Cell { evidence: 'real_xray_probe' | 'browser_heuristic'; operator: string; os: string; target: string; samples: number; okCount: number; successRate: number | null; p50: number | null; p95: number | null; lastAt: string; confidence: 'insufficient' | 'low' | 'ok' }

export function confidenceOf(n: number): Cell['confidence'] { return n < MIN_SAMPLES ? 'insufficient' : n < 30 ? 'low' : 'ok'; }

/** Агрегаты по источникам БЕЗ смешивания: Xray и браузерные эвристики — отдельные ячейки. При n<10 процент не отдаётся. */
export async function networkSummary(q: { window: WindowKey; operator?: string; os?: string }): Promise<{ window: WindowKey; dataAsOf: string; cells: Cell[] }> {
  const mins = WINDOWS[q.window];
  const rows = await sql()`
    select coalesce(evidence, case when source = 'probe' then 'real_xray_probe' else 'browser_heuristic' end) as evidence, operator, os, target,
           count(*)::int as n, count(*) filter (where ok)::int as okc,
           percentile_cont(0.5) within group (order by ms) filter (where ok and ms is not null) as p50,
           percentile_cont(0.95) within group (order by ms) filter (where ok and ms is not null) as p95, max(at) as last_at
    from net_probes
    where at > now() - make_interval(mins => ${mins})
      ${q.operator ? sql()`and operator = ${q.operator}` : sql()``} ${q.os ? sql()`and os = ${q.os}` : sql()``}
    group by 1, operator, os, target order by operator, target, 1 limit 500`;
  return {
    window: q.window, dataAsOf: new Date().toISOString(),
    cells: rows.map((r) => {
      const n = r.n as number;
      return { evidence: r.evidence as Cell['evidence'], operator: r.operator as string, os: r.os as string, target: r.target as string, samples: n, okCount: r.okc as number, successRate: n < MIN_SAMPLES ? null : Math.round((100 * (r.okc as number)) / n), p50: r.p50 == null ? null : Math.round(Number(r.p50)), p95: r.p95 == null ? null : Math.round(Number(r.p95)), lastAt: (r.last_at as Date).toISOString(), confidence: confidenceOf(n) };
    }),
  };
}
