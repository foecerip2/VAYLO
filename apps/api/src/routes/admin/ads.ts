import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../db/index.js';
import { audit, requireAdmin } from '../../lib/auth.js';
import { randomCode } from '../../lib/crypto.js';
import { conflict, notFound } from '../../lib/errors.js';
import { botLink } from '../../services/contests.js';

const idP = z.object({ id: z.string().uuid() });
const body = z.object({
  name: z.string().trim().min(2).max(80),
  source: z.string().trim().max(80).default(''),
  note: z.string().trim().max(300).default(''),
  /** стоимость размещения, ₽ */
  costRub: z.number().min(0).max(10_000_000).default(0),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{3,40}$/, 'Код: 3–40 символов a–z, 0–9, - и _').optional(),
  isActive: z.boolean().default(true),
});

export async function adminAdsRoutes(app: FastifyInstance) {
  // рекламные ссылки с окупаемостью. Платящим считается тот, у кого есть успешная оплата тарифа.
  app.get('/ads', async (req) => {
    await requireAdmin(req, 'analyst');
    const rows = await sql()`
      select l.id, l.code, l.name, l.source, l.note, l.cost_kop, l.clicks, l.is_active, l.created_at,
        (select count(*)::int from users x where x.partner_link_id = l.id) as registrations,
        (select count(distinct s.user_id)::int from subscriptions s join users x on x.id = s.user_id where x.partner_link_id = l.id and s.is_trial) as trials,
        (select count(distinct p.user_id)::int from payments p join users x on x.id = p.user_id where x.partner_link_id = l.id and p.status = 'succeeded' and p.amount > 0 and p.provider in ('yookassa','platega','rollypay') and p.purpose = 'plan') as paying,
        (select coalesce(sum(p.amount),0)::bigint from payments p join users x on x.id = p.user_id where x.partner_link_id = l.id and p.status = 'succeeded' and p.provider in ('yookassa','platega','rollypay')) as revenue
      from partner_links l order by l.created_at desc`;
    const items = rows.map((r: any) => {
      const cost = Number(r.cost_kop), revenue = Number(r.revenue);
      return {
        id: r.id, code: r.code, name: r.name, source: r.source, note: r.note, isActive: r.is_active, createdAt: r.created_at.toISOString(),
        link: botLink(`ref_${r.code}`), costRub: cost / 100, clicks: r.clicks, registrations: r.registrations, trials: r.trials, paying: r.paying, revenueRub: revenue / 100,
        // ROI = (выручка − затраты) / затраты; без затрат не считаем. CPA — цена платящего.
        roiPct: cost > 0 ? Math.round(((revenue - cost) / cost) * 100) : null,
        cpaRub: cost > 0 && r.paying > 0 ? Math.round(cost / r.paying / 100) : null,
        cpRegRub: cost > 0 && r.registrations > 0 ? Math.round(cost / r.registrations / 100) : null,
      };
    });
    const tot = items.reduce((a, i) => ({ cost: a.cost + i.costRub, revenue: a.revenue + i.revenueRub, reg: a.reg + i.registrations, paying: a.paying + i.paying }), { cost: 0, revenue: 0, reg: 0, paying: 0 });
    return { items, totals: { costRub: tot.cost, revenueRub: tot.revenue, registrations: tot.reg, paying: tot.paying, roiPct: tot.cost > 0 ? Math.round(((tot.revenue - tot.cost) / tot.cost) * 100) : null } };
  });

  app.post('/ads', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = body.parse(req.body);
    for (let n = 0; n < 5; n++) {
      const code = b.code ?? `ad-${randomCode(6).toLowerCase()}`;
      try {
        const [r] = await sql()`insert into partner_links (code, name, source, note, cost_kop, is_active) values (${code}, ${b.name}, ${b.source}, ${b.note}, ${Math.round(b.costRub * 100)}, ${b.isActive}) returning id`;
        await audit(a, req, 'ad.create', 'partner', r!.id as string, { name: b.name, code });
        return { id: r!.id, link: botLink(`ref_${code}`) };
      } catch (e: any) {
        if (e?.code === '23505') { if (b.code) throw conflict('Такой код уже занят'); continue; }
        throw e;
      }
    }
    throw conflict('Не удалось подобрать код');
  });

  app.put('/ads/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idP.parse(req.params);
    const b = body.omit({ code: true }).parse(req.body);
    const r = await sql()`update partner_links set name = ${b.name}, source = ${b.source}, note = ${b.note}, cost_kop = ${Math.round(b.costRub * 100)}, is_active = ${b.isActive} where id = ${id} returning id`;
    if (!r.length) throw notFound();
    await audit(a, req, 'ad.update', 'partner', id, b);
    return { ok: true };
  });
}
