import { appNoticeDraft, appNoticeSchema } from '../../services/appNotices.js';
import { recentOutages, statusView, syncStatusServers } from '../../services/serverStatus.js';
import { OPERATOR_LABEL, activeNetIssues, lastServerProbes, netStatus } from '../../services/netprobe.js';
import { attentionFor } from '../../services/attention.js';
import { adminUserLte } from '../../services/adminUserLte.js';
import { lteActivity, lteActivityHistory } from '../../services/lteActivity.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, type AdminRole } from '@vpn/shared';
import { sql } from '../../db/index.js';
import type { AdminRow, PaymentRow, PlanRow, PromoRow, UserRow } from '../../db/types.js';
import { audit, requireAdmin } from '../../lib/auth.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { signAdminToken, verifyToken } from '../../lib/jwt.js';
import { sendTelegramMessage } from '../../lib/telegram.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../../lib/totp.js';
import { SEGMENTS, countSegment, enqueueBroadcast, type Segment } from '../../services/broadcast.js';
import { applyProviderStatus, fulfillPayment, syncWithProvider } from '../../services/payments.js';
import { normalizeCode } from '../../services/promo.js';
import { remnawave } from '../../services/remnawave.js';
import { GROUPS, MASK, getSettingsMasked, setSettings, type GroupName } from '../../services/settings.js';
import { overview } from '../../services/stats.js';
import { activityOverview } from '../../services/activity.js';
import { extendDays, getSubscriptionDTO, resetSubscriptionLink, setBanned } from '../../services/subscriptions.js';
import { yookassa } from '../../services/yookassa.js';
import { platega } from '../../services/platega.js';
import { rollypay } from '../../services/rollypay.js';
import { reconcile } from '../../services/reconcile.js';
import { restoreState, startRestore } from '../../services/restore.js';
import { toPlanDTO } from '../../services/plans.js';
import { config } from '../../config.js';
import { adminFeatureRoutes } from './features.js';
import { adminSupportRoutes } from './support.js';
import { adminCampaignRoutes } from './campaigns.js';
import { adminNetworkIntelligenceRoutes } from './networkIntelligence.js';
import { adminAnalyticsRoutes } from './analytics.js';
import { adminContestRoutes } from './contests.js';
import { adminAdsRoutes } from './ads.js';
import { adminClosureRoutes } from './closure.js';

const page = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

export async function adminRoutes(app: FastifyInstance) {
  // ---------- Вход ----------
  app.post('/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional(), remember: z.boolean().optional() }).parse(req.body);
    const [a] = await sql()<AdminRow[]>`select * from admins where email = ${b.email.toLowerCase()}`;
    const ok = a ? await verifyPassword(b.password, a.password_hash) : (await hashPassword('x'), false);
    if (!a || !ok) throw unauthorized('Неверный email или пароль');
    if (a.totp_enabled) {
      if (!b.totp) return { needTotp: true };
      if (!a.totp_secret || !verifyTotp(a.totp_secret, b.totp)) throw unauthorized('Неверный код 2FA');
    }
    await sql()`update admins set last_login_at = now() where id = ${a.id}`;
    await audit(a, req, 'login');
    return { accessToken: await signAdminToken(a.id, a.role, { remember: b.remember, epoch: a.session_epoch }), remember: Boolean(b.remember), admin: { id: a.id, email: a.email, role: a.role, totpEnabled: a.totp_enabled } };
  });

  // Продление сессии: пока админ работает, клиент периодически обменивает токен на свежий — из админки не выбивает
  app.post('/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const a = await requireAdmin(req);
    const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const v = t ? await verifyToken(t, 'admin') : null;
    if (!v) throw unauthorized();
    return { accessToken: await signAdminToken(a.id, a.role, { remember: v.rem, epoch: a.session_epoch }), remember: Boolean(v.rem) };
  });

  // Выйти на всех устройствах: все выданные токены этого админа перестают действовать
  app.post('/auth/logout-all', async (req) => {
    const a = await requireAdmin(req);
    await sql()`update admins set session_epoch = session_epoch + 1 where id = ${a.id}`;
    await audit(a, req, 'logout.all');
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const a = await requireAdmin(req);
    return { id: a.id, email: a.email, role: a.role, totpEnabled: a.totp_enabled, tgId: a.tg_id };
  });

  app.post('/me/password', async (req) => {
    const a = await requireAdmin(req);
    const b = z.object({ current: z.string(), next: z.string().min(10, 'Минимум 10 символов') }).parse(req.body);
    if (!(await verifyPassword(b.current, a.password_hash))) throw unauthorized('Текущий пароль неверен');
    const [{ session_epoch }] = await sql()<{ session_epoch: number }[]>`update admins set password_hash = ${await hashPassword(b.next)}, session_epoch = session_epoch + 1 where id = ${a.id} returning session_epoch`;
    await audit(a, req, 'password.change');
    // остальные устройства выходят, текущая сессия продолжается с новым токеном
    const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const v = t ? await verifyToken(t, 'admin') : null;
    return { ok: true, accessToken: v ? await signAdminToken(a.id, a.role, { remember: v.rem, epoch: session_epoch }) : undefined };
  });

  app.post('/me/2fa/setup', async (req) => {
    const a = await requireAdmin(req);
    if (a.totp_enabled) throw conflict('2FA уже включена');
    const secret = generateTotpSecret();
    await sql()`update admins set totp_secret = ${secret} where id = ${a.id}`;
    return { secret, uri: totpUri(secret, a.email, 'VPN Admin') };
  });

  app.post('/me/2fa/enable', async (req) => {
    const a = await requireAdmin(req);
    const { code } = z.object({ code: z.string() }).parse(req.body);
    if (!a.totp_secret || !verifyTotp(a.totp_secret, code)) throw badRequest('Неверный код');
    await sql()`update admins set totp_enabled = true where id = ${a.id}`;
    await audit(a, req, '2fa.enable');
    return { ok: true };
  });

  app.post('/me/2fa/disable', async (req) => {
    const a = await requireAdmin(req);
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (!(await verifyPassword(password, a.password_hash))) throw unauthorized('Неверный пароль');
    await sql()`update admins set totp_enabled = false, totp_secret = null where id = ${a.id}`;
    await audit(a, req, '2fa.disable');
    return { ok: true };
  });

  // ---------- Статистика ----------
  app.get('/stats/overview', async (req) => {
    await requireAdmin(req);
    return overview();
  });

  // ---------- Статус серверов ----------
  app.get('/status-servers', async (req) => {
    await requireAdmin(req, 'analyst');
    const rows = await sql()`select s.*, m.status, m.since from status_servers s left join monitor_state m on m.target = 'node:' || s.node_uuid order by s.sort, s.title`;
    const plans = await sql()`select id, name from plans order by sort, name`;
    return {
      settings: await getSettingsMasked('statuspage'),
      servers: rows.map((r) => ({ id: r.id, nodeUuid: r.node_uuid, title: r.title, group: r.grp, sort: r.sort, visible: r.visible, planIds: r.plan_ids ?? [], status: r.status ?? 'unknown', since: r.since ?? null })),
      plans,
      outages: await recentOutages(),
      preview: await statusView(),
    };
  });
  app.post('/status-servers/sync', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const added = await syncStatusServers().catch((e) => { throw badRequest('Не удалось получить ноды из Remnawave: ' + (e as Error).message); });
    await audit(a, req, 'status.sync', 'status', 'servers', { added });
    return { added };
  });
  app.put('/status-servers/settings', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const body = z.record(z.unknown()).parse(req.body);
    const r = await setSettings('statuspage', body).catch((e) => {
      if (e instanceof z.ZodError) throw badRequest(e.issues[0]?.message ?? 'Некорректные настройки');
      throw e;
    });
    await audit(a, req, 'status.settings', 'settings', 'statuspage', { keys: Object.keys(body) });
    return r;
  });
  app.put('/status-servers/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ title: z.string().trim().min(1).max(80), group: z.enum(['location', 'bridge', 'lte']), sort: z.number().int().min(0).max(100000), visible: z.boolean(), planIds: z.array(z.string().uuid()).max(50).default([]) }).parse(req.body);
    const [r] = await sql()`update status_servers set title = ${b.title}, grp = ${b.group}, sort = ${b.sort}, visible = ${b.visible}, plan_ids = ${b.planIds.length ? b.planIds : null} where id = ${id} returning id`;
    if (!r) throw notFound('Сервер не найден');
    await audit(a, req, 'status.server', 'status', id, b);
    return { ok: true };
  });
  app.delete('/status-servers/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await sql()`delete from status_servers where id = ${id}`;
    await audit(a, req, 'status.server.delete', 'status', id);
    return { ok: true };
  });

  app.get('/net', async (req) => {
    await requireAdmin(req, 'analyst');
    const q = z.object({ minutes: z.coerce.number().int().min(10).max(1440).default(30) }).parse(req.query);
    return { settings: await getSettingsMasked('netprobe'), labels: OPERATOR_LABEL, rows: await netStatus(q.minutes), issues: await activeNetIssues(), probes: await lastServerProbes() };
  });
  app.put('/net/settings', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const body = z.record(z.unknown()).parse(req.body);
    const r = await setSettings('netprobe', body).catch((e) => {
      if (e instanceof z.ZodError) throw badRequest(e.issues[0]?.message ?? 'Некорректные настройки');
      throw e;
    });
    await audit(a, req, 'netprobe.settings', 'settings', 'netprobe', { keys: Object.keys(body) });
    return r;
  });

  app.get('/attention', async (req) => {
    const a = await requireAdmin(req);
    return attentionFor(a.role as AdminRole);
  });

  app.get('/activity', async (req) => {
    await requireAdmin(req, 'analyst');
    return activityOverview();
  });

  // ---------- Пользователи ----------
  const lteActivityPage = page.extend({ days: z.coerce.number().int().min(1).max(90).default(7) });
  app.get('/lte-activity', async req => {
    await requireAdmin(req);
    const query = lteActivityPage.extend({ q: z.string().max(100).default(''), mode: z.enum(['active', 'history']).default('active') }).parse(req.query);
    return lteActivity(query);
  });
  app.get('/lte-activity/:rwId', async req => {
    await requireAdmin(req);
    const { rwId } = z.object({ rwId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).parse(req.params);
    return lteActivityHistory(rwId, lteActivityPage.parse(req.query));
  });
  app.get('/users', async (req) => {
    await requireAdmin(req);
    const q = page.extend({ q: z.string().optional(), filter: z.enum(['all', 'active', 'trial', 'expired', 'none', 'banned']).default('all') }).parse(req.query);
    const db = sql();
    const search = q.q?.trim();
    const where = db`
      ${search ? db`(u.username ilike ${'%' + search + '%'} or u.first_name ilike ${'%' + search + '%'} or u.email ilike ${'%' + search + '%'} or u.tg_id::text = ${search} or u.id::text = ${search})` : db`true`}
      and ${
        q.filter === 'active' ? db`s.expires_at > now() and not s.is_trial`
        : q.filter === 'trial' ? db`s.expires_at > now() and s.is_trial`
        : q.filter === 'expired' ? db`s.expires_at <= now()`
        : q.filter === 'none' ? db`s.user_id is null`
        : q.filter === 'banned' ? db`u.status = 'banned'`
        : db`true`}`;
    const [{ total }] = await db`select count(*)::int as total from users u left join subscriptions s on s.user_id = u.id where ${where}`;
    const rows = await db`
      select u.id, u.tg_id, u.username, u.first_name, u.balance, u.status, u.created_at, u.bot_blocked,
             s.expires_at, s.is_trial, s.plan_name, s.traffic_used_bytes
      from users u left join subscriptions s on s.user_id = u.id
      where ${where} order by u.created_at desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`;
    return { total, page: q.page, limit: q.limit, items: rows };
  });

  app.get('/users/:id/lte',async req=>{await requireAdmin(req);const {id}=z.object({id:z.string().uuid()}).parse(req.params);const {page}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);return adminUserLte(id,page);});
  app.get('/users/:id', async (req) => {
    await requireAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [u] = await sql()<UserRow[]>`select * from users where id = ${id}`;
    if (!u) throw notFound();
    const payments = await sql()`select id, provider, purpose, amount, status, plan_name, created_at, paid_at, fulfilled_at, fulfill_error from payments where user_id = ${id} order by created_at desc limit 30`;
    const tx = await sql()`select type, amount, balance_after, note, created_at from transactions where user_id = ${id} order by created_at desc limit 30`;
    const [ref] = await sql()`select count(*)::int as invited from users where referrer_id = ${id}`;
    return { user: u, subscription: await getSubscriptionDTO(u, { live: true }), payments, transactions: tx, invited: ref!.invited };
  });

  app.post('/users/:id/extend', async (req) => {
    const a = await requireAdmin(req, 'support');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { days } = z.object({ days: z.number().int().min(-3650).max(3650).refine((d) => d !== 0) }).parse(req.body);
    if (a.role === 'support' && (days < 0 || days > 30)) throw forbidden('Поддержка может выдавать до 30 дней');
    if (days < 0) throw badRequest('Для уменьшения срока используйте панель Remnawave');
    const r = await extendDays(id, days);
    await audit(a, req, 'user.extend', 'user', id, { days });
    return { expiresAt: r.expiresAt };
  });

  app.post('/users/:id/ban', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { banned } = z.object({ banned: z.boolean() }).parse(req.body);
    await setBanned(id, banned);
    await audit(a, req, banned ? 'user.ban' : 'user.unban', 'user', id);
    return { ok: true };
  });

  app.post('/users/:id/balance', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ amount: z.number().int().refine((x) => x !== 0), note: z.string().max(200).optional() }).parse(req.body);
    const bal = await sql().begin(async (tx) => {
      const [u] = await tx`select balance from users where id = ${id} for update`;
      if (!u) throw notFound();
      if (u.balance + b.amount < 0) throw conflict('Баланс не может стать отрицательным');
      const left = u.balance + b.amount;
      await tx`update users set balance = ${left} where id = ${id}`;
      await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${id}, 'manual', ${b.amount}, ${left}, ${b.note ?? `Корректировка (${a.email})`})`;
      return left;
    });
    await audit(a, req, 'user.balance', 'user', id, b);
    return { balance: bal };
  });

  app.post('/users/:id/reset-link', async (req) => {
    const a = await requireAdmin(req, 'support');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const subUrl = await resetSubscriptionLink(id);
    await audit(a, req, 'user.reset-link', 'user', id);
    return { subUrl };
  });

  app.post('/users/:id/grant-plan', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.body);
    const [plan] = await sql()<PlanRow[]>`select * from plans where id = ${planId}`;
    if (!plan) throw notFound('Тариф не найден');
    const { grantAccess } = await import('../../services/subscriptions.js');
    const { rwErrorToHttp } = await import('../../services/remnawave.js');
    await sql()
      .begin((tx) =>
        grantAccess(tx, id, { days: plan.duration_days, trafficLimitBytes: plan.traffic_limit_gb * 1024 ** 3, deviceLimit: plan.device_limit, planId: plan.id, planName: plan.name, isTrial: false }),
      )
      .catch(rwErrorToHttp);
    await audit(a, req, 'user.grant-plan', 'user', id, { planId });
    return { ok: true };
  });

  // ---------- Тарифы ----------
  const planBody = z.object({
    name: z.string().min(1).max(60),
    description: z.string().max(300).default(''),
    durationDays: z.number().int().min(1).max(3650),
    trafficLimitGb: z.number().int().min(0).default(0),
    deviceLimit: z.number().int().min(0).max(100).default(3),
    price: z.number().int().min(0),
    oldPrice: z.number().int().min(0).nullish(),
    badge: z.string().max(24).nullish(),
    sort: z.number().int().default(0),
    isActive: z.boolean().default(true),
  });

  app.get('/plans', async (req) => {
    await requireAdmin(req);
    const rows = await sql()<PlanRow[]>`select * from plans order by sort, price`;
    return rows.map(toPlanDTO);
  });
  app.post('/plans', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = planBody.parse(req.body);
    const [p] = await sql()<PlanRow[]>`insert into plans (name, description, duration_days, traffic_limit_gb, device_limit, price, old_price, badge, sort, is_active)
      values (${b.name}, ${b.description}, ${b.durationDays}, ${b.trafficLimitGb}, ${b.deviceLimit}, ${b.price}, ${b.oldPrice ?? null}, ${b.badge ?? null}, ${b.sort}, ${b.isActive}) returning *`;
    await audit(a, req, 'plan.create', 'plan', p!.id, b);
    return toPlanDTO(p!);
  });
  app.put('/plans/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = planBody.parse(req.body);
    const [p] = await sql()<PlanRow[]>`update plans set name = ${b.name}, description = ${b.description}, duration_days = ${b.durationDays}, traffic_limit_gb = ${b.trafficLimitGb},
      device_limit = ${b.deviceLimit}, price = ${b.price}, old_price = ${b.oldPrice ?? null}, badge = ${b.badge ?? null}, sort = ${b.sort}, is_active = ${b.isActive} where id = ${id} returning *`;
    if (!p) throw notFound();
    await audit(a, req, 'plan.update', 'plan', id, b);
    return toPlanDTO(p);
  });
  app.delete('/plans/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await sql()`delete from plans where id = ${id}`; // платежи/подписки сохраняют снимок названия
    await audit(a, req, 'plan.delete', 'plan', id);
    return { ok: true };
  });

  // ---------- Платежи ----------
  app.get('/payments', async (req) => {
    await requireAdmin(req);
    const q = page.extend({ status: z.string().optional(), provider: z.string().optional(), q: z.string().optional() }).parse(req.query);
    const db = sql();
    const where = db`${q.status ? db`p.status = ${q.status}` : db`true`} and ${q.provider ? db`p.provider = ${q.provider}` : db`true`}
      and ${q.q ? db`(u.username ilike ${'%' + q.q + '%'} or u.tg_id::text = ${q.q} or p.external_id = ${q.q} or p.id::text = ${q.q})` : db`true`}`;
    const [{ total }] = await db`select count(*)::int as total from payments p join users u on u.id = p.user_id where ${where}`;
    const rows = await db`select p.id, p.provider, p.method, p.purpose, p.amount, p.discount, p.status, p.plan_name, p.external_id, p.created_at, p.paid_at, p.fulfilled_at, p.fulfill_error,
        u.id as user_id, u.username, u.tg_id, u.first_name
      from payments p join users u on u.id = p.user_id where ${where} order by p.created_at desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`;
    return { total, page: q.page, limit: q.limit, items: rows };
  });

  app.get('/payments/export.csv', async (req, reply) => {
    await requireAdmin(req, 'admin');
    const rows = await sql()`select p.created_at, p.provider, p.method, p.purpose, p.plan_name, p.amount, p.status, p.external_id, u.tg_id, u.username
      from payments p join users u on u.id = p.user_id order by p.created_at desc limit 20000`;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['date,provider,method,purpose,plan,amount_rub,status,external_id,tg_id,username', ...rows.map((r) =>
      [r.created_at.toISOString(), r.provider, r.method, r.purpose, r.plan_name, (r.amount / 100).toFixed(2), r.status, r.external_id, r.tg_id, r.username].map(esc).join(','))].join('\n');
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="payments.csv"');
    return csv;
  });

  app.post('/payments/reconcile', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { days } = z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(req.body ?? {});
    const result = await reconcile(days);
    await audit(a, req, 'payments.reconcile', 'payments', undefined, { days, fixed: result.map((r) => ({ p: r.provider, fixed: r.fixed })) });
    return { days, results: result };
  });

  app.post('/payments/:id/recheck', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [p] = await sql()<PaymentRow[]>`select * from payments where id = ${id}`;
    if (!p) throw notFound();
    if (p.status === 'succeeded') await fulfillPayment(id);
    else await syncWithProvider(p);
    await audit(a, req, 'payment.recheck', 'payment', id);
    const [n] = await sql()`select status, fulfilled_at, fulfill_error from payments where id = ${id}`;
    return n;
  });

  app.post('/payments/:id/mark-paid', async (req) => {
    const a = await requireAdmin(req, 'owner');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [p] = await sql()<PaymentRow[]>`select * from payments where id = ${id}`;
    if (!p) throw notFound();
    await applyProviderStatus(id, 'succeeded');
    await audit(a, req, 'payment.mark-paid', 'payment', id);
    return { ok: true };
  });

  // ---------- Промокоды ----------
  const promoBody = z.object({
    code: z.string().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/, 'Только латиница, цифры, _ и -'),
    type: z.enum(['percent', 'fixed', 'days', 'balance']),
    value: z.number().int().positive(),
    maxUses: z.number().int().positive().nullish(),
    expiresAt: z.string().datetime().nullish(),
    isActive: z.boolean().default(true),
  });
  const promoOut = (p: PromoRow) => ({ id: p.id, code: p.code, type: p.type, value: p.value, maxUses: p.max_uses, used: p.used, expiresAt: p.expires_at, isActive: p.is_active, createdAt: p.created_at });

  app.get('/promo', async (req) => {
    await requireAdmin(req);
    return (await sql()<PromoRow[]>`select * from promo_codes order by created_at desc`).map(promoOut);
  });
  app.post('/promo', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = promoBody.parse(req.body);
    if (b.type === 'percent' && b.value > 100) throw badRequest('Процент не может быть больше 100');
    try {
      const [p] = await sql()<PromoRow[]>`insert into promo_codes (code, type, value, max_uses, expires_at, is_active)
        values (${normalizeCode(b.code)}, ${b.type}, ${b.value}, ${b.maxUses ?? null}, ${b.expiresAt ?? null}, ${b.isActive}) returning *`;
      await audit(a, req, 'promo.create', 'promo', p!.id, b);
      return promoOut(p!);
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('Такой промокод уже существует');
      throw e;
    }
  });
  app.put('/promo/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ maxUses: z.number().int().positive().nullish(), expiresAt: z.string().datetime().nullish(), isActive: z.boolean() }).parse(req.body);
    const [p] = await sql()<PromoRow[]>`update promo_codes set max_uses = ${b.maxUses ?? null}, expires_at = ${b.expiresAt ?? null}, is_active = ${b.isActive} where id = ${id} returning *`;
    if (!p) throw notFound();
    await audit(a, req, 'promo.update', 'promo', id, b);
    return promoOut(p);
  });
  app.delete('/promo/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await sql()`delete from promo_codes where id = ${id}`;
    await audit(a, req, 'promo.delete', 'promo', id);
    return { ok: true };
  });

  // ---------- Рассылки ----------
  app.post('/broadcasts/app-notice',async req=>{await requireAdmin(req,'admin');return appNoticeDraft(appNoticeSchema.parse(req.body));});
  app.get('/broadcasts', async (req) => {
    await requireAdmin(req);
    return { segments: SEGMENTS, items: await sql()`select * from broadcasts order by created_at desc limit 50` };
  });
  app.get('/broadcasts/preview', async (req) => {
    await requireAdmin(req);
    const { segment } = z.object({ segment: z.string() }).parse(req.query);
    if (!(segment in SEGMENTS)) throw badRequest('Неизвестный сегмент');
    return { count: await countSegment(segment as Segment) };
  });
  const bcBody = z.object({
    text: z.string().min(1).max(3500),
    segment: z.string(),
    buttonText: z.string().max(40).nullish(),
    buttonUrl: z.string().url().refine(v=>/^https?:\/\//i.test(v),'Нужна ссылка HTTPS или HTTP').nullish(),
  });
  app.post('/broadcasts', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = bcBody.parse(req.body);
    if (!(b.segment in SEGMENTS)) throw badRequest('Неизвестный сегмент');
    if(Boolean(b.buttonText)!==Boolean(b.buttonUrl))throw badRequest('Укажите текст и ссылку кнопки вместе');
    const [row] = await sql()`insert into broadcasts (admin_email, text, button_text, button_url, segment) values (${a.email}, ${b.text}, ${b.buttonText ?? null}, ${b.buttonUrl ?? null}, ${b.segment}) returning *`;
    await enqueueBroadcast(row!.id);
    await audit(a, req, 'broadcast.create', 'broadcast', row!.id, { segment: b.segment });
    return row;
  });
  app.post('/broadcasts/test', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = bcBody.omit({segment:true}).extend({tgId:z.number().int().optional()}).parse(req.body);
    const target=b.tgId??a.tg_id;if(!target)throw badRequest('Привяжите Telegram ID администратора');
    if(Boolean(b.buttonText)!==Boolean(b.buttonUrl))throw badRequest('Укажите текст и ссылку кнопки вместе');
    const r = await sendTelegramMessage(target, b.text,b.buttonText&&b.buttonUrl?[[{text:b.buttonText,url:b.buttonUrl}]]:undefined);
    if (!r.ok) throw badRequest(`Не удалось отправить: ${r.error}`);
    return { ok: true };
  });

  // ---------- Ноды (из Remnawave) ----------
  app.get('/nodes', async (req) => {
    await requireAdmin(req);
    if (!(await remnawave.isConfigured())) return { configured: false, items: [] };
    try {
      const nodes = await remnawave.listNodes();
      return {
        configured: true,
        items: nodes.map((n) => ({ id: n.uuid, name: n.name, address: n.address, countryCode: n.countryCode, online: Boolean(n.isConnected), disabled: Boolean(n.isDisabled), usersOnline: n.usersOnline ?? 0 })),
      };
    } catch (e) {
      return { configured: true, error: (e as Error).message, items: [] };
    }
  });

  // ---------- Настройки ----------
  app.get('/settings', async (req) => {
    await requireAdmin(req, 'admin');
    const out: Record<string, unknown> = {};
    for (const g of Object.keys(GROUPS) as GroupName[]) out[g] = await getSettingsMasked(g);
    return {
      settings: out,
      webhooks: { yookassa: `${config().API_URL}/api/v1/webhooks/yookassa`, platega: `${config().API_URL}/api/v1/webhooks/platega`, rollypay: `${config().API_URL}/api/v1/webhooks/rollypay` },
      env: { remnawaveFromEnv: Boolean(config().REMNAWAVE_URL && config().REMNAWAVE_TOKEN), botUsername: config().BOT_USERNAME, botConfigured: Boolean(config().BOT_TOKEN) },
      mask: MASK,
    };
  });

  app.put('/settings/:group', async (req) => {
    const a = await requireAdmin(req, 'owner');
    const { group } = z.object({ group: z.enum(Object.keys(GROUPS) as [GroupName, ...GroupName[]]) }).parse(req.params);
    const body = z.record(z.unknown()).parse(req.body);
    const result = await setSettings(group, body).catch((e) => {
      if (e instanceof z.ZodError) throw badRequest(e.issues[0]?.message ?? 'Некорректные настройки');
      throw e;
    });
    await audit(a, req, 'settings.update', 'settings', group, { keys: Object.keys(body) });
    return result;
  });

  // ---------- Восстановление пользователей в новой панели Remnawave ----------
  app.get('/remnawave/restore', async (req) => {
    await requireAdmin(req, 'owner');
    // адрес, с которого раньше раздавались подписки: в новой панели SUB_PUBLIC_DOMAIN должен быть тем же, тогда ссылки клиентов продолжат работать
    const [s] = await sql()<{ sub_url: string }[]>`select sub_url from subscriptions where sub_url is not null order by updated_at desc limit 1`;
    let oldSubHost: string | null = null;
    try { oldSubHost = s ? new URL(s.sub_url).origin + new URL(s.sub_url).pathname.replace(/[^/]+$/, '') : null; } catch { /* ignore */ }
    return { ...restoreState(), oldSubHost };
  });
  app.post('/remnawave/restore', async (req) => {
    const a = await requireAdmin(req, 'owner');
    const b = z.object({ dryRun: z.boolean().default(true), includeExpired: z.boolean().default(false) }).parse(req.body ?? {});
    try {
      const st = await startRestore(b);
      await audit(a, req, b.dryRun ? 'remnawave.restore.preview' : 'remnawave.restore.run', 'remnawave', undefined, b);
      return st;
    } catch (e) {
      throw conflict((e as Error).message);
    }
  });

  app.post('/settings/test/:target', async (req) => {
    await requireAdmin(req, 'owner');
    const { target } = z.object({ target: z.enum(['yookassa', 'platega', 'rollypay', 'remnawave']) }).parse(req.params);
    try {
      if (target === 'yookassa') await yookassa.ping();
      else if (target === 'platega') await platega.ping();
      else if (target === 'rollypay') await rollypay.ping();
      else {
        const p = await remnawave.ping();
        // панель отвечает, но основной сквад не настроен/не найден — понятная проблема по-русски
        if (p.squadProblem) return { ok: false, error: p.squadProblem, ...p };
        return { ok: true, ...p };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as any).detail ?? (e as Error).message };
    }
  });

  // ---------- Администраторы и аудит ----------
  app.get('/admins', async (req) => {
    await requireAdmin(req, 'owner');
    return sql()`select id, email, role, totp_enabled, tg_id, created_at, last_login_at from admins order by created_at`;
  });
  app.post('/admins', async (req) => {
    const a = await requireAdmin(req, 'owner');
    const b = z.object({ email: z.string().email(), password: z.string().min(10), role: z.enum(ADMIN_ROLES), tgId: z.number().int().positive().nullish() }).parse(req.body);
    try {
      const [n] = await sql()`insert into admins (email, password_hash, role, tg_id) values (${b.email.toLowerCase()}, ${await hashPassword(b.password)}, ${b.role}, ${b.tgId ?? null}) returning id, email, role`;
      await audit(a, req, 'admin.create', 'admin', n!.id, { email: b.email, role: b.role });
      return n;
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('Админ с таким email уже есть');
      throw e;
    }
  });
  app.put('/admins/:id/telegram', async (req) => {
    const a = await requireAdmin(req, 'owner');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { tgId } = z.object({ tgId: z.number().int().positive().nullable() }).parse(req.body);
    try {
      const r = await sql()`update admins set tg_id = ${tgId} where id = ${id} returning id`;
      if (!r.length) throw notFound();
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('Этот Telegram ID уже привязан к другому админу');
      throw e;
    }
    await audit(a, req, 'admin.telegram', 'admin', id, { tgId });
    return { ok: true };
  });
  app.delete('/admins/:id', async (req) => {
    const a = await requireAdmin(req, 'owner');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === a.id) throw badRequest('Нельзя удалить самого себя');
    await sql()`delete from admins where id = ${id}`;
    await audit(a, req, 'admin.delete', 'admin', id);
    return { ok: true };
  });
  app.get('/audit', async (req) => {
    await requireAdmin(req, 'admin');
    const q = page.parse(req.query);
    const [{ total }] = await sql()`select count(*)::int as total from audit_log`;
    const items = await sql()`select * from audit_log order by created_at desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`;
    return { total, page: q.page, limit: q.limit, items };
  });

  await adminFeatureRoutes(app);
  await adminSupportRoutes(app);
  await adminCampaignRoutes(app);
  await adminNetworkIntelligenceRoutes(app);
  await adminAnalyticsRoutes(app);
  await adminContestRoutes(app);
  await adminAdsRoutes(app);
  await adminClosureRoutes(app);
}
