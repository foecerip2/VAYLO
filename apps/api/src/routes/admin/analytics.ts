import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { sql } from '../../db/index.js';
import { requireAdmin } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import { cohorts, funnel, mrrEstimate, revenue } from '../../services/analytics.js';

const range = z.object({ from: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(), to: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(), granularity: z.enum(['day', 'month']).default('day'), campaign: z.string().max(40).optional() });
function period(q: z.infer<typeof range>) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  if (!(from < to) || to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest('Период: от 1 дня до 400 дней');
  return { from, to };
}
const money = (n: number) => (n / 100).toFixed(2);

export async function adminAnalyticsRoutes(app: FastifyInstance) {
  // воронка бота и авто-скидки: сколько сообщений ушло, какие акции созданы системой
  app.get('/growth/stats', async (req) => {
    await requireAdmin(req, 'analyst');
    const steps = await sql()`select step, count(*)::int as n, max(sent_at) as last_at from bot_funnel_sent where sent_at > now() - interval '30 days' group by step order by step`;
    const camps = await sql()`select auto_key, title, value, audience, is_active from campaigns where auto_key is not null order by auto_key`;
    return {
      funnel: steps.map((r) => ({ step: r.step as string, sent: r.n as number, lastAt: (r.last_at as Date).toISOString() })),
      autoCampaigns: camps.map((c) => ({ key: c.auto_key as string, title: c.title as string, pct: c.value as number, audience: c.audience as string, active: c.is_active as boolean })),
    };
  });

  const off = () => !config().PRODUCT_ANALYTICS_ENABLED;
  app.get('/analytics/overview', async (req) => {
    await requireAdmin(req, 'analyst');
    if (off()) return { enabled: false };
    const p = period(range.parse(req.query));
    return { enabled: true, revenue: await revenue(p), mrr: await mrrEstimate() };
  });
  app.get('/analytics/funnel', async (req) => {
    await requireAdmin(req, 'analyst');
    if (off()) return { enabled: false };
    const q = range.parse(req.query);
    return { enabled: true, ...(await funnel(period(q), q.campaign)) };
  });
  app.get('/analytics/cohorts', async (req) => {
    await requireAdmin(req, 'analyst');
    if (off()) return { enabled: false };
    return { enabled: true, ...(await cohorts()) };
  });
  app.get('/analytics/revenue', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    await requireAdmin(req, 'analyst');
    if (off()) return { enabled: false };
    const q = range.parse(req.query);
    const r = await revenue(period(q), q.granularity);
    if ((req.query as { format?: string }).format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      return 'bucket,currency,gross,refunds,net,payments,payers\n' + r.series.map((s) => [s.bucket.slice(0, 10), s.currency, money(s.gross), money(s.refunds), money(s.net), s.payments, s.payers].join(',')).join('\n');
    }
    return { enabled: true, ...r };
  });
}
