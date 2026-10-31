import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { sendTelegramMessage, type TgButton } from '../lib/telegram.js';

export const SEGMENTS = {
  all: 'Все пользователи',
  active: 'С активной подпиской',
  expired: 'С истёкшей подпиской',
  trial: 'На пробном периоде',
  trial_no_pay: 'Пробовали, но не покупали',
  no_sub: 'Без подписки',
  expiring_soon: 'Подписка скоро закончится (авто-скидки)',
  recently_expired: 'Недавно закончилась (авто-скидки)',
} as const;
export type Segment = keyof typeof SEGMENTS;

/** окна авто-скидок (дни); обновляются синхронизацией авто-акций из настроек */
export const autoDays = { expiring: 5, expired: 14 };

export function segmentWhere(segment: Segment) {
  const db = sql();
  switch (segment) {
    case 'active':
      return db`exists (select 1 from subscriptions s where s.user_id = u.id and s.expires_at > now() and not s.is_trial)`;
    case 'expired':
      return db`exists (select 1 from subscriptions s where s.user_id = u.id and s.expires_at <= now())`;
    case 'trial':
      return db`exists (select 1 from subscriptions s where s.user_id = u.id and s.expires_at > now() and s.is_trial)`;
    case 'trial_no_pay':
      return db`u.trial_used and not exists (select 1 from payments p where p.user_id = u.id and p.status = 'succeeded' and p.purpose = 'plan' and p.amount > 0)`;
    case 'expiring_soon': {
      const d = autoDays.expiring;
      return db`exists (select 1 from subscriptions s where s.user_id = u.id and not s.is_trial and s.expires_at > now() and s.expires_at <= now() + make_interval(days => ${d}))`;
    }
    case 'recently_expired': {
      const d = autoDays.expired;
      return db`exists (select 1 from subscriptions s where s.user_id = u.id and s.expires_at <= now() and s.expires_at > now() - make_interval(days => ${d})) and not exists (select 1 from subscriptions s2 where s2.user_id = u.id and s2.expires_at > now())`;
    }
    case 'no_sub':
      return db`not exists (select 1 from subscriptions s where s.user_id = u.id)`;
    default:
      return db`true`;
  }
}

export async function countSegment(segment: Segment): Promise<number> {
  const [r] = await sql()`select count(*)::int as n from users u where u.tg_id is not null and not u.bot_blocked and u.status = 'active' and ${segmentWhere(segment)}`;
  return r!.n;
}

const QUEUE = 'broadcast';
let queue: Queue | null = null;

export function redisConnection() {
  return new Redis(config().REDIS_URL, { maxRetriesPerRequest: null });
}

export function broadcastQueue(): Queue {
  if (!queue) queue = new Queue(QUEUE, { connection: redisConnection() });
  return queue;
}

export async function enqueueBroadcast(id: string): Promise<void> {
  await broadcastQueue().add('send', { id }, { removeOnComplete: 100, removeOnFail: 100 });
}

/** Воркер рассылки: ~20 сообщений в секунду (лимит Telegram — 30/с) */
export async function runBroadcast(id: string): Promise<void> {
  const db = sql();
  const [b] = await db`select * from broadcasts where id = ${id}`;
  if (!b || b.status === 'done') return;
  const users = await db`select u.id, u.tg_id from users u where u.tg_id is not null and not u.bot_blocked and u.status = 'active' and ${segmentWhere(b.segment)} order by u.created_at`;
  await db`update broadcasts set status = 'sending', total = ${users.length}, sent = 0, failed = 0 where id = ${id}`;
  const buttons: TgButton[][] | undefined = b.button_text && b.button_url ? [[{ text: b.button_text, url: b.button_url }]] : undefined;
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    const r = await sendTelegramMessage(u.tg_id, b.text, buttons);
    if (r.ok) sent++;
    else {
      failed++;
      if (r.blocked) await db`update users set bot_blocked = true where id = ${u.id}`;
    }
    if ((sent + failed) % 20 === 0) {
      await db`update broadcasts set sent = ${sent}, failed = ${failed} where id = ${id}`;
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  await db`update broadcasts set status = 'done', sent = ${sent}, failed = ${failed}, finished_at = now() where id = ${id}`;
}

export function startBroadcastWorker(): Worker {
  return new Worker(QUEUE, async (job: Job) => runBroadcast(job.data.id), { connection: redisConnection(), concurrency: 1 });
}
