import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { clearSettingsCache, setSettings } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { signUserToken } from '../src/lib/jwt.js';

const M = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let tgSerial = 910000;

const bot = (tgId: number) => ({ 'x-internal-key': 'internal-key-for-tests', 'x-tg-user': Buffer.from(JSON.stringify({ id: tgId, first_name: 'T' })).toString('base64') });
async function call(method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await app.inject({ method, url: '/api/v1' + url, payload: payload as any, headers });
  return { status: r.statusCode, body: r.json() as any };
}
const auth = (t: string) => ({ authorization: 'Bearer ' + t });
const register = async (email = 'ivan@example.com', password = 'correct horse') => (await call('POST', '/auth/email/register', { email, password })).body.accessToken as string;

beforeAll(async () => {
  await sql()`drop schema public cascade`;
  await sql()`create schema public`;
  await migrate();
  app = await buildApp({ logger: false });
});
beforeEach(async () => {
  await sql()`truncate users, settings, account_actions cascade`;
  clearSettingsCache();
});
afterAll(async () => {
  await app.close();
  await closeDb();
  for (const m of Object.values(M) as any[]) m.server.close();
});

describe('регистрация и вход по почте', () => {
  it('регистрирует, отдаёт токен и профиль без Telegram', async () => {
    const r = await call('POST', '/auth/email/register', { email: '  Ivan@Example.COM ', password: 'correct horse' });
    expect(r.status).toBe(200);
    const me = await call('GET', '/me', undefined, auth(r.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'ivan@example.com', hasPassword: true, tgId: null, trialAvailable: false });
    const [row] = await sql()`select password_hash, referral_code from users where email = 'ivan@example.com'`;
    expect(row!.password_hash).toMatch(/^scrypt\$/);
    expect(row!.password_hash).not.toContain('correct horse');
    expect(row!.referral_code).toBeTruthy();
  });

  it('отклоняет дубль почты (без учёта регистра), короткий пароль и пароль, равный почте', async () => {
    await register('ivan@example.com');
    const dup = await call('POST', '/auth/email/register', { email: 'IVAN@example.com', password: 'another pass1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('email_taken');
    expect((await call('POST', '/auth/email/register', { email: 'a@example.com', password: 'short' })).status).toBe(400);
    const same = await call('POST', '/auth/email/register', { email: 'same@example.com', password: 'same@example.com' });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('weak_password');
    expect((await call('POST', '/auth/email/register', { email: 'not-an-email', password: 'long enough pass' })).status).toBe(400);
  });

  it('вход: верный пароль даёт токен, а все причины отказа неотличимы', async () => {
    await register('ivan@example.com', 'correct horse');
    const ok = await call('POST', '/auth/email/login', { email: 'IVAN@example.com', password: 'correct horse' });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/me', undefined, auth(ok.body.accessToken))).status).toBe(200);

    await upsertTelegramUser({ id: tgSerial++, first_name: 'OnlyTg' } as any, null);
    const wrong = await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'wrong password' });
    const unknown = await call('POST', '/auth/email/login', { email: 'nobody@example.com', password: 'whatever pass' });
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('invalid_credentials');
    }
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('аккаунт без пароля (только Telegram) не пускает по почте', async () => {
    const u = await upsertTelegramUser({ id: tgSerial++, first_name: 'Tg' } as any, null);
    await sql()`update users set email = 'tg@example.com' where id = ${u.id}`;
    const r = await call('POST', '/auth/email/login', { email: 'tg@example.com', password: 'anything long' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('invalid_credentials');
  });

  it('блокирует аккаунт на 15 минут после 5 неудач, даже с верным паролем; потом пускает', async () => {
    await register('ivan@example.com', 'correct horse');
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'bad password' + i })).status).toBe(401);
    const locked = await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'correct horse' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('locked');
    await sql()`update users set locked_until = now() - interval '1 minute' where email = 'ivan@example.com'`;
    expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'correct horse' })).status).toBe(200);
    const [u] = await sql()`select failed_logins, locked_until from users where email = 'ivan@example.com'`;
    expect(u).toMatchObject({ failed_logins: 0, locked_until: null });
  });

  it('заблокированный администратором пользователь не входит', async () => {
    await register('ivan@example.com', 'correct horse');
    await sql()`update users set status = 'banned' where email = 'ivan@example.com'`;
    expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'correct horse' })).status).toBe(403);
  });
});

describe('почта для Telegram-аккаунта и смена пароля', () => {
  it('Telegram-клиент добавляет почту и пароль и входит по ним', async () => {
    const u = await upsertTelegramUser({ id: tgSerial++, first_name: 'Старый клиент' } as any, null);
    const tok = await signUserToken(u.id, u.session_epoch);
    const r = await call('POST', '/me/credentials', { email: 'Old@Example.com', password: 'my new pass 1' }, auth(tok));
    expect(r.body).toEqual({ email: 'old@example.com', hasPassword: true });
    expect((await call('POST', '/auth/email/login', { email: 'old@example.com', password: 'my new pass 1' })).status).toBe(200);
    const me = await call('GET', '/me', undefined, auth(tok));
    expect(me.body).toMatchObject({ email: 'old@example.com', hasPassword: true, tgId: Number(u.tg_id) });
    const again = await call('POST', '/me/credentials', { email: 'other@example.com', password: 'my new pass 2' }, auth(tok));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('password_exists');
  });

  it('нельзя занять чужую почту', async () => {
    await register('taken@example.com');
    const u = await upsertTelegramUser({ id: tgSerial++, first_name: 'X' } as any, null);
    const r = await call('POST', '/me/credentials', { email: 'taken@example.com', password: 'my new pass 1' }, auth(await signUserToken(u.id, u.session_epoch)));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('email_taken');
  });

  it('смена пароля: нужен текущий, старые токены перестают действовать, выдаётся новый', async () => {
    const oldTok = await register('ivan@example.com', 'correct horse');
    expect((await call('POST', '/me/password', { currentPassword: 'wrong one', newPassword: 'brand new pass' }, auth(oldTok))).status).toBe(401);
    const ok = await call('POST', '/me/password', { currentPassword: 'correct horse', newPassword: 'brand new pass' }, auth(oldTok));
    expect(ok.status).toBe(200);
    expect((await call('GET', '/me', undefined, auth(oldTok))).status).toBe(401);
    expect((await call('GET', '/me', undefined, auth(ok.body.accessToken))).status).toBe(200);
    expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'correct horse' })).status).toBe(401);
    expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'brand new pass' })).status).toBe(200);
  });

  it('токен без эпохи (выданный до обновления) продолжает работать, пока пароль не менялся', async () => {
    const u = await upsertTelegramUser({ id: tgSerial++, first_name: 'Legacy' } as any, null);
    expect((await call('GET', '/me', undefined, auth(await signUserToken(u.id)))).status).toBe(200);
  });
});

describe('привязка Telegram и сброс пароля через бота', () => {
  it('привязка Telegram к аккаунту по почте', async () => {
    const tok = await register();
    const tg = tgSerial++;
    const start = await call('POST', '/me/telegram/link/start', {}, auth(tok));
    expect(start.status).toBe(200);
    expect(start.body.url).toBe(`https://t.me/test_vpn_bot?start=link_${start.body.token}`);
    expect((await call('GET', `/me/telegram/link/${start.body.token}`, undefined, auth(tok))).body.status).toBe('pending');
    const conf = await call('POST', '/internal/account-action/confirm', { token: start.body.token }, bot(tg));
    expect(conf.body).toEqual({ purpose: 'tg_link' });
    expect((await call('GET', `/me/telegram/link/${start.body.token}`, undefined, auth(tok))).body.status).toBe('ok');
    expect((await call('GET', '/me', undefined, auth(tok))).body.tgId).toBe(tg);
    expect((await call('POST', '/me/telegram/link/start', {}, auth(tok))).status).toBe(409);
  });

  it('пустой аккаунт, который бот создал на первое сообщение, не мешает привязке и убирается', async () => {
    const tg = tgSerial++;
    await upsertTelegramUser({ id: tg, first_name: 'Только что открыл бота' } as any, null);
    const tok = await register();
    const start = await call('POST', '/me/telegram/link/start', {}, auth(tok));
    expect((await call('POST', '/internal/account-action/confirm', { token: start.body.token }, bot(tg))).status).toBe(200);
    expect((await call('GET', '/me', undefined, auth(tok))).body.tgId).toBe(tg);
    expect((await sql()`select count(*)::int as n from users where tg_id = ${tg}`)[0]!.n).toBe(1);
  });

  it('Telegram, уже принадлежащий другому аккаунту с данными, не привязывается', async () => {
    const tg = tgSerial++;
    const other = await upsertTelegramUser({ id: tg, first_name: 'Занят' } as any, null);
    await sql()`update users set balance = 10000 where id = ${other.id}`;
    const tok = await register();
    const start = await call('POST', '/me/telegram/link/start', {}, auth(tok));
    const conf = await call('POST', '/internal/account-action/confirm', { token: start.body.token }, bot(tg));
    expect(conf.status).toBe(409);
    expect(conf.body.error.code).toBe('tg_taken');
  });

  it('сброс пароля: только привязанный Telegram, токен одноразовый, старые сессии гаснут', async () => {
    const oldTok = await register('ivan@example.com', 'correct horse');
    const tg = tgSerial++;
    const link = await call('POST', '/me/telegram/link/start', {}, auth(oldTok));
    await call('POST', '/internal/account-action/confirm', { token: link.body.token }, bot(tg));

    const start = await call('POST', '/auth/email/reset/start', { email: 'Ivan@Example.com' });
    expect(start.status).toBe(200);
    expect(start.body.url).toBe(`https://t.me/test_vpn_bot?start=reset_${start.body.token}`);
    expect((await call('GET', `/auth/email/reset/${start.body.token}`)).body.status).toBe('pending');
    // без подтверждения сбросить нельзя
    expect((await call('POST', '/auth/email/reset/complete', { token: start.body.token, password: 'brand new pass' })).body.error.code).toBe('reset_expired');
    // чужой Telegram
    const alien = await call('POST', '/internal/account-action/confirm', { token: start.body.token }, bot(tgSerial++));
    expect(alien.status).toBe(403);
    expect(alien.body.error.code).toBe('tg_mismatch');
    // свой Telegram
    expect((await call('POST', '/internal/account-action/confirm', { token: start.body.token }, bot(tg))).body).toEqual({ purpose: 'pw_reset' });
    expect((await call('GET', `/auth/email/reset/${start.body.token}`)).body.status).toBe('ok');

    const done = await call('POST', '/auth/email/reset/complete', { token: start.body.token, password: 'brand new pass' });
    expect(done.status).toBe(200);
    expect((await call('GET', '/me', undefined, auth(done.body.accessToken))).status).toBe(200);
    expect((await call('GET', '/me', undefined, auth(oldTok))).status).toBe(401);
    expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'brand new pass' })).status).toBe(200);
    expect((await call('POST', '/auth/email/reset/complete', { token: start.body.token, password: 'yet another pass' })).body.error.code).toBe('reset_expired');
    expect((await call('GET', `/auth/email/reset/${start.body.token}`)).body.status).toBe('expired');
  });

  it('сброс снимает блокировку входа', async () => {
    const tok = await register('ivan@example.com', 'correct horse');
    const tg = tgSerial++;
    await call('POST', '/internal/account-action/confirm', { token: (await call('POST', '/me/telegram/link/start', {}, auth(tok))).body.token }, bot(tg));
    for (let i = 0; i < 5; i++) await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'bad password' + i });
    expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'correct horse' })).status).toBe(429);
    const s = await call('POST', '/auth/email/reset/start', { email: 'ivan@example.com' });
    await call('POST', '/internal/account-action/confirm', { token: s.body.token }, bot(tg));
    await call('POST', '/auth/email/reset/complete', { token: s.body.token, password: 'brand new pass' });
    expect((await call('POST', '/auth/email/login', { email: 'ivan@example.com', password: 'brand new pass' })).status).toBe(200);
  });

  it('сброс для неизвестной почты неотличим по форме ответа и никого не создаёт', async () => {
    await register('ivan@example.com');
    const known = await call('POST', '/auth/email/reset/start', { email: 'ivan@example.com' });
    const unknown = await call('POST', '/auth/email/reset/start', { email: 'nobody@example.com' });
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());
    expect(unknown.status).toBe(known.status);
    const before = (await sql()`select count(*)::int as n from users`)[0]!.n;
    const conf = await call('POST', '/internal/account-action/confirm', { token: unknown.body.token }, bot(tgSerial++));
    expect(conf.status).toBe(403);
    expect((await sql()`select count(*)::int as n from users`)[0]!.n).toBe(before);
  });

  it('аккаунт по почте без привязанного Telegram сбросить нельзя', async () => {
    await register('ivan@example.com');
    const s = await call('POST', '/auth/email/reset/start', { email: 'ivan@example.com' });
    expect((await call('POST', '/internal/account-action/confirm', { token: s.body.token }, bot(tgSerial++))).status).toBe(403);
  });

  it('просроченная ссылка считается истёкшей', async () => {
    const s = await call('POST', '/auth/email/reset/start', { email: 'ivan@example.com' });
    await sql()`update account_actions set expires_at = now() - interval '1 second'`;
    expect((await call('GET', `/auth/email/reset/${s.body.token}`)).body.status).toBe('expired');
    expect((await call('POST', '/internal/account-action/confirm', { token: s.body.token }, bot(tgSerial++))).status).toBe(404);
  });

  it('внутренний эндпоинт доступен только боту', async () => {
    expect((await call('POST', '/internal/account-action/confirm', { token: 'x'.repeat(20) })).status).toBe(401);
    expect((await call('POST', '/internal/account-action/confirm', { token: 'x'.repeat(20) }, { 'x-internal-key': 'internal-key-for-tests' })).status).toBe(401);
    expect((await call('POST', '/internal/account-action/confirm', { token: 'x'.repeat(20) }, { 'x-internal-key': 'wrong', 'x-tg-user': bot(1)['x-tg-user'] })).status).toBe(401);
  });
});

describe('аккаунт по почте не обходит правила, державшиеся на Telegram', () => {
  it('пробный период требует Telegram', async () => {
    const tok = await register();
    const r = await call('POST', '/subscription/trial', {}, auth(tok));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('telegram_required');
    expect((await call('GET', '/me', undefined, auth(tok))).body.trialAvailable).toBe(false);
    await call('POST', '/internal/account-action/confirm', { token: (await call('POST', '/me/telegram/link/start', {}, auth(tok))).body.token }, bot(tgSerial++));
    expect((await call('GET', '/me', undefined, auth(tok))).body.trialAvailable).toBe(true);
  });

  it('при включённом шлюзе канала просит привязать Telegram, но профиль и привязка доступны', async () => {
    await setSettings('gate', { enabled: true, mode: 'hard', chats: [{ chat: '@vaylo_test', title: '', url: '' }] } as any);
    const tok = await register();
    const blocked = await call('GET', '/subscription', undefined, auth(tok));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('telegram_required');
    const me = await call('GET', '/me', undefined, auth(tok));
    expect(me.status).toBe(200);
    expect(me.body.gate).toMatchObject({ required: true, ok: false, needTelegram: true });
    expect((await call('POST', '/me/telegram/link/start', {}, auth(tok))).status).toBe(200);
  });

  it('при выключенном шлюзе ничего не блокируется', async () => {
    const tok = await register();
    expect((await call('GET', '/subscription', undefined, auth(tok))).status).toBe(200);
  });
});
