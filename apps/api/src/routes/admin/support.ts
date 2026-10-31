import type { FastifyInstance } from 'fastify';
import { triageSummary } from '../../services/supportSafety.js';
import { z } from 'zod';
import { SUPPORT_STATUSES } from '@vpn/shared';
import { sql } from '../../db/index.js';
import { audit, requireAdmin } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';
import { readSupportPhoto, supportPhotosSchema, SUPPORT_PHOTO_BODY_LIMIT } from '../../services/supportAttachments.js';
import { setSettings } from '../../services/settings.js';
import { adminArchive, adminList, adminReply, adminStats, adminThread, adminUpdate, listAiModels, testAi } from '../../services/support.js';

const id = z.object({ id: z.string().uuid() });

export async function adminSupportRoutes(app: FastifyInstance) {
  app.get('/support/stats', async (req) => {
    await requireAdmin(req, 'support');
    return adminStats();
  });
  app.get('/support/tickets', async (req) => {
    await requireAdmin(req, 'support');
    const q = z.object({ status: z.enum(SUPPORT_STATUSES).optional(), priority: z.enum(['normal', 'important', 'urgent']).optional(), mode: z.enum(['ai', 'human']).optional(), search: z.string().max(60).optional(), content: z.enum(['messages','all','empty']).default('messages'),archive:z.enum(['active','archived','all']).default('active') }).parse(req.query);
    return adminList(q);
  });
  // краткое резюме для оператора (тема, нужна ли эскалация, без персональных данных); AI ничего не выполняет
  app.get('/support/tickets/:id/triage', async (req) => {
    await requireAdmin(req, 'support');
    const t = await adminThread(id.parse(req.params).id);
    return triageSummary((t as any).messages ?? []);
  });
  app.get('/support/tickets/:id', async (req) => {
    await requireAdmin(req, 'support');
    return adminThread(id.parse(req.params).id);
  });
  app.get('/support/attachments/:id', async (req, reply) => {
    await requireAdmin(req, 'support');
    const photo = await readSupportPhoto(id.parse(req.params).id);
    return reply.header('content-type', photo.mime).header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff').header('content-disposition', 'inline; filename="support-photo.jpg"').send(photo.data);
  });
  app.post('/support/tickets/:id/reply', { bodyLimit: SUPPORT_PHOTO_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const a = await requireAdmin(req, 'support');
    const b = z.object({ text: z.string().max(3000).default(''), close: z.boolean().default(false), photos: supportPhotosSchema }).parse(req.body);
    const tid = id.parse(req.params).id;
    const r = await adminReply(a.id, tid, b.text, b.close, b.photos);
    await audit(a, req, 'support.reply', 'support_ticket', tid);
    return r;
  });
  app.patch('/support/tickets/:id', async (req) => {
    const a = await requireAdmin(req, 'support');
    const b = z.object({ priority: z.enum(['normal', 'important', 'urgent']).optional(), status: z.enum(SUPPORT_STATUSES).optional(), reason: z.string().max(300).optional(), aiOff: z.boolean().optional(), mode: z.enum(['ai', 'human']).optional() }).parse(req.body);
    const tid = id.parse(req.params).id;
    const r = await adminUpdate(tid, b, a.id);
    await audit(a, req, 'support.update', 'support_ticket', tid, b);
    return r;
  });

  for(const action of ['archive','restore'] as const)app.post(`/support/tickets/:id/${action}`,async req=>{
    const a=await requireAdmin(req,'support');
    const tid=id.parse(req.params).id;
    const r=await adminArchive(tid,a.id,action==='archive');
    if(r.changed)await audit(a,req,`support.${action}`,'support_ticket',tid);
    return r;
  });

  // шаблоны быстрых ответов
  const tpl = z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(1500) });
  app.get('/support/templates', async (req) => {
    await requireAdmin(req, 'support');
    return sql()`select id, title, body from support_templates order by sort, title`;
  });
  app.post('/support/templates', async (req) => {
    const a = await requireAdmin(req, 'support');
    const b = tpl.parse(req.body);
    const [r] = await sql()`insert into support_templates (title, body, sort) values (${b.title}, ${b.body}, (select coalesce(max(sort), 0) + 1 from support_templates)) returning id, title, body`;
    await audit(a, req, 'support.template.create', 'support_template', r!.id);
    return r;
  });
  app.put('/support/templates/:id', async (req) => {
    const a = await requireAdmin(req, 'support');
    const b = tpl.parse(req.body);
    const [r] = await sql()`update support_templates set title = ${b.title}, body = ${b.body} where id = ${id.parse(req.params).id} returning id, title, body`;
    if (!r) throw notFound();
    await audit(a, req, 'support.template.update', 'support_template', r.id);
    return r;
  });
  app.delete('/support/templates/:id', async (req) => {
    const a = await requireAdmin(req, 'support');
    const tid = id.parse(req.params).id;
    await sql()`delete from support_templates where id = ${tid}`;
    await audit(a, req, 'support.template.delete', 'support_template', tid);
    return { ok: true };
  });

  // быстрый выключатель ИИ (роль «admin» достаточно; полные настройки — у владельца)
  app.post('/support/ai', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({ enabled: z.boolean() }).parse(req.body);
    await setSettings('support', { ai_enabled: b.enabled });
    await audit(a, req, 'support.ai.toggle', 'settings', 'support', b);
    return { ok: true, enabled: b.enabled };
  });

  app.post('/support/ai-models', async (req, reply) => {
    await requireAdmin(req, 'admin');
    const b = z.object({ which: z.enum(['main', 'fallback']).default('main'), base_url: z.string().max(300).optional(), key: z.string().max(300).optional() }).parse(req.body ?? {});
    try {
      return { models: await listAiModels(b.which, b.base_url, b.key) };
    } catch (e) {
      return reply.code(400).send({ error: 'ai_models', message: (e as Error).message.slice(0, 220) });
    }
  });

  app.post('/support/test-ai', async (req) => {
    await requireAdmin(req, 'admin');
    return testAi();
  });
}
