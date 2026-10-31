import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../db/index.js';
import { audit, requireAdmin } from '../../lib/auth.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { SEGMENTS } from '../../services/broadcast.js';
import { CAMPAIGN_KINDS, countAudience, dropCampaignCache, isGrantKind, startGrant, validAudience, type CampaignRow } from '../../services/campaigns.js';

const body = z.object({
  title: z.string().trim().min(2).max(80),
  kind: z.enum(CAMPAIGN_KINDS),
  value: z.number().int().positive(),
  audience: z.string().default('all'),
  planIds: z.array(z.string().uuid()).max(50).nullish(),
  message: z.string().trim().max(900).default(''),
  notify: z.boolean().default(true),
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
});
const idp = z.object({ id: z.string().uuid() });

const out = (c: CampaignRow) => ({
  id: c.id, title: c.title, kind: c.kind, value: c.value, audience: c.audience, planIds: c.plan_ids, message: c.message, notify: c.notify, isActive: c.is_active,
  startsAt: c.starts_at.toISOString(), endsAt: c.ends_at?.toISOString() ?? null, status: c.status, total: c.total, granted: c.granted, failed: c.failed,
  startedAt: c.started_at?.toISOString() ?? null, finishedAt: c.finished_at?.toISOString() ?? null, createdAt: c.created_at.toISOString(),
});

function check(b: z.infer<typeof body>) {
  if (!validAudience(b.audience)) throw badRequest('Неизвестная аудитория');
  if (b.kind === 'days' && b.value > 3650) throw badRequest('Не больше 3650 дней');
  if (b.kind === 'balance' && b.value > 100_000_00) throw badRequest('Не больше 100 000 ₽ на человека');
  if ((b.kind === 'plan_discount' || b.kind === 'topup_bonus') && b.value > 100) throw badRequest('Процент не может быть больше 100');
  if (b.kind === 'topup_bonus' && b.value > 300) throw badRequest('Бонус не больше 300%');
  if (b.endsAt && new Date(b.endsAt).getTime() <= Date.now()) throw badRequest('Дата окончания уже прошла');
}

export async function adminCampaignRoutes(app: FastifyInstance) {
  app.get('/campaigns', async (req) => {
    await requireAdmin(req, 'analyst');
    const rows = await sql()<CampaignRow[]>`select * from campaigns order by created_at desc limit 200`;
    return { audiences: SEGMENTS, items: rows.map(out) };
  });
  app.get('/campaigns/audience', async (req) => {
    await requireAdmin(req, 'analyst');
    const { audience } = z.object({ audience: z.string().default('all') }).parse(req.query);
    if (!validAudience(audience)) throw badRequest('Неизвестная аудитория');
    return { count: await countAudience(audience) };
  });
  app.post('/campaigns', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = body.parse(req.body);
    check(b);
    const [c] = await sql()<CampaignRow[]>`
      insert into campaigns (title, kind, value, audience, plan_ids, message, notify, is_active, starts_at, ends_at, created_by)
      values (${b.title}, ${b.kind}, ${b.value}, ${b.audience}, ${b.planIds?.length ? b.planIds : null}, ${b.message}, ${b.notify}, ${isGrantKind(b.kind) ? true : b.isActive},
        ${b.startsAt ? new Date(b.startsAt) : new Date()}, ${b.endsAt ? new Date(b.endsAt) : null}, ${a.email}) returning *`;
    dropCampaignCache();
    await audit(a, req, 'campaign.create', 'campaign', c!.id, b);
    return out(c!);
  });
  // автоматические акции (скидка/бонус) можно включать, выключать и менять срок; выданные компенсации не меняются
  app.put('/campaigns/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idp.parse(req.params);
    const b = z.object({ isActive: z.boolean().optional(), endsAt: z.string().datetime().nullish(), title: z.string().trim().min(2).max(80).optional() }).parse(req.body);
    const [cur] = await sql()<CampaignRow[]>`select * from campaigns where id = ${id}`;
    if (!cur) throw notFound('Акция не найдена');
    const [c] = await sql()<CampaignRow[]>`update campaigns set is_active = ${b.isActive ?? cur.is_active}, title = ${b.title ?? cur.title},
      ends_at = ${b.endsAt === undefined ? cur.ends_at : b.endsAt ? new Date(b.endsAt) : null} where id = ${id} returning *`;
    dropCampaignCache();
    await audit(a, req, 'campaign.update', 'campaign', id, b);
    return out(c!);
  });
  app.post('/campaigns/:id/start', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idp.parse(req.params);
    const c = await startGrant(id);
    await audit(a, req, 'campaign.grant', 'campaign', id, { total: c.total });
    return out(c);
  });
  app.delete('/campaigns/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idp.parse(req.params);
    const [cur] = await sql()<CampaignRow[]>`select * from campaigns where id = ${id}`;
    if (!cur) throw notFound('Акция не найдена');
    if (cur.status === 'running') throw conflict('Выдача идёт — дождитесь завершения');
    await sql()`delete from campaigns where id = ${id}`;
    dropCampaignCache();
    await audit(a, req, 'campaign.delete', 'campaign', id);
    return { ok: true };
  });
}
