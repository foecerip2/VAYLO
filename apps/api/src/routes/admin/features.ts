import { lteEnabled,lteDb,grantLte,lteQuota } from '../../services/lte.js';
import { buildDailyReport, localReportClock, dailyReportRecipients } from '../../services/adminReports.js';
import { sendTelegramMessage } from '../../lib/telegram.js';
import { paymentNoticeExample, paymentNotificationStatus } from '../../services/paymentNotifications.js';
import { previewTrialCleanup, getTrialCleanupRun, executeTrialCleanup, trialCleanupCandidates, trialCleanupRegistry, verifyTrialCleanup } from '../../services/trialCleanup.js';
import { adminGifts, revokeGift } from '../../services/gifts.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../db/index.js';
import { audit, requireAdmin } from '../../lib/auth.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { applyNodeIp, issueAgentToken, nodeIpOverview, revokeAgent, setDnsName } from '../../services/nodeip.js';
import { config } from '../../config.js';
import { deleteWelcomeImage, saveWelcomeImage, syncBotDescription, welcomeImageUrl } from '../../services/botwelcome.js';
import { adminWithdrawals, processWithdrawal } from '../../services/refwallet.js';
import { referralFeed, referralTree } from '../../services/referrals.js';
import { monitorSnapshot, monitorTick, record, runChecks } from '../../services/monitor.js';
import { remnawave } from '../../services/remnawave.js';
import { getSettings, getSettingsMasked, setSettings } from '../../services/settings.js';

const id = z.object({ id: z.string().uuid() });

const dupe = (e: any, msg: string) => {
  if (e?.code === '23505') throw conflict(msg);
  if (e?.code === '23503') throw conflict('Нельзя удалить: есть связанные записи');
  throw e;
};

export async function adminFeatureRoutes(app: FastifyInstance) {
  app.get('/notifications/payments',async req=>{const admin=await requireAdmin(req,'admin');return {...await paymentNotificationStatus(),telegramLinked:Boolean(admin.tg_id)};});
  app.post('/notifications/payments/test',{config:{rateLimit:{max:3,timeWindow:'1 minute'}}},async req=>{
    const admin=await requireAdmin(req,'admin');
    if(!admin.tg_id)throw badRequest('Сначала привяжите Telegram ID к своему администратору');
    const cfg=await getSettings('admin_notifications');
    const result=await sendTelegramMessage(Number(admin.tg_id),'🧪 <b>Тестовое уведомление — реальной оплаты нет</b>\n\n'+paymentNoticeExample(cfg.timezone));
    await audit(admin,req,'notifications.payment.test');
    return {ok:result.ok};
  });
  app.post('/lte-grants',async req=>{const admin=await requireAdmin(req,'admin');const b=z.object({tgId:z.number().int().positive().safe(),qty:z.number().int().min(1).max(100000),operationId:z.string().uuid(),reason:z.string().trim().min(3).max(300)}).parse(req.body);const [u]=await sql()`select u.rw_id,u.status,s.expires_at from users u left join subscriptions s on s.user_id=u.id where u.tg_id=${b.tgId}`;if(!u?.rw_id||u.status!=='active'||!u.expires_at||u.expires_at<=new Date())throw badRequest('Нужен активный пользователь с подпиской и профилем Remnawave');await grantLte(b.operationId,u.rw_id,b.qty);await audit(admin,req,'lte.manual-grant','lte',b.operationId,{tgId:b.tgId,qty:b.qty,reason:b.reason});return {ok:true,quota:await lteQuota(u.rw_id)};});
  app.get('/lte-status',async req=>{await requireAdmin(req,'admin');if(!lteEnabled())return {configured:false,ready:false};try{const [r]=await lteDb()`select exists(select 1 from internal_squads where name='LTE') as squad,to_regclass('public.vaylo_lte_orders') is not null as ledger`;return {configured:true,ready:Boolean(r?.squad&&r?.ledger)};}catch{return {configured:true,ready:false};}});
  app.get('/notifications/preview', async req => {
    await requireAdmin(req, 'admin');
    const cfg = await getSettings('admin_notifications');
    const day = localReportClock(new Date(), cfg.timezone).day;
    const recipients = await dailyReportRecipients(cfg.extra_chat_id);
    const deliveries = await sql()`select chat_id,sent_at,attempted_at,attempts from admin_report_deliveries where day=${day} and timezone=${cfg.timezone}`;
    return { ...await buildDailyReport(day,cfg.timezone), recipients:recipients.length, deliveries };
  });
  app.post('/notifications/test', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async req => {
    const admin = await requireAdmin(req, 'admin');
    if (!admin.tg_id) throw badRequest('Сначала привяжите Telegram ID к своему администратору');
    const cfg = await getSettings('admin_notifications');
    const report = await buildDailyReport(localReportClock(new Date(),cfg.timezone).day,cfg.timezone);
    const result = await sendTelegramMessage(Number(admin.tg_id), '🧪 <b>Тестовый отчёт</b>\n' + report.text);
    await audit(admin,req,'notifications.test');
    return { ok:result.ok };
  });
  app.post('/trial-cleanup/preview', async req => {
    const admin = await requireAdmin(req, 'admin');
    const {q}=z.object({q:z.string().trim().max(100).default('')}).parse(req.body??{});
    return previewTrialCleanup(admin.id,q);
  });
  const cleanupPage=z.object({q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)});
  app.get('/trial-cleanup/candidates',async req=>{await requireAdmin(req,'admin');return trialCleanupCandidates(cleanupPage.extend({filter:z.enum(['eligible','excluded','all']).default('eligible')}).parse(req.query));});
  app.get('/trial-cleanup/registry',async req=>{await requireAdmin(req,'admin');return trialCleanupRegistry(cleanupPage.extend({filter:z.enum(['all','returned','unverified']).default('all')}).parse(req.query));});
  app.post('/trial-cleanup/registry/:tgId/verify',async req=>{
    const admin=await requireAdmin(req,'admin');
    const {tgId}=z.object({tgId:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).parse(req.params);
    const result=await verifyTrialCleanup(tgId);await audit(admin,req,'trial-cleanup.verify','telegram',String(tgId));return result;
  });
  app.get('/trial-cleanup/:id', async req => {
    const admin = await requireAdmin(req, 'admin');
    return getTrialCleanupRun(id.parse(req.params).id,admin.id);
  });
  app.post('/trial-cleanup/:id/run', async (req,reply) => {
    const admin = await requireAdmin(req, 'admin');
    const runId = id.parse(req.params).id;
    const body = z.object({confirm:z.literal('DELETE_EXPIRED_TRIALS')}).parse(req.body);
    const plan = await getTrialCleanupRun(runId,admin.id);
    if(plan.state !== 'ready' || new Date(plan.expires_at).getTime() <= Date.now()) throw conflict('Предпросмотр устарел или уже запущен. Обновите список.');
    // Execution records progress; HTTP timeouts cannot accidentally launch a second deletion.
    void executeTrialCleanup(runId,admin.id).catch(e=>req.log.error({err:e},'trial cleanup failed'));
    await audit(admin,req,'trial-cleanup.run','trial_cleanup',runId);
    return reply.code(202).send({id:runId});
  });

  app.get('/gifts', async req => {
    await requireAdmin(req, 'analyst');
    const query = z.object({ state: z.enum(['all','ready','redeemed','revoked']).default('all'), q: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).max(1000000).default(1) }).parse(req.query);
    return adminGifts(query);
  });
  app.post('/gifts/:id/revoke', async req => {
    const admin = await requireAdmin(req, 'admin');
    const { id: giftId } = id.parse(req.params);
    const result = await revokeGift(giftId);
    await audit(admin, req, 'gift.revoke', 'gift', giftId);
    return result;
  });

  // ---------- Локации (премиум-сквады) ----------
  const locBody = z.object({
    name: z.string().min(1).max(60),
    countryCode: z.string().length(2).nullish(),
    description: z.string().max(300).default(''),
    squadUuid: z.string().trim().uuid('UUID сквада указан неверно: выберите сквад из списка или скопируйте UUID из панели Remnawave'),
    isActive: z.boolean().default(true),
    sort: z.number().int().default(0),
  });
  app.get('/locations', async (req) => {
    await requireAdmin(req, 'analyst');
    return sql()`select l.id, l.name, l.country_code, l.description, l.squad_uuid, l.is_active, l.sort,
      (select count(*)::int from user_locations ul where ul.location_id = l.id and ul.expires_at > now()) as users
      from locations l order by l.sort, l.name`;
  });
  app.get('/squads', async (req) => {
    await requireAdmin(req, 'admin');
    if (!(await remnawave.isConfigured())) return [];
    try {
      return (await remnawave.listSquads()).map((s) => ({ uuid: s.uuid, name: s.name }));
    } catch (e) {
      throw badRequest('Не удалось получить сквады: ' + ((e as any).detail ?? (e as Error).message));
    }
  });
  app.post('/locations', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = locBody.parse(req.body);
    const [r] = await sql()`insert into locations (name, country_code, description, squad_uuid, is_active, sort) values (${b.name}, ${b.countryCode?.toUpperCase() ?? null}, ${b.description}, ${b.squadUuid}, ${b.isActive}, ${b.sort}) returning id`;
    await audit(a, req, 'location.create', 'location', r!.id, b);
    return { id: r!.id };
  });
  app.put('/locations/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: lid } = id.parse(req.params);
    const b = locBody.parse(req.body);
    const r = await sql()`update locations set name = ${b.name}, country_code = ${b.countryCode?.toUpperCase() ?? null}, description = ${b.description}, squad_uuid = ${b.squadUuid}, is_active = ${b.isActive}, sort = ${b.sort} where id = ${lid} returning id`;
    if (!r.length) throw notFound();
    await audit(a, req, 'location.update', 'location', lid, b);
    return { ok: true };
  });
  app.delete('/locations/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: lid } = id.parse(req.params);
    await sql().begin(async tx => {
      await tx`select id from locations where id=${lid} for update`;
      const [used]=await tx`select 1 where exists(select 1 from user_locations where location_id=${lid})
        or exists(select 1 from payments where status in ('pending','succeeded') and payload->'addon'->>'locationId'=${lid})`;
      if(used)throw conflict('Локация связана с выданным доступом или заказами. Выключите её вместо удаления.');
      await tx`delete from locations where id=${lid}`;
    });
    await audit(a, req, 'location.delete', 'location', lid);
    return { ok: true };
  });

  // ---------- Товары докупки ----------
  const addonBody = z
    .object({
      kind: z.enum(['devices', 'traffic', 'location','lte']),
      name: z.string().min(1).max(80),
      description: z.string().max(300).default(''),
      price: z.number().int().min(0).max(100_000_000),
      qty: z.number().int().min(1).max(100000),
      locationId: z.string().uuid().nullish(),
      durationDays: z.number().int().min(1).max(3650).nullish(),
      isActive: z.boolean().default(true),
      sort: z.number().int().default(0),
    })
    .refine((v) => v.kind !== 'location' || Boolean(v.locationId), { message: 'Выберите локацию для пакета' })
    .refine(v => v.kind === 'location' || v.durationDays == null || (v.kind==='lte' && v.durationDays===30), {message:'Срок для устройств и общего трафика не поддерживается: они действуют при непрерывной подписке'})
    .refine(v => v.kind === 'location' || !v.locationId, {message:'Локация указывается только для пакета локации'});
  app.get('/addon-orders', async req => {
    await requireAdmin(req,'analyst');
    const q=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),state:z.enum(['all','pending','issued','unfulfilled','failed']).default('all'),search:z.string().trim().max(80).default('')}).parse(req.query);
    const db=sql();
    const status=q.state==='pending'?db`p.status='pending'`:q.state==='issued'?db`p.status='succeeded' and p.fulfilled_at is not null`:q.state==='unfulfilled'?db`p.status='succeeded' and p.fulfilled_at is null`:q.state==='failed'?db`p.status in ('canceled','expired','refunded')`:db`true`;
    const pattern='%'+q.search+'%';
    const where=db`p.purpose='addon' and (${status}) and (${q.search}='' or u.tg_id::text=${q.search} or u.username ilike ${pattern} or p.plan_name ilike ${pattern})`;
    const [count]=await db`select count(*)::int as total from payments p join users u on u.id=p.user_id where ${where}`;
    const items=await db`select p.id,p.user_id,u.tg_id,u.username,u.first_name,p.plan_name,p.amount,p.status,p.created_at,p.paid_at,p.fulfilled_at,p.fulfill_failed_at,
      p.payload->'addon' as addon from payments p join users u on u.id=p.user_id where ${where} order by p.created_at desc,p.id desc limit 30 offset ${(q.page-1)*30}`;
    return {items,total:count!.total,page:q.page};
  });
  app.get('/addons', async (req) => {
    await requireAdmin(req, 'analyst');
    return sql()`select p.*, l.name as location_name,
      (select count(*)::int from payments x where x.purpose = 'addon' and x.status = 'succeeded' and x.fulfilled_at is not null and x.payload -> 'addon' ->> 'id' = p.id::text) as sold
      from addon_products p left join locations l on l.id = p.location_id order by p.sort, p.price`;
  });
  app.post('/addons', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = addonBody.parse(req.body);
    const [r] = await sql()`insert into addon_products (kind, name, description, price, qty, location_id, duration_days, is_active, sort)
      values (${b.kind}, ${b.name}, ${b.description}, ${b.price}, ${b.qty}, ${b.kind === 'location' ? b.locationId! : null}, ${b.kind === 'location' ? (b.durationDays ?? null) : b.kind==='lte'?30:null}, ${b.isActive}, ${b.sort}) returning id`;
    await audit(a, req, 'addon.create', 'addon', r!.id, b);
    return { id: r!.id };
  });
  app.put('/addons/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: pid } = id.parse(req.params);
    const b = addonBody.parse(req.body);
    const r = await sql()`update addon_products set kind = ${b.kind}, name = ${b.name}, description = ${b.description}, price = ${b.price}, qty = ${b.qty},
      location_id = ${b.kind === 'location' ? b.locationId! : null}, duration_days = ${b.kind === 'location' ? (b.durationDays ?? null) : b.kind==='lte'?30:null}, is_active = ${b.isActive}, sort = ${b.sort} where id = ${pid} returning id`;
    if (!r.length) throw notFound();
    await audit(a, req, 'addon.update', 'addon', pid, b);
    return { ok: true };
  });
  app.delete('/addons/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: pid } = id.parse(req.params);
    await sql()`delete from addon_products where id = ${pid}`;
    await audit(a, req, 'addon.delete', 'addon', pid);
    return { ok: true };
  });

  // ---------- Квесты ----------
  const questBody = z.object({
    title: z.string().min(1).max(80),
    description: z.string().max(300).default(''),
    type: z.enum(['daily_checkin', 'join_channel', 'invite_friends', 'first_payment', 'topup_total', 'spend_total', 'have_subscription', 'traffic_used', 'open_link']),
    target: z.number().int().min(1),
    rewardType: z.enum(['days', 'balance']),
    rewardValue: z.number().int().min(1).max(10_000_000),
    repeat: z.enum(['once', 'daily']).default('once'),
    url: z.string().max(300).default(''),
    sort: z.number().int().default(0),
    isActive: z.boolean().default(true),
  });
  // ---------- Колесо удачи ----------
  const wheelBody = z.object({
    enabled: z.boolean(),
    prizes: z.array(z.object({
      id: z.string().regex(/^[a-z0-9_]{1,24}$/),
      label: z.string().trim().min(1).max(24),
      type: z.enum(['days', 'balance']),
      value: z.number().int().min(1).max(100_000),
      weight: z.number().int().min(1).max(1000),
    })).min(2, 'Нужно минимум 2 приза').max(12, 'Не больше 12 призов'),
  });
  app.get('/wheel', async (req) => {
    await requireAdmin(req, 'analyst');
    const cfg = await getSettings('wheel');
    const [tot] = await sql()`select count(*)::int as total,
      count(*) filter (where day = to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD'))::int as today,
      coalesce(sum(prize_value) filter (where prize_type = 'days'), 0)::int as days_given,
      coalesce(sum(prize_value) filter (where prize_type = 'balance'), 0)::bigint as kopeks_given from wheel_spins`;
    const byPrize = await sql()`select prize_id, count(*)::int as n from wheel_spins group by prize_id`;
    const recent = await sql()`select w.prize_label, w.prize_type, w.prize_value, w.created_at, u.username, u.first_name, u.tg_id
      from wheel_spins w join users u on u.id = w.user_id order by w.created_at desc limit 20`;
    return {
      settings: cfg,
      stats: { total: tot!.total, today: tot!.today, daysGiven: tot!.days_given, kopeksGiven: Number(tot!.kopeks_given) },
      byPrize: Object.fromEntries(byPrize.map((r) => [r.prize_id as string, r.n as number])),
      recent,
    };
  });
  app.put('/wheel', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = wheelBody.parse(req.body);
    const ids = new Set(b.prizes.map((x) => x.id));
    if (ids.size !== b.prizes.length) throw badRequest('Идентификаторы призов должны быть уникальны');
    await setSettings('wheel', b);
    await audit(a, req, 'wheel.update', 'settings', 'wheel', { prizes: b.prizes.length, enabled: b.enabled });
    return { ok: true };
  });

  app.get('/quests', async (req) => {
    await requireAdmin(req, 'analyst');
    return sql()`select q.*, (select count(*)::int from quest_claims c where c.quest_id = q.id) as claims from quests q order by q.sort, q.created_at`;
  });
  app.post('/quests', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = questBody.parse(req.body);
    const repeat = b.type === 'daily_checkin' ? 'daily' : b.repeat;
    const [r] = await sql()`insert into quests (title, description, type, target, reward_type, reward_value, repeat, config, sort, is_active)
      values (${b.title}, ${b.description}, ${b.type}, ${b.target}, ${b.rewardType}, ${b.rewardValue}, ${repeat}, ${sql().json({ url: b.url })}, ${b.sort}, ${b.isActive}) returning id`;
    await audit(a, req, 'quest.create', 'quest', r!.id, b);
    return { id: r!.id };
  });
  app.put('/quests/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: qid } = id.parse(req.params);
    const b = questBody.parse(req.body);
    const repeat = b.type === 'daily_checkin' ? 'daily' : b.repeat;
    const r = await sql()`update quests set title = ${b.title}, description = ${b.description}, type = ${b.type}, target = ${b.target}, reward_type = ${b.rewardType}, reward_value = ${b.rewardValue},
      repeat = ${repeat}, config = ${sql().json({ url: b.url })}, sort = ${b.sort}, is_active = ${b.isActive} where id = ${qid} returning id`;
    if (!r.length) throw notFound();
    await audit(a, req, 'quest.update', 'quest', qid, b);
    return { ok: true };
  });
  app.delete('/quests/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: qid } = id.parse(req.params);
    await sql()`delete from quests where id = ${qid}`;
    await audit(a, req, 'quest.delete', 'quest', qid);
    return { ok: true };
  });

  // ---------- Рефералы: обзор, ранги, партнёрские ссылки ----------
  app.get('/referrals/overview', async (req) => {
    await requireAdmin(req, 'analyst');
    const db = sql();
    const [t] = await db`
      select (select count(*)::int from users where referrer_id is not null) as invited,
             (select count(distinct referee_id)::int from referral_rewards where level = 1 and kind = 'payment') as paying,
             coalesce(sum(balance),0)::bigint as balance, coalesce(sum(days),0)::int as days,
             coalesce(sum(balance) filter (where level = 2),0)::bigint as level2
      from referral_rewards`;
    const top = await db`
      select u.id, u.username, u.first_name, u.tg_id,
        (select count(*)::int from users x where x.referrer_id = u.id) as invited,
        count(distinct r.referee_id) filter (where r.level = 1)::int as paid,
        coalesce(sum(r.balance),0)::bigint as balance, coalesce(sum(r.days),0)::int as days
      from referral_rewards r join users u on u.id = r.referrer_id group by u.id order by balance desc, paid desc limit 20`;
    return {
      invited: t!.invited, paying: t!.paying, balance: Number(t!.balance), days: t!.days, level2: Number(t!.level2),
      top: top.map((x) => ({ ...x, balance: Number(x.balance) })),
    };
  });

  app.get('/users/:id/referrals', async (req) => {
    await requireAdmin(req, 'analyst');
    const { id: uid } = id.parse(req.params);
    const t = await referralTree(uid);
    if (!t) throw notFound();
    return t;
  });
  app.get('/referrals/feed', async (req) => {
    await requireAdmin(req, 'analyst');
    return referralFeed(60);
  });

  // ---------- Приветствие бота ----------
  const welcomeState = async () => ({ settings: await getSettingsMasked('bot_welcome'), imageUrl: await welcomeImageUrl() });
  app.get('/bot-welcome', async (req) => {
    await requireAdmin(req, 'admin');
    return welcomeState();
  });
  app.put('/bot-welcome', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = z.object({ description: z.string().max(512), short_description: z.string().max(120), start_text: z.string().max(900), sync: z.boolean().optional() }).parse(req.body);
    const { sync, ...patch } = b;
    await setSettings('bot_welcome', patch);
    await audit(a, req, 'bot-welcome.update', 'settings', 'bot_welcome');
    const synced = sync ? await syncBotDescription() : null;
    return { ...(await welcomeState()), synced };
  });
  app.post('/bot-welcome/sync', async (req) => {
    const a = await requireAdmin(req, 'admin');
    await audit(a, req, 'bot-welcome.sync', 'settings', 'bot_welcome');
    return syncBotDescription();
  });
  app.post('/bot-welcome/image', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { data } = z.object({ data: z.string().min(100).max(3_200_000) }).parse(req.body);
    await saveWelcomeImage(Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64'));
    await audit(a, req, 'bot-welcome.image');
    return welcomeState();
  });
  app.delete('/bot-welcome/image', async (req) => {
    const a = await requireAdmin(req, 'admin');
    await deleteWelcomeImage();
    await audit(a, req, 'bot-welcome.image.delete');
    return welcomeState();
  });

  // ---------- Выводы реферального счёта ----------
  app.get('/withdrawals', async (req) => {
    await requireAdmin(req, 'analyst');
    const { status } = z.object({ status: z.enum(['pending', 'paid', 'rejected']).optional() }).parse(req.query);
    return adminWithdrawals(status);
  });
  app.post('/withdrawals/:id/:action', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: wid, action } = z.object({ id: z.string().uuid(), action: z.enum(['paid', 'reject']) }).parse(req.params);
    const { note } = z.object({ note: z.string().max(300).optional() }).parse(req.body ?? {});
    await processWithdrawal(wid, action === 'paid' ? 'paid' : 'rejected', a.email, note);
    await audit(a, req, `withdrawal.${action}`, 'withdrawal', wid, { note });
    return { ok: true };
  });

  const rankBody = z.object({ name: z.string().min(1).max(40), minPaid: z.number().int().min(0), percent: z.number().int().min(0).max(100), extraDays: z.number().int().min(0).max(365), sort: z.number().int().default(0) });
  app.get('/referrals/ranks', async (req) => {
    await requireAdmin(req, 'analyst');
    return sql()`select * from referral_ranks order by min_paid, sort`;
  });
  app.post('/referrals/ranks', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = rankBody.parse(req.body);
    const [r] = await sql()`insert into referral_ranks (name, min_paid, percent, extra_days, sort) values (${b.name}, ${b.minPaid}, ${b.percent}, ${b.extraDays}, ${b.sort}) returning id`;
    await audit(a, req, 'rank.create', 'rank', r!.id, b);
    return { id: r!.id };
  });
  app.put('/referrals/ranks/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: rid } = id.parse(req.params);
    const b = rankBody.parse(req.body);
    const r = await sql()`update referral_ranks set name = ${b.name}, min_paid = ${b.minPaid}, percent = ${b.percent}, extra_days = ${b.extraDays}, sort = ${b.sort} where id = ${rid} returning id`;
    if (!r.length) throw notFound();
    await audit(a, req, 'rank.update', 'rank', rid, b);
    return { ok: true };
  });
  app.delete('/referrals/ranks/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: rid } = id.parse(req.params);
    await sql()`delete from referral_ranks where id = ${rid}`;
    await audit(a, req, 'rank.delete', 'rank', rid);
    return { ok: true };
  });

  const plBody = z.object({
    code: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'Только латиница, цифры, - и _'),
    name: z.string().min(1).max(60),
    ownerTgId: z.number().int().nullish(),
    isActive: z.boolean().default(true),
  });
  const ownerId = async (tgId: number | null | undefined): Promise<string | null> => {
    if (!tgId) return null;
    const [u] = await sql()`select id from users where tg_id = ${tgId}`;
    if (!u) throw badRequest('Владелец с таким Telegram ID ещё не заходил в бота');
    return u.id;
  };
  app.get('/referrals/partner-links', async (req) => {
    await requireAdmin(req, 'analyst');
    const rows = await sql()`
      select l.id, l.code, l.name, l.clicks, l.is_active, l.created_at, u.tg_id as owner_tg_id, u.username as owner_username,
        (select count(*)::int from users x where x.partner_link_id = l.id) as registrations,
        (select count(distinct p.user_id)::int from payments p join users x on x.id = p.user_id where x.partner_link_id = l.id and p.status = 'succeeded' and p.amount > 0 and p.provider <> 'promo' and p.purpose <> 'topup') as paying,
        (select coalesce(sum(p.amount),0)::bigint from payments p join users x on x.id = p.user_id where x.partner_link_id = l.id and p.status = 'succeeded' and p.provider in ('yookassa','platega','rollypay')) as revenue
      from partner_links l left join users u on u.id = l.owner_user_id order by l.created_at desc`;
    return rows.map((r) => ({ ...r, revenue: Number(r.revenue) }));
  });
  app.post('/referrals/partner-links', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const b = plBody.parse(req.body);
    const owner = await ownerId(b.ownerTgId);
    try {
      const [r] = await sql()`insert into partner_links (code, name, owner_user_id, is_active) values (${b.code.toLowerCase()}, ${b.name}, ${owner}, ${b.isActive}) returning id`;
      await audit(a, req, 'partner.create', 'partner', r!.id, b);
      return { id: r!.id };
    } catch (e) {
      return dupe(e, 'Такой код уже занят');
    }
  });
  app.put('/referrals/partner-links/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: pid } = id.parse(req.params);
    const b = plBody.parse(req.body);
    const owner = await ownerId(b.ownerTgId);
    try {
      const r = await sql()`update partner_links set code = ${b.code.toLowerCase()}, name = ${b.name}, owner_user_id = ${owner}, is_active = ${b.isActive} where id = ${pid} returning id`;
      if (!r.length) throw notFound();
    } catch (e) {
      return dupe(e, 'Такой код уже занят');
    }
    await audit(a, req, 'partner.update', 'partner', pid, b);
    return { ok: true };
  });
  app.delete('/referrals/partner-links/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: pid } = id.parse(req.params);
    await sql()`delete from partner_links where id = ${pid}`;
    await audit(a, req, 'partner.delete', 'partner', pid);
    return { ok: true };
  });

  // ---------- Автоперенастройка нод при смене IP ----------
  app.get('/nodeip', async (req) => {
    await requireAdmin(req, 'analyst');
    return nodeIpOverview();
  });
  app.post('/nodeip/:uuid/agent', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { uuid } = z.object({ uuid: z.string().uuid() }).parse(req.params);
    const b = z.object({ dnsName: z.string().max(253).nullish() }).parse(req.body ?? {});
    const node = (await remnawave.listNodes()).find((n) => n.uuid === uuid);
    if (!node) throw notFound('Нода не найдена в Remnawave');
    const token = await issueAgentToken(uuid, node.name, b.dnsName);
    await audit(a, req, 'nodeip.agent.issue', 'node', uuid);
    const api = config().API_URL.replace(/\/$/, '');
    return { token, installCommand: `curl -fsSL ${api}/api/v1/node-agent/install.sh | sudo bash -s -- ${api} ${token}` };
  });
  app.delete('/nodeip/:uuid/agent', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { uuid } = z.object({ uuid: z.string().uuid() }).parse(req.params);
    await revokeAgent(uuid);
    await audit(a, req, 'nodeip.agent.revoke', 'node', uuid);
    return { ok: true };
  });
  app.put('/nodeip/:uuid/dns', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { uuid } = z.object({ uuid: z.string().uuid() }).parse(req.params);
    const { dnsName } = z.object({ dnsName: z.string().max(253).nullable() }).parse(req.body);
    await setDnsName(uuid, dnsName);
    await audit(a, req, 'nodeip.dns', 'node', uuid, { dnsName });
    return { ok: true };
  });
  app.post('/nodeip/:uuid/ip', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { uuid } = z.object({ uuid: z.string().uuid() }).parse(req.params);
    const { ip } = z.object({ ip: z.string().trim().max(45) }).parse(req.body);
    const r = await applyNodeIp(uuid, ip, 'manual');
    await audit(a, req, 'nodeip.manual', 'node', uuid, { ip });
    return r;
  });

  // ---------- Мониторинг ----------
  app.get('/monitoring', async (req) => {
    await requireAdmin(req, 'analyst');
    const cfg = await getSettings('monitoring');
    const g = await getSettings('general');
    return { intervalSeconds: cfg.interval_seconds, enabled: cfg.enabled, maintenance: g.maintenance, ...(await monitorSnapshot()) };
  });
  app.post('/monitoring/run', async (req) => {
    const a = await requireAdmin(req, 'support');
    const cfg = await getSettings('monitoring');
    const results = await runChecks();
    for (const r of results) await record(r, 1);
    await audit(a, req, 'monitoring.run');
    return { results, enabled: cfg.enabled };
  });
  app.post('/monitoring/tick', async (req) => {
    await requireAdmin(req, 'admin');
    return monitorTick();
  });

  // Быстрое включение/выключение техработ (для бота и Mini App)
  app.post('/maintenance', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await setSettings('general', { maintenance: enabled });
    await audit(a, req, 'maintenance', 'settings', 'general', { enabled });
    return { maintenance: enabled };
  });

  // ---------- Пользователь: персональные параметры ----------
  app.patch('/users/:id', async (req) => {
    const a = await requireAdmin(req, 'admin');
    const { id: uid } = id.parse(req.params);
    const b = z.object({ discountPct: z.number().int().min(0).max(100).optional(), autoRenew: z.boolean().optional() }).parse(req.body);
    if (b.discountPct !== undefined) await sql()`update users set discount_pct = ${b.discountPct} where id = ${uid}`;
    if (b.autoRenew !== undefined) await sql()`update users set auto_renew = ${b.autoRenew} where id = ${uid}`;
    await audit(a, req, 'user.update', 'user', uid, b);
    return { ok: true };
  });

  // ---------- Сводка расходов по назначению (для дашборда) ----------
  app.get('/stats/purposes', async (req) => {
    await requireAdmin(req, 'analyst');
    const rows = await sql()`
      select purpose, coalesce(sum(amount),0)::bigint as amount, count(*)::int as count from payments
      where status = 'succeeded' and paid_at > now() - interval '30 days' and amount > 0 group by purpose`;
    return rows.map((r) => ({ purpose: r.purpose, amount: Number(r.amount), count: r.count }));
  });
}
