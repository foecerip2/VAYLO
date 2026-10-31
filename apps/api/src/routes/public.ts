import { saveAvatar } from '../services/avatars.js';
import { BOT_CATEGORIES, recordBotActivity } from '../services/botActivity.js';
import { listGifts, receivedGifts, previewGift, updateGiftCard, rotateGift, redeemGift as redeemSubscriptionGift } from '../services/gifts.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { PaymentRow } from '../db/types.js';
import { isInternal, requireUser } from '../lib/auth.js';
import { signAdminToken } from '../lib/jwt.js';
import { addonCatalog } from '../services/addons.js';
import { listDevices, removeAllDevices, removeDevice } from '../services/devices.js';
import { NODE_AGENT_SCRIPT } from '../services/nodeAgentScript.js';
import { agentReport } from '../services/nodeip.js';
import { getWelcomeImage, welcomeImageUrl } from '../services/botwelcome.js';
import { gateStatus } from '../services/gate.js';
import { claimQuest, listQuests } from '../services/quests.js';
import { getWheel, spinWheel } from '../services/wheel.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, escapeHtml, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { alertAdminsThrottled } from '../services/alerts.js';
import { signUserToken } from '../lib/jwt.js';
import { validateInitData } from '../lib/telegram.js';
import { verifyTotp } from '../lib/totp.js';
import { availableMethods, createPayment, quote, syncWithProvider } from '../services/payments.js';
import { listPlans, toPlanDTO } from '../services/plans.js';
import { redeemGift } from '../services/promo.js';
import { myReferralTree, referralStats } from '../services/referrals.js';
import { listWithdrawals, requestWithdrawal, setReferralMode, transferRefToBalance } from '../services/refwallet.js';
import { remnawave } from '../services/remnawave.js';
import { activeFor } from '../services/campaigns.js';
import { diagnose } from '../services/diagnose.js';
import { assertSalesOpen, publicClosure } from '../services/closure.js';
import { activeContests, hasActiveContests, joinContest } from '../services/contests.js';
import { CLIENT_EVENTS, recordEvent } from '../services/analyticsEvents.js';
import { nodeRecommendationRoutes } from './nodeRecommendations.js';
import { requireProbe } from '../lib/probeAuth.js';
import { attentionFor } from '../services/attention.js';
import { statusView } from '../services/serverStatus.js';
import { probeTargets, recordClientProbes, recordServerProbes } from '../services/netprobe.js';
import { countryFromName, pointByCode, resolveGeo } from '../lib/geo.js';
import { getSettings } from '../services/settings.js';
import { getSubscriptionDTO, resetSubscriptionLink, startTrial } from '../services/subscriptions.js';
import { toMe, upsertTelegramUser } from '../services/users.js';
import type { AdminRole, NodeDTO, PaymentDTO } from '@vpn/shared';

let nodesCache: { at: number; data: NodeDTO[] } | null = null;

function paymentDTO(p: PaymentRow): PaymentDTO {
  return {
    id: p.id,
    provider: p.provider,
    gift: Boolean(p.payload?.gift),
    purpose: p.purpose,
    amount: p.amount,
    status: p.status,
    planName: p.plan_name,
    createdAt: p.created_at.toISOString(),
    paidAt: p.paid_at?.toISOString() ?? null,
  };
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/media/avatar/:token',async(req,reply)=>{const {token}=z.object({token:z.string().uuid()}).parse(req.params);const [img]=await sql()`select mime,data from user_avatars where token=${token}`;if(!img)throw notFound();return reply.header('content-type',img.mime).header('x-content-type-options','nosniff').header('cache-control','private,max-age=300').send(img.data);});
  app.put('/me/avatar',{bodyLimit:800*1024},async req=>{const u=await requireUser(req,{gate:false});const b=z.object({image:z.string().max(750000)}).parse(req.body);await saveAvatar(u.id,b.image);return {ok:true};});
  app.delete('/me/avatar',async req=>{const u=await requireUser(req,{gate:false});await sql()`delete from user_avatars where user_id=${u.id}`;return {ok:true};});
  app.post('/internal/bot-activity', async req => {
    if (!isInternal(req)) throw unauthorized();
    const body = z.object({ updateId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), category: z.enum(BOT_CATEGORIES) }).parse(req.body);
    const user = await requireUser(req, { gate: false });
    await recordBotActivity(user.id, body.updateId, body.category);
    return { ok: true };
  });

  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));

  // Картинка приветствия бота: должна быть доступна Telegram по публичной ссылке
  app.get('/media/welcome', async (_req, reply) => {
    const img = await getWelcomeImage();
    if (!img) throw notFound();
    return reply.header('content-type', img.mime).header('cache-control', 'public, max-age=300').header('x-content-type-options', 'nosniff').send(img.data);
  });

  // ---------- Агент ноды (смена IP) ----------
  app.get('/node-agent/install.sh', async (_req, reply) => reply.type('text/x-shellscript; charset=utf-8').send(NODE_AGENT_SCRIPT));
  app.post('/node-agent/report', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const t = req.headers['x-node-token'];
    if (typeof t !== 'string' || t.length < 10 || t.length > 100) throw unauthorized('Неверный токен агента');
    const r = await agentReport(t, req.ip);
    return { ok: r.ok, changed: r.changed };
  });

  app.get('/config', async () => {
    const [g, trial, ref, topup, addons, quests, ap, gate, wheel, bw, welcomeImg, sup, clientApps] = await Promise.all([
      getSettings('general'),
      getSettings('trial'),
      getSettings('referral'),
      getSettings('topup'),
      getSettings('addons'),
      getSettings('quests'),
      getSettings('appearance'),
      getSettings('gate'),
      getSettings('wheel'),
      getSettings('bot_welcome'),
      welcomeImageUrl(),
      getSettings('support'),
      getSettings('client_apps'),
    ]);
    return {
      clientApps: clientApps.entries,
      brandName: g.brand_name,
      supportInApp: sup.enabled,
      supportUrl: g.support_url || (g.support_username ? `https://t.me/${g.support_username.replace(/^@/, '')}` : ''),
      channelUrl: g.channel_url,
      termsUrl: g.terms_url,
      maintenance: g.maintenance,
      maintenanceText: g.maintenance_text,
      welcomeText: g.welcome_text,
      startText: bw.start_text,
      startImageUrl: welcomeImg,
      botUsername: config().BOT_USERNAME,
      trial: { enabled: trial.enabled, days: trial.days, trafficGb: trial.traffic_gb, devices: trial.device_limit },
      referral: { enabled: ref.enabled, days: ref.days, percent: ref.percent, level2Percent: ref.level2_percent, signupBonus: ref.signup_bonus_invitee },
      topup: { min: topup.min, max: topup.max, presets: topup.presets, bonuses: [...topup.bonuses].sort((a, b) => a.from - b.from) },
      addonsEnabled: addons.enabled,
      autoRenewEnabled: addons.auto_renew_enabled,
      questsEnabled: quests.enabled,
      wheelEnabled: wheel.enabled,
      contestsActive: await hasActiveContests(),
      closure: await publicClosure(),
      gateEnabled: gate.enabled && gate.chats.length > 0,
      appearance: { accent: ap.accent, logoUrl: ap.logo_url, banner: ap.banner_text, design: ap.miniapp_design },
    };
  });

  // ---------- Авторизация ----------
  // Лимит выше обычного: у мобильных операторов один IP на десятки людей. Подпись проверяется быстро, подбор невозможен.
  app.post('/auth/miniapp', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { initData } = z.object({ initData: z.string().min(10) }).parse(req.body);
    // Окно свежести 7 суток: на iPhone свёрнутый Mini App живёт долго и при перезагрузке страницы переиспользует прежние данные запуска.
    const r = validateInitData(initData, config().BOT_TOKEN, 7 * 86400);
    if (!r) {
      // подпись верна, но данные старше недели — просим открыть приложение заново (а не просто «ошибка»)
      if (validateInitData(initData, config().BOT_TOKEN, 3650 * 86400)) throw unauthorized('Сессия Telegram устарела. Закройте приложение и откройте его заново из бота.', 'init_expired');
      throw unauthorized('Не удалось подтвердить данные Telegram');
    }
    const ref = r.startParam?.startsWith('ref_') ? r.startParam.slice(4) : null;
    const user = await upsertTelegramUser(r.user, ref);
    return { accessToken: await signUserToken(user.id) };
  });

  // Вход на сайт через бота: сайт получает токен, пользователь подтверждает его в боте
  app.post('/auth/tglink/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { ref } = z.object({ ref: z.string().max(32).optional() }).parse(req.body ?? {});
    const token = randomToken(18);
    await sql()`delete from auth_links where expires_at < now()`;
    await sql()`insert into auth_links (token, ref_code, expires_at) values (${token}, ${ref ?? null}, now() + interval '10 minutes')`;
    const bot = config().BOT_USERNAME;
    return { token, url: bot ? `https://t.me/${bot}?start=auth_${token}` : null, expiresInSec: 600 };
  });

  app.get('/auth/tglink/:token', async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(64) }).parse(req.params);
    const [l] = await sql()`select * from auth_links where token = ${token} and expires_at > now()`;
    if (!l) return { status: 'expired' as const };
    if (!l.user_id) return { status: 'pending' as const };
    await sql()`delete from auth_links where token = ${token}`;
    return { status: 'ok' as const, accessToken: await signUserToken(l.user_id) };
  });

  app.post('/internal/tglink/confirm', async (req) => {
    if (!isInternal(req)) throw unauthorized();
    const { token } = z.object({ token: z.string().min(10).max(64) }).parse(req.body);
    const [l] = await sql()`select * from auth_links where token = ${token} and expires_at > now() and user_id is null`;
    if (!l) throw notFound('Ссылка для входа устарела');
    // пользователя создаём/находим по заголовкам x-tg-user; реф-код берём из ссылки
    req.headers['x-ref-code'] = l.ref_code ?? '';
    const user = await requireUser(req, { gate: false });
    await sql()`update auth_links set user_id = ${user.id} where token = ${token}`;
    return { ok: true };
  });

  // ---------- Профиль и подписка ----------
  // продуктовые события Mini App (за флагом PRODUCT_ANALYTICS_ENABLED); деньги отсюда не считаются
  app.post('/events', { config: { rateLimit: { max: 30, timeWindow: '1 minute' }, bodyLimit: 2048 } }, async (req) => {
    const user = await requireUser(req, { gate: false });
    const b = z.object({ eventId: z.string().trim().min(8).max(64), name: z.enum(CLIENT_EVENTS), sessionId: z.string().max(40).optional(), campaign: z.string().max(40).optional(), properties: z.record(z.unknown()).optional() }).parse(req.body);
    return { ok: true, recorded: await recordEvent({ ...b, userId: user.id }) };
  });
  // «Не работает»: автоматическая диагностика со стороны сервиса
  app.get('/diagnose', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = await requireUser(req, { gate: false });
    reply.header('cache-control', 'no-store');
    return diagnose(user, req.ip, String(req.headers['user-agent'] ?? ''));
  });
  // рекомендации локаций (за флагом NODE_RECOMMENDATIONS_ENABLED)
  await nodeRecommendationRoutes(app);
  // статус серверов для пользователей (бот и Mini App)
  app.get('/status/servers', async (req) => {
    await requireUser(req, { gate: false });
    return statusView();
  });

  // ---------- Проверки доступности из сети пользователя ----------
  app.get('/net/targets', async (req) => {
    await requireUser(req, { gate: false });
    const cfg = await getSettings('netprobe');
    return { enabled: cfg.enabled, targets: cfg.enabled ? await probeTargets() : [] };
  });
  const probeItem = z.object({ target: z.string().min(1).max(120), kind: z.enum(['sub', 'api', 'host']), ok: z.boolean(), ms: z.number().int().min(0).max(120_000).nullish() });
  app.post('/net/report', { config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } }, async (req) => {
    const user = await requireUser(req, { gate: false });
    if (!(await getSettings('netprobe')).enabled) return { ok: true, saved: 0 };
    const b = z.object({ results: z.array(probeItem).min(1).max(12) }).parse(req.body);
    // не чаще одного набора замеров в 20 минут от одного пользователя
    const [recent] = await sql()`select 1 from net_probes where user_id = ${user.id} and at > now() - interval '20 minutes' limit 1`;
    if (recent) return { ok: true, saved: 0 };
    const r = await recordClientProbes({ userId: user.id, ip: req.ip, ua: String(req.headers['user-agent'] ?? ''), results: b.results });
    return { ok: true, saved: r.saved };
  });
  // пробы по ключу VLESS (скрипт на VPS или телефоне с SIM) присылают результаты с внутренним ключом
  app.post('/net/probe-report', { config: { rateLimit: { max: 30, timeWindow: '1 minute' }, bodyLimit: 16_384 } }, async (req) => {
    const probe = await requireProbe(req, 'probe:write');
    const b = z.object({
      name: z.string().trim().min(1).max(60), operator: z.string().max(20).optional(), reportId: z.string().trim().min(8).max(64).optional(),
      results: z.array(z.object({ target: z.string().trim().min(1).max(120), kind: z.literal('vless'), ok: z.boolean(), ms: z.number().int().min(0).max(120_000).nullish(), detail: z.string().max(200).optional() })).min(1).max(30),
    }).parse(req.body);
    const saved = await recordServerProbes({ ...b, probeId: probe.probeId });
    req.log.info({ probe: probe.probeId ?? 'legacy', saved }, 'probe-report accepted');
    const failed = b.results.filter((r) => !r.ok);
    if (failed.length) void alertAdminsThrottled(`probe:${b.name}`, `🔴 <b>Проба «${escapeHtml(b.name)}»: не работает по ключу</b>\n${failed.slice(0, 6).map((f) => `• <code>${escapeHtml(f.target)}</code>${f.detail ? ' — ' + escapeHtml(f.detail) : ''}`).join('\n')}`, 1800);
    return { ok: true, saved };
  });

  // красный индикатор в профиле: только для пользователя, привязанного к администратору
  app.get('/admin-attention', async (req) => {
    const user = await requireUser(req, { gate: false });
    const [a] = user.tg_id ? await sql()`select role from admins where tg_id = ${user.tg_id}` : [];
    if (!a) return { items: [], total: 0, critical: 0 };
    return attentionFor(a.role as AdminRole);
  });

  app.get('/me', async (req) => {
    const user = await requireUser(req, { gate: false });
    const [me, gate, admin] = await Promise.all([
      toMe(user),
      gateStatus(user),
      user.tg_id ? sql()`select role from admins where tg_id = ${user.tg_id}` : Promise.resolve([]),
    ]);
    return { ...me, gate, adminRole: (admin[0]?.role as string | undefined) ?? null };
  });

  // ---------- Обязательная подписка на канал ----------
  app.get('/gate', async (req) => gateStatus(await requireUser(req, { gate: false })));
  app.post('/gate/check', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => gateStatus(await requireUser(req, { gate: false }), { force: true }));

  // Вход администратора из Mini App/бота по привязанному Telegram ID
  app.post('/auth/admin-tg', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req, { gate: false });
    if (!user.tg_id) throw forbidden();
    const [a] = await sql()`select id, email, role, totp_enabled, totp_secret, session_epoch from admins where tg_id = ${user.tg_id}`;
    if (!a) throw forbidden('Этот Telegram-аккаунт не привязан к администратору');
    // Пользовательский JWT мог быть получен через вход по ссылке (tglink) — это не доказательство владения Telegram прямо сейчас.
    // Если у админа включена 2FA, нужен либо код TOTP, либо свежий (≤5 мин) initData Mini App этого же аккаунта, либо вызов от бота.
    if (a.totp_enabled && !isInternal(req)) {
      const b = z.object({ totp: z.string().max(10).optional(), initData: z.string().max(4096).optional() }).parse(req.body ?? {});
      const fresh = b.initData ? validateInitData(b.initData, config().BOT_TOKEN, 300) : null;
      const freshOk = fresh?.user.id === user.tg_id;
      if (!freshOk) {
        if (!b.totp) return { needTotp: true };
        if (!a.totp_secret || !verifyTotp(a.totp_secret, b.totp)) throw unauthorized('Неверный код 2FA');
      }
    }
    await sql()`update admins set last_login_at = now() where id = ${a.id}`;
    return { accessToken: await signAdminToken(a.id, a.role, { epoch: a.session_epoch }), admin: { id: a.id, email: a.email, role: a.role, totpEnabled: a.totp_enabled } };
  });

  // Ошибки интерфейса (Mini App/админка) — в логи API, чтобы видеть причину сбоев у пользователей: docker logs vpn-api | grep client-error
  app.post('/client-error', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z
      .object({ app: z.string().max(20).default('web'), message: z.string().max(500).default(''), stack: z.string().max(3000).default(''), component: z.string().max(2000).default(''), where: z.string().max(300).default(''), ua: z.string().max(300).default('') })
      .parse(req.body ?? {});
    req.log.error({ clientError: b }, `client-error [${b.app}] ${b.where}: ${b.message}`);
    return { ok: true };
  });

  app.post('/ref/click', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { code } = z.object({ code: z.string().max(40) }).parse(req.body);
    await sql()`update partner_links set clicks = clicks + 1 where code = ${code.toLowerCase()} and is_active`;
    return { ok: true };
  });

  // конкурсы: список активных и участие (бот и Mini App)
  app.get('/contests', async (req) => { await requireUser(req); return (await getSettings('contests')).enabled ? activeContests() : []; });
  app.post('/contests/join', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const { code } = z.object({ code: z.string().trim().min(3).max(60) }).parse(req.body);
    return joinContest(user, code);
  });

  app.get('/gifts', async req => listGifts(await requireUser(req)));
  app.get('/gifts/received', async req => receivedGifts(await requireUser(req)));
  app.post('/gifts/preview', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async req => {
    const user = await requireUser(req);
    const { code } = z.object({ code: z.string().trim().max(40) }).parse(req.body);
    return previewGift(user, code);
  });
  app.patch('/gifts/:id', async req => {
    const user = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const card = z.object({ recipientName: z.string().trim().max(60).optional(), senderName: z.string().trim().max(60).optional(), message: z.string().trim().max(400).optional(), theme: z.enum(['orbit','aurora','pearl']).optional(), expectedVersion: z.number().int().positive() }).parse(req.body);
    return updateGiftCard(user, id, card);
  });
  app.post('/gifts/:id/rotate', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async req => {
    const user = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(req.body);
    return rotateGift(user, id, expectedVersion);
  });

  app.post('/gifts/redeem', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
    const user = await requireUser(req);
    const { code } = z.object({ code: z.string().trim().max(40) }).parse(req.body);
    return redeemSubscriptionGift(user, code);
  });

  app.get('/plans', async () => (await listPlans(true)).map(toPlanDTO));

  app.get('/payment-methods', async (req) => {
    await requireUser(req);
    return availableMethods();
  });

  app.get('/subscription', async (req) => getSubscriptionDTO(await requireUser(req), { live: true }));

  app.post('/subscription/trial', async (req) => {
    const user = await requireUser(req);
    await startTrial(user.id);
    return toMe(await requireUser(req));
  });

  app.post('/subscription/auto-renew', async (req) => {
    const user = await requireUser(req);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await sql()`update users set auto_renew = ${enabled} where id = ${user.id}`;
    return { autoRenew: enabled };
  });

  // ---------- Устройства (HWID) ----------
  app.get('/devices', async (req) => listDevices(await requireUser(req)));
  app.post('/devices/delete', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const { id } = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) }).parse(req.body);
    return removeDevice(user, id);
  });
  app.post('/devices/delete-all', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => removeAllDevices(await requireUser(req)));

  // ---------- Докупки ----------
  app.get('/addons', async (req) => addonCatalog(await requireUser(req)));

  // ---------- Квесты ----------
  app.get('/quests', async (req) => listQuests(await requireUser(req)));
  app.post('/quests/:id/claim', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return claimQuest(user, id);
  });

  // ---------- Колесо удачи ----------
  app.get('/wheel', async (req) => getWheel(await requireUser(req)));
  app.post('/wheel/spin', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => spinWheel(await requireUser(req)));

  app.get('/transactions', async (req) => {
    const user = await requireUser(req);
    const rows = await sql()`select id, type, amount, balance_after, note, created_at from transactions where user_id = ${user.id} order by created_at desc limit 50`;
    return rows.map((r) => ({ id: r.id, type: r.type, amount: Number(r.amount), balanceAfter: Number(r.balance_after), note: r.note, createdAt: r.created_at.toISOString() }));
  });

  app.post('/subscription/reset-link', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    return { subUrl: await resetSubscriptionLink(user.id) };
  });

  // ---------- Оплата ----------
  const payBody = z
    .object({
      planId: z.string().uuid().optional(),
      addonId: z.string().uuid().optional(),
      topupAmount: z.number().int().optional(),
      method: z.string().min(2).max(40),
      promo: z.string().max(40).nullish(),
      gift: z.boolean().optional(),
      then: z.object({ planId: z.string().uuid().optional(), addonId: z.string().uuid().optional() }).optional(),
    })
    .refine((v) => [v.planId, v.addonId, v.topupAmount].filter((x) => x !== undefined && x !== null).length === 1, { message: 'Укажите planId, addonId или topupAmount' });

  app.post('/quote', async (req) => {
    const user = await requireUser(req);
    const b = z.object({ planId: z.string().uuid().optional(), addonId: z.string().uuid().optional(), topupAmount: z.number().int().optional(), promo: z.string().max(40).nullish() }).parse(req.body);
    const q = await quote(user.id, b);
    return { gross: q.gross, discount: q.discount, total: q.total, bonus: q.bonus, balance: user.balance, promo: q.promo ? { code: q.promo.code, type: q.promo.type, value: q.promo.value } : null };
  });

  app.post('/payments', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const b = payBody.parse(req.body);
    const key = req.headers['idempotency-key'];
    return createPayment(user, { ...b, operationKey: typeof key === 'string' ? key : undefined });
  });

  app.get('/payments', async (req) => {
    const user = await requireUser(req);
    const rows = await sql()<PaymentRow[]>`select * from payments where user_id = ${user.id} and status <> 'canceled' or (user_id = ${user.id} and created_at > now() - interval '1 day') order by created_at desc limit 50`;
    return rows.map(paymentDTO);
  });

  app.get('/payments/:id', async (req) => {
    const user = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    let [p] = await sql()<PaymentRow[]>`select * from payments where id = ${id} and user_id = ${user.id}`;
    if (!p) throw notFound('Платёж не найден');
    if (p.status === 'pending' && p.external_id) {
      await syncWithProvider(p).catch(() => {});
      [p] = await sql()<PaymentRow[]>`select * from payments where id = ${id}`;
    }
    const row = p!;
    const fulfilled = Boolean(row.fulfilled_at);
    // оплачено, но доступ не выдан: ошибка выдачи, постоянный сбой или «зависло» дольше 90 сек
    const stale = row.paid_at ? Date.now() - row.paid_at.getTime() > 90_000 : false;
    const fulfillFailed = row.status === 'succeeded' && !fulfilled && Boolean(row.fulfill_failed_at || row.fulfill_error || stale);
    return { gift: Boolean(row.payload?.gift), ...paymentDTO(row), fulfilled, fulfillFailed, refundedToBalance: Boolean(row.refunded_to_balance), payUrl: row.status === 'pending' ? row.pay_url : null };
  });

  app.post('/promo/redeem', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const { code } = z.object({ code: z.string().min(1).max(40) }).parse(req.body);
    await assertSalesOpen();
    return redeemGift(user.id, code);
  });

  app.get('/referrals', async (req) => referralStats(await requireUser(req)));
  app.get('/referrals/tree', async (req) => myReferralTree(await requireUser(req)));
  app.post('/referrals/mode', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const { mode } = z.object({ mode: z.enum(['days', 'balance']) }).parse(req.body);
    await setReferralMode(user, mode);
    return referralStats((await requireUser(req)));
  });
  app.post('/referrals/transfer', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const b = z.object({ amount: z.number().int().positive().max(1_000_000_000).optional() }).parse(req.body ?? {});
    return transferRefToBalance(user, b.amount);
  });
  app.get('/referrals/withdrawals', async (req) => listWithdrawals(await requireUser(req)));
  app.post('/referrals/withdraw', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req);
    const b = z.object({ amount: z.number().int().positive().max(1_000_000_000), method: z.string().trim().max(60).default(''), details: z.string().trim().min(1).max(300) }).parse(req.body);
    return requestWithdrawal(user, b);
  });

  app.get('/campaigns', async (req) => activeFor((await requireUser(req)).id));

  app.get('/nodes', async (req) => {
    await requireUser(req);
    if (nodesCache && Date.now() - nodesCache.at < 30_000) return nodesCache.data;
    const out: NodeDTO[] = [];
    try {
      if (await remnawave.isConfigured()) {
        const nodes = (await remnawave.listNodes()).filter((n) => !n.isDisabled);
        const geos = await Promise.all(nodes.map((n) => resolveGeo({ name: n.name, address: n.address, countryCode: n.countryCode })));
        nodes.forEach((n, i) => out.push({ id: n.uuid, name: n.name, countryCode: geos[i]!.countryCode, lat: geos[i]!.lat, lng: geos[i]!.lng, checkedAt: new Date().toISOString(), online: Boolean(n.isConnected), usersOnline: n.usersOnline ?? 0, kind: 'node' }));
      }
    } catch {
      if (nodesCache && Date.now() - nodesCache.at < 5 * 60_000) return nodesCache.data.map(n => ({ ...n, stale: true }));
    }
    // локации из каталога (админка → Локации), у которых ещё нет ноды в этой стране, тоже попадают на глобус
    try {
      const have = new Set(out.map((n) => n.countryCode).filter(Boolean));
      const locs = await sql()<{ id: string; name: string; country_code: string | null }[]>`select id, name, country_code from locations where is_active order by sort, name`;
      for (const l of locs) {
        const g = pointByCode(l.country_code ?? countryFromName(l.name));
        if (!g.countryCode || have.has(g.countryCode)) continue;
        have.add(g.countryCode);
        out.push({ id: `loc:${l.id}`, name: l.name, countryCode: g.countryCode, lat: g.lat, lng: g.lng, online: false, usersOnline: 0, kind: 'location' });
      }
    } catch { /* каталог недоступен — отдаём только ноды */ }
    // несколько серверов в одной стране не должны налезать друг на друга — раздвигаем по кольцу
    const groups = new Map<string, NodeDTO[]>();
    for (const n of out) if (n.lat != null && n.lng != null) { const k = `${n.lat},${n.lng}`; groups.set(k, [...(groups.get(k) ?? []), n]); }
    for (const g of groups.values()) if (g.length > 1) g.forEach((n, i) => { const a = (i / g.length) * Math.PI * 2; n.lat = n.lat! + Math.sin(a) * 1.6; n.lng = n.lng! + Math.cos(a) * 2.2; });
    nodesCache = { at: Date.now(), data: out };
    return out;
  });
}
