import { z } from 'zod';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { hashPassword, randomCode, randomToken, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../lib/errors.js';
import { signUserToken } from '../lib/jwt.js';
import { assertRegistrationOpen } from './closure.js';

/** Вход по почте и паролю (Android-приложение). Писем нет: пароль сбрасывается и Telegram привязывается через бота. */

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const ACTION_TTL_SEC = 600;

export const emailSchema = z.string().trim().toLowerCase().email('Некорректная почта').max(254, 'Слишком длинная почта');
export const passwordSchema = z.string().min(8, 'Пароль не короче 8 символов').max(128, 'Пароль не длиннее 128 символов');

export type ActionStatus = 'pending' | 'ok' | 'expired';

function assertStrong(password: string, email: string | null) {
  if (email && password.toLowerCase() === email.toLowerCase()) throw badRequest('Пароль не должен совпадать с почтой', 'weak_password');
}

let dummyHash: Promise<string> | null = null;
/** Хеш для сравнения, когда почты нет: время ответа не выдаёт, существует ли аккаунт */
const fakeHash = () => (dummyHash ??= hashPassword('vaylo-no-such-account-timing-pad'));

const tokenFor = (u: Pick<UserRow, 'id' | 'session_epoch'>) => signUserToken(u.id, u.session_epoch);

const isUnique = (e: any, part: string) => e?.code === '23505' && String(e.constraint_name ?? '').includes(part);

/** Регистрация по почте. Без реферального кода и без пробного периода: они требуют привязанного Telegram. */
export async function registerByEmail(emailRaw: string, password: string): Promise<{ accessToken: string }> {
  const email = emailSchema.parse(emailRaw);
  passwordSchema.parse(password);
  assertStrong(password, email);
  await assertRegistrationOpen();
  const hash = await hashPassword(password);
  for (let i = 0; i < 5; i++) {
    try {
      const [u] = await sql()<UserRow[]>`
        insert into users (email, password_hash, lang, referral_code)
        values (${email}, ${hash}, 'ru', ${randomCode(8)}) returning *`;
      return { accessToken: await tokenFor(u!) };
    } catch (e: any) {
      if (isUnique(e, 'referral_code')) continue;
      if (isUnique(e, 'email')) throw conflict('Эта почта уже зарегистрирована', 'email_taken');
      throw e;
    }
  }
  throw new Error('Не удалось сгенерировать реферальный код');
}

const INVALID = () => unauthorized('Неверная почта или пароль', 'invalid_credentials');
const LOCKED = () => new HttpError(429, `Слишком много неудачных попыток. Попробуйте через ${LOCK_MINUTES} минут.`, 'locked');

/** Вход. Ответ одинаков для неизвестной почты, аккаунта без пароля и неверного пароля. */
export async function loginByEmail(emailRaw: string, password: string): Promise<{ accessToken: string }> {
  const email = emailSchema.parse(emailRaw);
  const [u] = await sql()<UserRow[]>`select * from users where email = ${email}`;
  const ok = await verifyPassword(password, u?.password_hash ?? (await fakeHash()));
  if (u?.password_hash && u.locked_until && u.locked_until.getTime() > Date.now()) throw LOCKED();
  if (!u || !u.password_hash || !ok) {
    if (u?.password_hash) {
      await sql()`update users set
        failed_logins = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_logins + 1 end,
        locked_until = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS} then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
        where id = ${u.id}`;
    }
    throw INVALID();
  }
  if (u.status === 'banned') throw forbidden('Аккаунт заблокирован');
  await sql()`update users set failed_logins = 0, locked_until = null, last_seen_at = now() where id = ${u.id}`;
  return { accessToken: await tokenFor(u) };
}

/** Добавить почту и пароль к аккаунту (в первую очередь — Telegram-клиентам). */
export async function setCredentials(user: UserRow, emailRaw: string, password: string): Promise<{ email: string; hasPassword: true }> {
  const email = emailSchema.parse(emailRaw);
  passwordSchema.parse(password);
  assertStrong(password, email);
  if (user.password_hash) throw conflict('Пароль уже задан. Используйте смену пароля.', 'password_exists');
  const hash = await hashPassword(password);
  try {
    const rows = await sql()`update users set email = ${email}, password_hash = ${hash} where id = ${user.id} and password_hash is null returning id`;
    if (!rows.length) throw conflict('Пароль уже задан. Используйте смену пароля.', 'password_exists');
  } catch (e: any) {
    if (isUnique(e, 'email')) throw conflict('Эта почта уже используется другим аккаунтом', 'email_taken');
    throw e;
  }
  return { email, hasPassword: true };
}

/** Смена пароля: прежние токены перестают действовать, возвращается новый. */
export async function changePassword(user: UserRow, current: string, next: string): Promise<{ accessToken: string }> {
  passwordSchema.parse(next);
  if (!user.password_hash) throw conflict('Пароль ещё не задан', 'no_password');
  if (!(await verifyPassword(current, user.password_hash))) throw unauthorized('Неверный текущий пароль', 'invalid_credentials');
  assertStrong(next, user.email);
  const hash = await hashPassword(next);
  const [u] = await sql()<UserRow[]>`update users set password_hash = ${hash}, session_epoch = session_epoch + 1, failed_logins = 0, locked_until = null
    where id = ${user.id} returning *`;
  return { accessToken: await tokenFor(u!) };
}

// ---------- действия, подтверждаемые через бота ----------

function botUrl(prefix: 'link' | 'reset', token: string): string | null {
  const bot = config().BOT_USERNAME;
  return bot ? `https://t.me/${bot}?start=${prefix}_${token}` : null;
}

async function createAction(purpose: 'tg_link' | 'pw_reset', userId: string | null): Promise<string> {
  const token = randomToken(18);
  await sql()`delete from account_actions where expires_at < now()`;
  await sql()`insert into account_actions (token, purpose, user_id, expires_at)
    values (${token}, ${purpose}, ${userId}, now() + make_interval(secs => ${ACTION_TTL_SEC}))`;
  return token;
}

async function statusOf(token: string, purpose: 'tg_link' | 'pw_reset', userId?: string): Promise<ActionStatus> {
  const [a] = await sql()`select confirmed_at from account_actions
    where token = ${token} and purpose = ${purpose} and expires_at > now() ${userId ? sql()`and user_id = ${userId}` : sql()``}`;
  if (!a) return 'expired';
  return a.confirmed_at ? 'ok' : 'pending';
}

export async function startTelegramLink(user: UserRow): Promise<{ token: string; url: string | null; expiresInSec: number }> {
  if (user.tg_id) throw conflict('Telegram уже привязан', 'already_linked');
  const token = await createAction('tg_link', user.id);
  return { token, url: botUrl('link', token), expiresInSec: ACTION_TTL_SEC };
}

export const telegramLinkStatus = (user: UserRow, token: string) => statusOf(token, 'tg_link', user.id);

/** Сброс пароля: ответ одинаков для любой почты, подтвердить его сможет только привязанный к аккаунту Telegram. */
export async function startPasswordReset(emailRaw: string): Promise<{ token: string; url: string | null; expiresInSec: number }> {
  const email = emailSchema.parse(emailRaw);
  const [u] = await sql()<{ id: string }[]>`select id from users where email = ${email} and password_hash is not null`;
  const token = await createAction('pw_reset', u?.id ?? null);
  return { token, url: botUrl('reset', token), expiresInSec: ACTION_TTL_SEC };
}

export const passwordResetStatus = (token: string) => statusOf(token, 'pw_reset');

export async function completePasswordReset(token: string, password: string): Promise<{ accessToken: string }> {
  passwordSchema.parse(password);
  const gone = () => badRequest('Ссылка сброса устарела. Запросите сброс заново.', 'reset_expired');
  const [a] = await sql()`select user_id from account_actions
    where token = ${token} and purpose = 'pw_reset' and confirmed_at is not null and expires_at > now() and user_id is not null`;
  if (!a) throw gone();
  const [user] = await sql()<UserRow[]>`select * from users where id = ${a.user_id}`;
  if (!user) throw gone();
  assertStrong(password, user.email);
  // токен одноразовый: гасим его атомарно, второй параллельный запрос получит отказ
  const used = await sql()`update account_actions set expires_at = now()
    where token = ${token} and purpose = 'pw_reset' and expires_at > now() returning token`;
  if (!used.length) throw gone();
  const hash = await hashPassword(password);
  const [u] = await sql()<UserRow[]>`update users set password_hash = ${hash}, session_epoch = session_epoch + 1, failed_logins = 0, locked_until = null
    where id = ${user.id} returning *`;
  return { accessToken: await tokenFor(u!) };
}

/** Подтверждение из бота (tgId — только из проверенного заголовка бота). */
export async function confirmAccountAction(tgId: number, token: string): Promise<{ purpose: 'tg_link' | 'pw_reset' }> {
  const [a] = await sql()`select * from account_actions where token = ${token} and expires_at > now() and confirmed_at is null`;
  if (!a) throw new HttpError(404, 'Ссылка устарела', 'expired');
  const purpose = a.purpose as 'tg_link' | 'pw_reset';
  if (purpose === 'tg_link') {
    if (!a.user_id) throw new HttpError(404, 'Ссылка устарела', 'expired');
    try {
      await sql().begin(async (tx) => {
        // Бот создаёт Telegram-аккаунт на любое первое сообщение (запрос /gate), поэтому к моменту подтверждения tg_id уже занят
        // только что созданной пустой записью. Такую запись убираем; запись с данными (подписка, платежи, баланс...) не трогаем.
        await tx`delete from users u where u.tg_id = ${tgId} and u.id <> ${a.user_id}
          and u.email is null and u.password_hash is null and u.referrer_id is null
          and u.balance = 0 and u.ref_balance = 0 and not u.trial_used and not u.signup_bonus_done
          and not exists (select 1 from subscriptions s where s.user_id = u.id)
          and not exists (select 1 from payments p where p.user_id = u.id)
          and not exists (select 1 from users r where r.referrer_id = u.id)`;
        const rows = await tx`update users set tg_id = ${tgId} where id = ${a.user_id} and tg_id is null returning id`;
        if (!rows.length) throw conflict('Telegram уже привязан к этому аккаунту', 'already_linked');
      });
    } catch (e: any) {
      if (isUnique(e, 'tg_id')) throw conflict('Этот Telegram уже привязан к другому аккаунту', 'tg_taken');
      throw e;
    }
  } else {
    const [u] = a.user_id ? await sql()<UserRow[]>`select * from users where id = ${a.user_id}` : [];
    // одинаковый отказ для неизвестной почты, аккаунта без Telegram и чужого Telegram
    if (!u || u.tg_id == null || Number(u.tg_id) !== tgId) throw new HttpError(403, 'Этот Telegram не привязан к этому аккаунту', 'tg_mismatch');
  }
  const done = await sql()`update account_actions set confirmed_at = now() where token = ${token} and confirmed_at is null returning token`;
  if (!done.length) throw new HttpError(404, 'Ссылка устарела', 'expired');
  return { purpose };
}
