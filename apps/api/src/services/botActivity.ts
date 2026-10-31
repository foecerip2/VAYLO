import { sql } from '../db/index.js';

export const BOT_CATEGORIES = ['start', 'menu', 'subscription', 'payments', 'gifts', 'support', 'referrals', 'rewards', 'other'] as const;
export type BotCategory = typeof BOT_CATEGORIES[number];

/** One Telegram update is counted once, including redelivery after a bot restart. */
export async function recordBotActivity(userId: string, updateId: number, category: BotCategory) {
  await sql().begin(async db => {
    const inserted = await db`insert into bot_activity_updates(update_id) values(${updateId}) on conflict do nothing returning update_id`;
    if (!inserted.length) return;
    await db`insert into bot_activity_events(update_id,user_id,category) values(${updateId},${userId},${category})`;
  });
}
