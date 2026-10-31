import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { audit, requireAdmin } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';
import { issueProbeToken, listProbeTokens, revokeProbeToken } from '../../lib/probeAuth.js';
import { workerHealth } from '../../services/workerHealth.js';
import { rankingOverview } from '../../services/nodeRanking.js';
import { ackIncident, incidentDetail, listIncidents } from '../../services/networkIncidents.js';
import { WINDOWS, networkSummary } from '../../services/networkAggregates.js';

const idp = z.object({ id: z.string().uuid() });

export async function adminNetworkIntelligenceRoutes(app: FastifyInstance) {
  // ---- токены проб (admin) ----
  app.get('/probe-tokens', async (req) => { await requireAdmin(req, 'admin'); return { items: await listProbeTokens(), scopedAuth: config().NETPROBE_SCOPED_AUTH }; });
  app.post('/probe-tokens', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({ label: z.string().trim().min(2).max(60), expiresInDays: z.number().int().min(1).max(730).nullish() }).parse(req.body);
    const t = await issueProbeToken({ label: b.label, scopes: ['probe:write'], createdBy: a.id, expiresInDays: b.expiresInDays });
    await audit(a, req, 'probe-token.issue', 'probe_token', t.id, { label: b.label });
    return { id: t.id, token: t.token, note: 'Токен показывается один раз — сохраните его.' };
  });
  app.delete('/probe-tokens/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idp.parse(req.params);
    if (!(await revokeProbeToken(id))) throw notFound();
    await audit(a, req, 'probe-token.revoke', 'probe_token', id);
    return { ok: true };
  });

  app.get('/system/worker-health', async (req) => { await requireAdmin(req, 'analyst'); return workerHealth(); });
  app.get('/node-recommendations', async (req) => { await requireAdmin(req, 'analyst'); return rankingOverview(); });

  // ---- аналитика сети (за флагом) ----
  const off = () => !config().NETWORK_INTELLIGENCE_ENABLED;
  app.get('/network-intelligence/summary', async (req) => {
    await requireAdmin(req, 'analyst');
    if (off()) return { enabled: false, cells: [] };
    const q = z.object({ window: z.enum(Object.keys(WINDOWS) as ['30m', '24h', '7d']).default('24h'), operator: z.string().max(20).optional(), os: z.enum(['ios', 'android', 'other']).optional() }).parse(req.query);
    return { enabled: true, ...(await networkSummary(q)) };
  });
  app.get('/network-intelligence/incidents', async (req) => {
    await requireAdmin(req, 'analyst');
    if (off()) return { enabled: false, items: [] };
    const q = z.object({ state: z.enum(['active', 'all']).default('active') }).parse(req.query);
    return { enabled: true, items: await listIncidents(q.state) };
  });
  app.get('/network-intelligence/incidents/:id', async (req) => {
    await requireAdmin(req, 'analyst');
    if (off()) throw notFound();
    const d = await incidentDetail(idp.parse(req.params).id);
    if (!d) throw notFound();
    return d;
  });
  app.post('/network-intelligence/incidents/:id/ack', async (req) => {
    const a = await requireAdmin(req, 'admin');
    if (off()) throw notFound();
    const { id } = idp.parse(req.params);
    const b = z.object({ note: z.string().max(300).default('') }).parse(req.body ?? {});
    if (!(await ackIncident(id, b.note))) throw notFound();
    await audit(a, req, 'incident.ack', 'network_incident', id);
    return { ok: true };
  });
}
