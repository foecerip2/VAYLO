import { syncLteAll } from './services/lte.js';
import { dailyReportTick } from './services/adminReports.js';
import { paymentNotificationTick } from './services/paymentNotifications.js';
import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import { closeDb, sql } from './db/index.js';
import { migrate } from './db/migrate.js';
import type { PaymentRow } from './db/types.js';
import { redisConnection, startBroadcastWorker } from './services/broadcast.js';
import { notifyUser, openAppButton } from './services/notify.js';
import { fulfillPayment, syncWithProvider } from './services/payments.js';
import { releasePromoForPayment } from './services/promo.js';
import { rewardReferrer } from './services/referrals.js';
import { expireLocations } from './services/addons.js';
import { autoRenew } from './services/autorenew.js';
import { monitorTick } from './services/monitor.js';
import { resumeGrants } from './services/campaigns.js';
import { autodiscountSync, funnelTick } from './services/growth.js';
import { contestsTick } from './services/contests.js';
import { closureTick } from './services/closure.js';
import { workerBeat } from './services/workerHealth.js';
import { retentionTick } from './services/retention.js';
import { incidentTick } from './services/networkIncidents.js';
import { netTick } from './services/netprobe.js';
import { statusTick, syncStatusServers } from './services/serverStatus.js';
import { installProcessGuards } from './lib/guards.js';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...a);

/** Опрос «зависших» платежей: страховка на случай потерянного webhook */
export async function checkPendingPayments(): Promise<number> {
  const rows = await sql()<PaymentRow[]>`
    select * from payments where status = 'pending' and external_id is not null and provider in ('yookassa','platega','rollypay')
      and created_at < now() - interval '40 seconds' and created_at > now() - interval '24 hours' order by created_at limit 100`;
  for (const p of rows) await syncWithProvider(p).catch((e) => log('sync failed', p.id, (e as Error).message));
  const expired = await sql()`update payments set status = 'expired' where status = 'pending' and created_at < now() - interval '24 hours' returning id`;
  for (const e of expired) await releasePromoForPayment(e.id).catch(() => {});
  return rows.length;
}

/** Повтор выдачи доступа для оплаченных, но не выполненных платежей (Remnawave была недоступна) */
export async function retryUnfulfilled(): Promise<number> {
  const rows = await sql()`select id from payments where status = 'succeeded' and fulfilled_at is null and fulfill_failed_at is null order by paid_at limit 50`;
  for (const r of rows) await fulfillPayment(r.id);
  // реферальные награды, которые не дошли
  const missed = await sql()`
    select p.id from payments p join users u on u.id = p.user_id
    where p.status = 'succeeded' and p.fulfilled_at is not null and p.purpose = 'plan' and p.amount > 0 and p.provider <> 'promo'
      and u.referrer_id is not null and p.paid_at > now() - interval '3 days'
      and not exists (select 1 from referral_rewards r where r.payment_id = p.id and r.level = 1) order by p.paid_at limit 50`;
  for (const m of missed) await rewardReferrer(m.id).catch(() => {});
  return rows.length;
}

/** Напоминания об окончании подписки: за 3 дня, за 1 день и в день окончания */
export async function expiryNotices(): Promise<number> {
  const windows = [
    { key: 'd3', from: '2 days', to: '3 days', text: (p: string) => `⏳ <b>Подписка заканчивается через 3 дня</b>\nТариф: ${p}. Продлите заранее, чтобы не потерять доступ.` },
    { key: 'd1', from: '0 seconds', to: '1 day', text: (p: string) => `⚠️ <b>Подписка заканчивается завтра</b>\nТариф: ${p}. Продлите прямо сейчас.` },
  ];
  let sent = 0;
  for (const w of windows) {
    const rows = await sql()`
      select s.user_id, s.plan_name from subscriptions s join users u on u.id = s.user_id
      where s.expires_at > now() + ${w.from}::interval and s.expires_at <= now() + ${w.to}::interval
        and not coalesce((s.notified ->> ${w.key})::boolean, false) and u.tg_id is not null and not u.bot_blocked limit 500`;
    for (const r of rows) {
      await sql()`update subscriptions set notified = notified || ${sql().json({ [w.key]: true })} where user_id = ${r.user_id}`;
      if (await notifyUser(r.user_id, w.text(r.plan_name ?? 'VPN'), [openAppButton('💳 Продлить')])) sent++;
    }
  }
  const expired = await sql()`
    select s.user_id from subscriptions s join users u on u.id = s.user_id
    where s.expires_at <= now() and s.expires_at > now() - interval '2 days' and not coalesce((s.notified ->> 'd0')::boolean, false) and u.tg_id is not null and not u.bot_blocked limit 500`;
  for (const r of expired) {
    await sql()`update subscriptions set notified = notified || '{"d0": true}'::jsonb where user_id = ${r.user_id}`;
    if (await notifyUser(r.user_id, '🔒 <b>Подписка закончилась</b>\nПродлите её, чтобы снова пользоваться VPN.', [openAppButton('💳 Продлить')])) sent++;
  }
  return sent;
}

export async function cleanup(): Promise<void> {
  await sql()`delete from trial_activations where created_at < now() - interval '90 days'`;
  await sql()`delete from bot_activity_updates where created_at < now() - interval '90 days'`;
  await sql()`delete from admin_daily_reports where created_at < now() - interval '90 days'`;
  await sql()`delete from auth_links where expires_at < now() - interval '1 hour'`;
}

const JOBS: Record<string, () => Promise<unknown>> = {
  'check-pending-payments': checkPendingPayments,
  'retry-unfulfilled': retryUnfulfilled,
  'expiry-notices': expiryNotices,
  'net-tick': netTick,
  'incident-tick': incidentTick,
  heartbeat: workerBeat,
  'autodiscount-sync': autodiscountSync,
  'funnel-tick': funnelTick,
  'contests-tick': contestsTick,
  'closure-tick': closureTick,
  retention: retentionTick,
  'status-tick': statusTick,
  'status-sync': syncStatusServers,
  cleanup,
  'lte-quota':syncLteAll,
  'admin-daily-report': () => dailyReportTick(),
  'admin-payment-notifications': () => paymentNotificationTick(),
  'auto-renew': autoRenew,
  'expire-locations': expireLocations,
  monitor: () => monitorTick({ scheduled: true }),
};

async function main() {
  installProcessGuards('worker');
  config();
  await migrate();
  const connection = redisConnection();
  const queue = new Queue('cron', { connection: redisConnection() });
  const every = (ms: number) => ({ repeat: { every: ms }, removeOnComplete: 20, removeOnFail: 50 });
  await queue.add('check-pending-payments', {}, { ...every(60_000), jobId: 'check-pending-payments' });
  await queue.add('retry-unfulfilled', {}, { ...every(60_000), jobId: 'retry-unfulfilled' });
  await queue.add('status-tick', {}, { ...every(60_000), jobId: 'status-tick' });
  await queue.add('status-sync', {}, { ...every(10 * 60_000), jobId: 'status-sync' });
  await queue.add('net-tick', {}, { ...every(5 * 60_000), jobId: 'net-tick' });
  await queue.add('autodiscount-sync', {}, { ...every(10 * 60_000), jobId: 'autodiscount-sync' });
  await queue.add('closure-tick', {}, { ...every(60_000), jobId: 'closure-tick' });
  await queue.add('contests-tick', {}, { ...every(60_000), jobId: 'contests-tick' });
  await queue.add('funnel-tick', {}, { ...every(10 * 60_000), jobId: 'funnel-tick' });
  await queue.add('heartbeat', {}, { ...every(60_000), jobId: 'heartbeat' });
  await queue.add('retention', {}, { ...every(24 * 3600_000), jobId: 'retention' });
  await queue.add('incident-tick', {}, { ...every(2 * 60_000), jobId: 'incident-tick' });
  await queue.add('expiry-notices', {}, { ...every(10 * 60_000), jobId: 'expiry-notices' });
  await queue.add('auto-renew', {}, { ...every(30 * 60_000), jobId: 'auto-renew' });
  await queue.add('expire-locations', {}, { ...every(10 * 60_000), jobId: 'expire-locations' });
  await queue.add('admin-daily-report', {}, { ...every(60_000), jobId: 'admin-daily-report' });
  await queue.add('admin-payment-notifications', {}, { ...every(30_000), jobId: 'admin-payment-notifications' });
  await queue.add('monitor', {}, { ...every(60_000), jobId: 'monitor' });
  await queue.add('lte-quota', {}, { ...every(10*60_000), jobId:'lte-quota' });
  await queue.add('cleanup', {}, { ...every(60 * 60_000), jobId: 'cleanup' });

  const cron = new Worker(
    'cron',
    async (job) => {
      const fn = JOBS[job.name];
      if (!fn) return;
      const r = await fn();
      if (r) log(job.name, '→', r);
    },
    { connection, concurrency: 1 },
  );
  cron.on('failed', (job, err) => log('job failed', job?.name, err.message));
  void resumeGrants().catch(() => {});
  const bc = startBroadcastWorker();
  bc.on('failed', (job, err) => log('broadcast failed', job?.id, err.message));
  log('воркер запущен');

  const stop = async () => {
    await cron.close();
    await bc.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop().catch((e) => console.error(e)));
  process.on('SIGINT', () => void stop().catch((e) => console.error(e)));
}

// не стартуем при импорте из тестов
if (!process.env.VITEST) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

