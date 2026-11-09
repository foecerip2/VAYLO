import { avatarData } from './avatars.js';
import type { MeDTO } from '@vpn/shared';
import { sql, type Sql, type TxSql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { randomCode } from '../lib/crypto.js';
import type { TgUser } from '../lib/telegram.js';
import { notFound } from '../lib/errors.js';
import { getSettings } from './settings.js';
import { getSubscriptionDTO } from './subscriptions.js';
import { giveSignupBonuses } from './referrals.js';
import { assertRegistrationOpen } from './closure.js';

import { rwUsernameFor } from './subscriptions.js';
export { rwUsernameFor };

export async function upsertTelegramUser(tg: TgUser, refCode?: string | null): Promise<UserRow> {
  const db = sql();
  const existing = await db<UserRow[]>`
    update users set username = ${tg.username ?? null}, first_name = ${tg.first_name ?? null}, last_seen_at = now(),
      trial_used = trial_used or exists(select 1 from trial_cleanup_tombstones where tg_id=${tg.id}),
      signup_bonus_done = signup_bonus_done or exists(select 1 from trial_cleanup_tombstones where tg_id=${tg.id})
    where tg_id = ${tg.id} returning *`;
  if (existing[0]) return existing[0];

  await assertRegistrationOpen();
  let referrerId: string | null = null;
  let partnerId: string | null = null;
  if (refCode) {
    const [r] = await db`select id from users where referral_code = ${refCode.toLowerCase()} and tg_id is distinct from ${tg.id}`;
    referrerId = r?.id ?? null;
    if (!referrerId) {
      // партнёрская ссылка: код может быть произвольным (например, «yt-vasya»)
      const [pl] = await db`select id, owner_user_id from partner_links where code = ${refCode.toLowerCase()} and is_active`;
      if (pl) {
        partnerId = pl.id;
        if (pl.owner_user_id) {
          const [o] = await db`select id from users where id = ${pl.owner_user_id} and tg_id is distinct from ${tg.id}`;
          referrerId = o?.id ?? null;
        }
      }
    }
  }
  for (let i = 0; i < 5; i++) {
    try {
      const [u] = await db<UserRow[]>`
        insert into users (tg_id, username, first_name, lang, referral_code, referrer_id, partner_link_id, trial_used, signup_bonus_done)
        values (${tg.id}, ${tg.username ?? null}, ${tg.first_name ?? null}, 'ru', ${randomCode(8)}, ${referrerId}, ${partnerId}, exists(select 1 from trial_cleanup_tombstones where tg_id = ${tg.id}), exists(select 1 from trial_cleanup_tombstones where tg_id = ${tg.id}))
        on conflict (tg_id) do update set last_seen_at = now()
        returning *`;
      if (u!.referrer_id && !u!.signup_bonus_done) await giveSignupBonuses(u!).catch(() => {});
      return u!;
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint_name).includes('referral_code')) continue;
      throw e;
    }
  }
  throw new Error('Не удалось сгенерировать реферальный код');
}

export async function getUser(id: string, db: Sql | TxSql = sql()): Promise<UserRow> {
  const [u] = await db<UserRow[]>`select * from users where id = ${id}`;
  if (!u) throw notFound('Пользователь не найден');
  return u;
}

export async function toMe(u: UserRow): Promise<MeDTO> {
  const trial = await getSettings('trial');
  const [trialState] = await sql()`select exists(select 1 from subscriptions where user_id=${u.id}) as has_sub,
    exists(select 1 from trial_cleanup_tombstones where tg_id=${u.tg_id}) as blocked`;
  return {
    id: u.id,
    avatarUrl: await avatarData(u.id),
    tgId: u.tg_id,
    email: u.email,
    hasPassword: Boolean(u.password_hash),
    username: u.username,
    firstName: u.first_name,
    balance: u.balance,
    referralCode: u.referral_code,
    discountPct: u.discount_pct,
    checkinStreak: u.checkin_streak,
    // без Telegram пробного периода нет: защита от повторных пробных по tg_id и проверка канала работают только с ним
    trialAvailable: trial.enabled && u.tg_id != null && !u.trial_used && !trialState.has_sub && !trialState.blocked,
    subscription: await getSubscriptionDTO(u),
  };
}
