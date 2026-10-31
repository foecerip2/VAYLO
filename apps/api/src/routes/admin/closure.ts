import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAdmin } from '../../lib/auth.js';
import { announceClosure, cancelClosure, closureOverview, editClosure, refundCsv, refundList } from '../../services/closure.js';

const dt = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const text = { reason: z.string().trim().min(10).max(1200), altText: z.string().trim().max(600), altUrl: z.string().trim().max(300).refine((u) => !u || /^https?:\/\//.test(u), 'Ссылка должна начинаться с http(s)://') };

export async function adminClosureRoutes(app: FastifyInstance) {
  app.get('/closure', async (req) => { await requireAdmin(req, 'admin'); return closureOverview(); });

  app.post('/closure/announce', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({ ...text, mode: z.enum(['auto', 'manual']), endsAt: dt.optional(), channelPost: z.boolean().default(false), remindDays: z.array(z.number().int().min(1).max(60)).max(8).optional(), farewell: z.boolean().optional() }).partial({ reason: true, altText: true, altUrl: true }).parse(req.body);
    const r = await announceClosure({ ...b, by: String(a.id) });
    await audit(a, req, 'closure.announce', 'closure', undefined, { endsAt: r.endsAt, mode: b.mode, post: r.postStatus });
    return { endsAt: r.endsAt.toISOString(), postStatus: r.postStatus, postError: r.postError };
  });

  // изменить дату/режим, пропустить пользователя или вернуть его в расчёт
  app.put('/closure', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({ mode: z.enum(['auto', 'manual']).optional(), endsAt: dt.optional(), skipAdd: z.string().uuid().optional(), skipRemove: z.string().uuid().optional(), reason: text.reason.optional(), altText: text.altText.optional(), altUrl: text.altUrl.optional(), remindDays: z.array(z.number().int().min(1).max(60)).max(8).optional(), farewell: z.boolean().optional() }).parse(req.body);
    await editClosure(b);
    await audit(a, req, 'closure.edit', 'closure', undefined, b);
    return closureOverview();
  });

  app.post('/closure/cancel', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({ notify: z.boolean().default(false) }).parse(req.body ?? {});
    const n = await cancelClosure(b.notify);
    await audit(a, req, 'closure.cancel', 'closure', undefined, { notified: n });
    return { ok: true, notified: n };
  });

  app.get('/closure/refunds', async (req) => { await requireAdmin(req, 'admin'); const rows = await refundList(); return { count: rows.length, totalRub: Math.round(rows.reduce((s, r) => s + r.unusedRub, 0)), rows }; });
  app.get('/closure/refunds.csv', async (req, reply) => {
    await requireAdmin(req, 'admin');
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="refunds.csv"').send(refundCsv(await refundList()));
  });
}
