import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../db/index.js';
import { audit, requireAdmin } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';
import { badRequest } from '../../lib/errors.js';
import { botLink, cancelContest, contestChannel, createContest, createPost, defaultPostText, finishContest, getContest, prizeLabel, publishContest } from '../../services/contests.js';

const idP = z.object({ id: z.string().uuid() });
const dt = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const contestBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).default(''),
  prizeKind: z.enum(['days', 'balance', 'discount', 'manual']),
  /** days — дни, balance — рубли, discount — проценты */
  prizeValue: z.number().int().min(0).max(1_000_000).default(0),
  prizeText: z.string().trim().max(200).default(''),
  winnersCount: z.number().int().min(1).max(100).default(1),
  requireChannel: z.boolean().default(true),
  endsAt: dt,
  postText: z.string().trim().max(900).default(''),
});
const toValue = (b: z.infer<typeof contestBody>) => (b.prizeKind === 'balance' ? b.prizeValue * 100 : b.prizeValue);

const PRESETS = {
  week: { title: 'Неделя бесплатного VPN', prizeKind: 'days' as const, prizeValue: 7, winnersCount: 5, hours: 72 },
  month: { title: 'Месяц VPN в подарок', prizeKind: 'days' as const, prizeValue: 30, winnersCount: 3, hours: 96 },
  cash: { title: 'Бонус 300 ₽ на баланс', prizeKind: 'balance' as const, prizeValue: 30000, winnersCount: 5, hours: 72 },
  promo: { title: 'Скидка 50% на продление', prizeKind: 'discount' as const, prizeValue: 50, winnersCount: 10, hours: 48 },
};

export async function adminContestRoutes(app: FastifyInstance) {
  app.get('/contests', async (req) => {
    await requireAdmin(req, 'analyst');
    const rows = await sql()`select c.*, (select count(*)::int from contest_entries e where e.contest_id = c.id) as entries,
      (select count(*)::int from contest_winners w where w.contest_id = c.id) as winners from contests c order by c.created_at desc limit 100`;
    return {
      channel: await contestChannel(),
      items: rows.map((c: any) => ({ id: c.id, code: c.code, title: c.title, status: c.status, prize: prizeLabel(c), winnersCount: c.winners_count, entries: c.entries, winners: c.winners, endsAt: c.ends_at.toISOString(), link: botLink(`c_${c.code}`) })),
    };
  });

  app.get('/contests/:id', async (req) => {
    await requireAdmin(req, 'analyst');
    const { id } = idP.parse(req.params);
    const c = await getContest(id);
    const [n] = await sql()`select count(*)::int as n from contest_entries where contest_id = ${id}`;
    const w = await sql()`select w.place, w.prize_status, w.note, w.user_id, u.username, u.first_name, u.tg_id from contest_winners w join users u on u.id = w.user_id where w.contest_id = ${id} order by w.place`;
    const posts = await sql()`select id, kind, status, error, scheduled_at, sent_at from channel_posts where contest_id = ${id} order by created_at desc`;
    return {
      id: c.id, code: c.code, title: c.title, description: c.description, status: c.status, prizeKind: c.prize_kind, prizeValue: c.prize_kind === 'balance' ? Number(c.prize_value) / 100 : Number(c.prize_value),
      prizeText: c.prize_text, winnersCount: c.winners_count, requireChannel: c.require_channel, endsAt: c.ends_at.toISOString(), entries: n!.n,
      postPreview: c.post_text.trim() || defaultPostText(c), link: botLink(`c_${c.code}`),
      winners: w.map((x: any) => ({ place: x.place, status: x.prize_status, note: x.note, userId: x.user_id, username: x.username, firstName: x.first_name, tgId: x.tg_id ? String(x.tg_id) : null })),
      posts: posts.map((p: any) => ({ id: p.id, kind: p.kind, status: p.status, error: p.error, scheduledAt: p.scheduled_at.toISOString(), sentAt: p.sent_at ? p.sent_at.toISOString() : null })),
    };
  });

  app.post('/contests', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = contestBody.parse(req.body);
    const id = await createContest({ title: b.title, description: b.description, prizeKind: b.prizeKind, prizeValue: toValue(b), prizeText: b.prizeText, winnersCount: b.winnersCount, requireChannel: b.requireChannel, endsAt: b.endsAt, postText: b.postText, by: String(a.id) });
    await audit(a, req, 'contest.create', 'contest', id, { title: b.title });
    return { id };
  });

  // один клик: пресет → создать и сразу опубликовать в канал
  app.post('/contests/quick', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({ preset: z.enum(['week', 'month', 'cash', 'promo']), title: z.string().trim().max(120).optional(), hours: z.number().int().min(1).max(24 * 30).optional() }).parse(req.body);
    const p = PRESETS[b.preset];
    const id = await createContest({ title: b.title || p.title, prizeKind: p.prizeKind, prizeValue: p.prizeValue, winnersCount: p.winnersCount, requireChannel: true, endsAt: new Date(Date.now() + (b.hours ?? p.hours) * 3600_000), by: String(a.id) });
    const pub = await publishContest(id, { by: String(a.id) });
    await audit(a, req, 'contest.quick', 'contest', id, { preset: b.preset, postStatus: pub.postStatus });
    return { id, ...pub };
  });

  app.post('/contests/:id/publish', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idP.parse(req.params);
    const b = z.object({ scheduleAt: dt.optional() }).parse(req.body ?? {});
    const r = await publishContest(id, { scheduleAt: b.scheduleAt, by: String(a.id) });
    await audit(a, req, 'contest.publish', 'contest', id, { postStatus: r.postStatus });
    return r;
  });

  app.post('/contests/:id/finish', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idP.parse(req.params);
    const r = await finishContest(id);
    if (!r) throw badRequest('Конкурс не активен — итоги подводятся только для активных');
    await audit(a, req, 'contest.finish', 'contest', id, { winners: r.winners.length });
    return r;
  });

  app.post('/contests/:id/cancel', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idP.parse(req.params);
    await cancelContest(id);
    await audit(a, req, 'contest.cancel', 'contest', id, {});
    return { ok: true };
  });

  app.post('/contests/:id/winners/:userId/issued', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const p = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
    const r = await sql()`update contest_winners set prize_status = 'manual_issued' where contest_id = ${p.id} and user_id = ${p.userId} and prize_status = 'manual_pending' returning 1`;
    if (!r.length) throw notFound('Победитель не найден или приз уже выдан');
    await audit(a, req, 'contest.issued', 'contest', p.id, { userId: p.userId });
    return { ok: true };
  });

  /* ---------- посты в канал ---------- */
  app.get('/channel-posts', async (req) => {
    await requireAdmin(req, 'analyst');
    const rows = await sql()`select id, kind, status, error, text, scheduled_at, sent_at, ad_id from channel_posts order by created_at desc limit 50`;
    return { channel: await contestChannel(), items: rows.map((p: any) => ({ id: p.id, kind: p.kind, status: p.status, error: p.error, text: String(p.text).slice(0, 140), scheduledAt: p.scheduled_at.toISOString(), sentAt: p.sent_at ? p.sent_at.toISOString() : null })) };
  });

  app.post('/channel-posts', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({
      text: z.string().trim().min(2).max(3800), imageUrl: z.string().url().max(500).optional().or(z.literal('')),
      buttonText: z.string().trim().max(40).default(''), buttonUrl: z.string().url().max(500).optional().or(z.literal('')),
      adId: z.string().uuid().optional(), scheduleAt: dt.optional(),
    }).parse(req.body);
    let buttonUrl = b.buttonUrl ?? '';
    let link = botLink('');
    if (b.adId) {
      const [l] = await sql()`select code from partner_links where id = ${b.adId} and is_active`;
      if (!l) throw notFound('Рекламная ссылка не найдена');
      link = botLink(`ref_${l.code}`);
      if (!buttonUrl && b.buttonText) buttonUrl = link;
    }
    if (!buttonUrl && b.buttonText) buttonUrl = link;
    const text = b.text.replaceAll('{{link}}', link);
    const r = await createPost({ kind: 'promo', adId: b.adId ?? null, text, imageUrl: b.imageUrl || '', buttonText: b.buttonText, buttonUrl: b.buttonText ? buttonUrl : '', scheduledAt: b.scheduleAt, by: String(a.id) }, true);
    await audit(a, req, 'channel_post.create', 'channel_post', r.id, { status: r.status });
    return r;
  });

  app.delete('/channel-posts/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = idP.parse(req.params);
    const r = await sql()`update channel_posts set status = 'cancelled' where id = ${id} and status = 'scheduled' returning 1`;
    if (!r.length) throw badRequest('Отменить можно только отложенный пост');
    await audit(a, req, 'channel_post.cancel', 'channel_post', id, {});
    return { ok: true };
  });

  app.get('/post-templates', async (req) => {
    await requireAdmin(req, 'analyst');
    return POST_TEMPLATES;
  });
}

export const POST_TEMPLATES = [
  { id: 'welcome', title: 'Знакомство с сервисом', buttonText: '🚀 Подключиться', text: '🔒 <b>Быстрый и стабильный VPN</b>\n\nРаботает на телефоне и компьютере, несколько серверов на выбор, подключение за минуту.\n\nПробный период бесплатно: {{link}}' },
  { id: 'sale', title: 'Акция', buttonText: '💸 Забрать скидку', text: '🔥 <b>Скидка на подписку</b>\n\nТолько в эти дни — выгодные условия на продление и новые тарифы.\n\nНажмите кнопку ниже и выберите свой тариф.' },
  { id: 'location', title: 'Новая локация', buttonText: '🌍 Попробовать', text: '🌍 <b>Новая локация уже доступна</b>\n\nДобавили новый сервер: быстрее и стабильнее. Подписчикам он доступен автоматически — обновите подписку в приложении.' },
  { id: 'friends', title: 'Приведи друга', buttonText: '🎁 Пригласить друга', text: '🤝 <b>Приглашайте друзей — получайте бонусы</b>\n\nЗа каждого друга, который оформит подписку, вы получаете дни или деньги на баланс.' },
  { id: 'status', title: 'Технические работы', buttonText: '', text: '🛠 <b>Технические работы</b>\n\nСегодня мы обновляем часть серверов, возможны кратковременные перебои. Если что-то не работает, смените локацию в приложении или откройте «Помощь» → «Не работает?».' },
];
