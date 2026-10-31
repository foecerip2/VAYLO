import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, rateLimitError, rateLimitKey } from '../src/app.js';
import { closeDb, sql } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/lib/crypto.js';
import { totpAt } from '../src/lib/totp.js';
import { expireLocations } from '../src/services/addons.js';
import { autoRenew } from '../src/services/autorenew.js';
import { fulfillPayment } from '../src/services/payments.js';
import { seedDefaultPlans } from '../src/services/plans.js';
import { clearSquadCache, describePanelErrors, remnawave, RW_USER_MESSAGE } from '../src/services/remnawave.js';
import { clearSettingsCache } from '../src/services/settings.js';
import { extendDays } from '../src/services/subscriptions.js';
import { retryUnfulfilled } from '../src/worker.js';
import { makeInitData } from './helpers/initdata.js';

const M = (globalThis as any).__mocks as {
  rw: Awaited<ReturnType<typeof import('./helpers/mocks.js').startRemnawaveMock>>;
  yk: Awaited<ReturnType<typeof import('./helpers/mocks.js').startYookassaMock>>;
  pl: Awaited<ReturnType<typeof import('./helpers/mocks.js').startPlategaMock>>;
  tg: Awaited<ReturnType<typeof import('./helpers/mocks.js').startTelegramMock>>;
};

let app: FastifyInstance;
let adminToken = '';

async function api(method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.inject({
    method: method as any,
    url: '/api/v1' + url,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    payload: opts.body as any,
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    /* not json */
  }
  return { status: res.statusCode, json };
}
async function loginUser(tgId: number) {
  const r = await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: tgId, first_name: 'T', username: 'u' + tgId }) } });
  expect(r.status).toBe(200);
  return r.json.accessToken as string;
}
const put = (group: string, body: unknown) => api('PUT', `/admin/settings/${group}`, { token: adminToken, body });
const adm = (m: string, u: string, body?: unknown) => api(m, '/admin' + u, { token: adminToken, body });
const userId = async (tg: number) => (await sql()`select id from users where tg_id = ${tg}`)[0]!.id as string;
const setBalance = async (tg: number, kop: number) => void (await sql()`update users set balance = ${kop} where tg_id = ${tg}`);
const balance = async (tg: number) => Number((await sql()`select balance from users where tg_id = ${tg}`)[0]!.balance);
const plan30 = async () => (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30);
const rwUser = (tg: number) => [...M.rw.state.users.values()].find((u) => u.username === `tg_${tg}`);
const tick = () => new Promise((r) => setTimeout(r, 150));

async function payYk(token: string, body: Record<string, unknown>) {
  const c = await api('POST', '/payments', { token, body: { method: 'yookassa', ...body } });
  expect(c.status).toBe(200);
  const [p] = await sql()`select external_id from payments where id = ${c.json.id}`;
  M.yk.state.statusOverride = 'succeeded';
  await api('POST', '/webhooks/yookassa', { body: { object: { id: p!.external_id } } });
  M.yk.state.statusOverride = null;
  return { id: c.json.id as string, ext: p!.external_id as string };
}

beforeAll(async () => {
  await sql()`drop schema public cascade`;
  await sql()`create schema public`;
  await migrate();
  app = await buildApp({ logger: false });
});
afterAll(async () => {
  await app.close();
  await closeDb();
  for (const m of Object.values(M)) m.server.close();
});
beforeEach(async () => {
  // фоновые задачи прошлого теста (уведомления, награды) ещё могут держать блокировки: при взаимной блокировке просто повторяем
  for (let attempt = 0; ; attempt++) {
    try {
      await sql()`truncate users, plans, subscriptions, payments, promo_codes, promo_uses, transactions, referral_rewards, settings, admins, audit_log, broadcasts, auth_links, partner_links, quest_claims, locations, addon_products, user_locations, monitor_state, monitor_events cascade`;
      break;
    } catch (e) {
      if ((e as { code?: string }).code !== '40P01' || attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  clearSettingsCache();
  clearSquadCache();
  M.rw.state.users.clear();
  M.rw.state.calls.length = 0;
  M.rw.state.fail = false;
  M.rw.state.squads = [{ uuid: M.rw.state.squadUuid, name: 'Default-Squad' }];
  M.yk.state.payments.clear();
  M.yk.state.refunds.clear();
  M.yk.state.statusOverride = null;
  M.tg.state.messages.length = 0;
  M.tg.state.members.clear();
  M.tg.state.down = false;
  await seedDefaultPlans();
  await sql()`insert into admins (email, password_hash, role, tg_id) values ('owner@test.dev', ${await hashPassword('super-secret-pass')}, 'owner', 9001)`;
  adminToken = (await api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'super-secret-pass' } })).json.accessToken;
  expect((await put('yookassa', { enabled: true, shop_id: M.yk.shopId, secret_key: M.yk.secret })).status).toBe(200);
});

describe('инцидент: 400 Validation failed при триале', () => {
  it('битый squad_uuid в настройках (записан в БД напрямую) не ломает триал: запасной сквад + алерт админу', async () => {
    await sql()`insert into settings (key, value) values ('remnawave', ${sql().json({ squad_uuid: 'my squad 1' })}) on conflict (key) do update set value = excluded.value`;
    clearSettingsCache();
    const t = await loginUser(2001);
    const r = await api('POST', '/subscription/trial', { token: t });
    expect(r.status).toBe(200);
    expect(rwUser(2001).activeInternalSquads).toEqual([M.rw.state.squadUuid]);
    await tick();
    const alert = M.tg.state.messages.find((m) => m.chat_id === 9001 && m.text.includes('сквад'));
    expect(alert?.text).toContain('my squad 1');
  });

  it('несуществующий в панели squad_uuid → запасной «Default», алерт один раз (троттлинг)', async () => {
    const other = randomUUID();
    M.rw.state.squads = [
      { uuid: other, name: 'Premium' },
      { uuid: M.rw.state.squadUuid, name: 'Default-Squad' },
    ];
    expect((await put('remnawave', { squad_uuid: randomUUID() })).status).toBe(200);
    await loginUser(2002);
    await loginUser(2003);
    for (const tg of [2002, 2003]) expect((await api('POST', '/subscription/trial', { token: await loginUser(tg) })).status).toBe(200);
    expect(rwUser(2002).activeInternalSquads).toEqual([M.rw.state.squadUuid]);
    await tick();
    expect(M.tg.state.messages.filter((m) => m.chat_id === 9001 && m.text.includes('не найден в панели'))).toHaveLength(1);
  });

  it('настройки и локации: UUID валидируется по-русски', async () => {
    const bad = await put('remnawave', { squad_uuid: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toContain('UUID сквада');
    const id = randomUUID();
    expect((await put('remnawave', { squad_uuid: `  ${id} ` })).json.squad_uuid).toBe(id);
    expect((await put('remnawave', { squad_uuid: '' })).status).toBe(200);
    const loc = await adm('POST', '/locations', { name: 'X', squadUuid: 'not-a-uuid' });
    expect(loc.status).toBe(400);
    expect(loc.json.error.message).toContain('UUID');
    expect((await adm('POST', '/locations', { name: 'X', squadUuid: ` ${randomUUID()} ` })).status).toBe(200);
  });

  it('тест подключения Remnawave сообщает имя сквада или русскую проблему', async () => {
    const ok = await adm('POST', '/settings/test/remnawave');
    expect(ok.json).toMatchObject({ ok: true, squadName: 'Default-Squad' });
    await put('remnawave', { squad_uuid: randomUUID() });
    const bad = await adm('POST', '/settings/test/remnawave');
    expect(bad.json.ok).toBe(false);
    expect(bad.json.error).toContain('не найден в панели');
  });

  it('createUser/updateUser чистят payload: невалидные сквады отбрасываются, числа целые, описание обрезается', async () => {
    const sq = M.rw.state.squadUuid;
    const u = await remnawave.createUser({
      username: 'tg_777', expireAt: new Date(Date.now() + 86400_000), trafficLimitBytes: 1.7, hwidDeviceLimit: -3,
      description: '  ' + 'x'.repeat(500), activeInternalSquads: ['garbage', sq, sq, ' ' + sq + ' '],
    });
    const stored = M.rw.state.users.get(u.id);
    expect(stored.activeInternalSquads).toEqual([sq]);
    expect(stored.trafficLimitBytes).toBe(2);
    expect(stored.hwidDeviceLimit).toBe(0);
    await expect(remnawave.createUser({ username: 'a b', expireAt: new Date(), trafficLimitBytes: 0, hwidDeviceLimit: 1 })).rejects.toThrow(/имя пользователя/);
    await remnawave.updateUser(u.id, { activeInternalSquads: ['nope'] });
    expect(M.rw.state.users.get(u.id).activeInternalSquads).toEqual([sq]); // пустой/битый список не затирает сквады
  });

  it('ошибки панели: детали zod-issues попадают в сообщение (для логов/админа), пользователю — дружелюбный текст', async () => {
    expect(describePanelErrors({ message: 'Validation failed', errors: [{ path: ['activeInternalSquads', 0], message: 'Invalid UUID' }] })).toBe('activeInternalSquads.0: Invalid UUID');
    const t = await loginUser(2010);
    M.rw.state.fail = true;
    const r = await api('POST', '/subscription/trial', { token: t });
    expect(r.status).toBe(502);
    expect(r.json.error.message).toBe(RW_USER_MESSAGE);
    expect(r.json.error.message).not.toMatch(/Remnawave|boom|→/);
    await tick();
    const alert = M.tg.state.messages.find((m) => m.chat_id === 9001 && m.text.includes('Ошибка Remnawave'));
    expect(alert?.text).toContain('boom');
    // провайдеры платежей: сырой ответ не виден пользователю
    await put('yookassa', { enabled: true, shop_id: 'x', secret_key: 'bad' });
    const pay = await api('POST', '/payments', { token: t, body: { planId: (await plan30()).id, method: 'yookassa' } });
    expect(pay.status).toBe(502);
    expect(pay.json.error.message).toContain('платёжный сервис');
    expect(pay.json.error.message).not.toMatch(/YooKassa|Basic auth/);
  });
});

describe('русские сообщения и лимиты', () => {
  it('валидация zod — по-русски', async () => {
    const t = await loginUser(2020);
    const r = await api('POST', '/payments', { token: t, body: { method: 'yookassa' } });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/[А-Яа-я]/);
    const r2 = await api('POST', '/auto-none', { token: t });
    expect(r2.status).toBe(404);
    const r3 = await api('POST', '/promo/redeem', { token: t, body: { code: '' } });
    expect(r3.json.error.message).toBe('Поле не может быть пустым');
    const r4 = await api('POST', '/promo/redeem', { token: t, body: {} });
    expect(r4.json.error.message).toBe('Обязательное поле');
  });

  it('ключ лимита: бот — по Telegram ID, пользователь с верным токеном — по id, остальные — по IP; сообщение 429 по-русски', async () => {
    const tgHeader = (id: number) => Buffer.from(JSON.stringify({ id })).toString('base64');
    const req = (h: Record<string, string>) => ({ headers: h, ip: '10.0.0.5' }) as any;
    const key = 'internal-key-for-tests';
    expect(await rateLimitKey(req({ 'x-internal-key': key, 'x-tg-user': tgHeader(42) }))).toBe('tg:42');
    expect(await rateLimitKey(req({ 'x-internal-key': key, 'x-tg-user': tgHeader(43) }))).toBe('tg:43');
    expect(await rateLimitKey(req({ 'x-internal-key': 'wrong', 'x-tg-user': tgHeader(42) }))).toBe('10.0.0.5'); // без ключа заголовку не верим
    expect(await rateLimitKey(req({ 'x-internal-key': key, 'x-tg-user': '%%%' }))).toBe('10.0.0.5');
    expect(await rateLimitKey(req({}))).toBe('10.0.0.5');
    const { signUserToken } = await import('../src/lib/jwt.js');
    const tok = await signUserToken('11111111-1111-4111-8111-111111111111');
    expect(await rateLimitKey(req({ authorization: `Bearer ${tok}` }))).toBe('u:11111111-1111-4111-8111-111111111111'); // одинаковый IP у разных людей не мешает
    expect(await rateLimitKey(req({ authorization: 'Bearer fake.token.value' }))).toBe('10.0.0.5'); // подделка — по IP
    expect(rateLimitError({} as any, { statusCode: 429, after: '1 minute' }).message).toBe('Слишком много запросов, попробуйте через минуту');
  });
});

describe('промокоды: атомарность и лимиты', () => {
  it('подарочный код с max_uses=1 при параллельном погашении двумя людьми — один успех', async () => {
    await adm('POST', '/promo', { code: 'ONCE', type: 'balance', value: 5000, maxUses: 1 });
    const a = await loginUser(2101);
    const b = await loginUser(2102);
    const rs = await Promise.all([api('POST', '/promo/redeem', { token: a, body: { code: 'ONCE' } }), api('POST', '/promo/redeem', { token: b, body: { code: 'ONCE' } })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await balance(2101)) + (await balance(2102))).toBe(5000);
    expect((await sql()`select used from promo_codes where code = 'ONCE'`)[0]!.used).toBe(1);
  });

  it('один пользователь, параллельные запросы одного кода: начислено один раз', async () => {
    await adm('POST', '/promo', { code: 'GIFT', type: 'days', value: 7 });
    const a = await loginUser(2103);
    const rs = await Promise.all([1, 2, 3].map(() => api('POST', '/promo/redeem', { token: a, body: { code: 'GIFT' } })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await api('GET', '/subscription', { token: a })).json.daysLeft).toBe(7);
    expect((await sql()`select used from promo_codes where code = 'GIFT'`)[0]!.used).toBe(1);
  });

  it('скидочный код с max_uses=1: резерв при создании платежа, освобождается при отмене', async () => {
    await adm('POST', '/promo', { code: 'SALE', type: 'percent', value: 50, maxUses: 1 });
    const a = await loginUser(2104);
    const b = await loginUser(2105);
    const plan = await plan30();
    const c1 = await api('POST', '/payments', { token: a, body: { planId: plan.id, method: 'yookassa', promo: 'SALE' } });
    expect(c1.status).toBe(200);
    // параллельно второй пользователь не может занять тот же единственный код
    const q = await api('POST', '/quote', { token: b, body: { planId: plan.id, promo: 'SALE' } });
    expect(q.status).toBe(400);
    expect((await api('POST', '/payments', { token: b, body: { planId: plan.id, method: 'yookassa', promo: 'SALE' } })).status).toBe(400);
    // отмена платежа освобождает код
    M.yk.state.statusOverride = 'canceled';
    expect((await api('GET', `/payments/${c1.json.id}`, { token: a })).json.status).toBe('canceled');
    M.yk.state.statusOverride = null;
    expect((await sql()`select used from promo_codes where code = 'SALE'`)[0]!.used).toBe(0);
    expect((await api('POST', '/payments', { token: b, body: { planId: plan.id, method: 'yookassa', promo: 'SALE' } })).status).toBe(200);
  });

  it('параллельное создание платежей с кодом max_uses=1 — проходит только один', async () => {
    await adm('POST', '/promo', { code: 'RACE', type: 'percent', value: 10, maxUses: 1 });
    const tokens = await Promise.all([2110, 2111, 2112].map(loginUser));
    const plan = await plan30();
    const rs = await Promise.all(tokens.map((t) => api('POST', '/payments', { token: t, body: { planId: plan.id, method: 'yookassa', promo: 'RACE' } })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await sql()`select used from promo_codes where code = 'RACE'`)[0]!.used).toBe(1);
  });

  it('успешная оплата со скидкой не использует код повторно (резерв уже учтён)', async () => {
    await adm('POST', '/promo', { code: 'PAID', type: 'percent', value: 10, maxUses: 5 });
    const a = await loginUser(2106);
    await payYk(a, { planId: (await plan30()).id, promo: 'PAID' });
    expect((await sql()`select used from promo_codes where code = 'PAID'`)[0]!.used).toBe(1);
    expect((await sql()`select count(*)::int as n from promo_uses`)[0]!.n).toBe(1);
  });
});

describe('постоянные сбои выдачи → баланс', () => {
  async function addonPaymentWithoutSub(tg: number) {
    const t = await loginUser(tg);
    const uid = await userId(tg);
    const [p] = await sql()`insert into payments (user_id, provider, purpose, plan_name, amount, status, paid_at, payload)
      values (${uid}, 'yookassa', 'addon', '+2 устройства', 5000, 'succeeded', now(), ${sql().json({ addon: { kind: 'devices', qty: 2 } })}) returning id`;
    return { t, id: p!.id as string };
  }

  it('addon без подписки: деньги на баланс, платёж не повторяется, флаги в GET /payments/:id', async () => {
    const { t, id } = await addonPaymentWithoutSub(2201);
    expect(await fulfillPayment(id)).toBe('failed');
    expect(await balance(2201)).toBe(5000);
    expect(await fulfillPayment(id)).toBe('skipped'); // идемпотентно: второй раз не начисляем
    expect(await retryUnfulfilled()).toBe(0);
    expect(await balance(2201)).toBe(5000);
    const p = await api('GET', `/payments/${id}`, { token: t });
    expect(p.json).toMatchObject({ status: 'succeeded', fulfilled: false, fulfillFailed: true, refundedToBalance: true });
    const tx = await sql()`select type, amount from transactions where payment_id = ${id}`;
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: 'refund', amount: 5000 });
    await tick();
    expect(M.tg.state.messages.some((m) => m.chat_id === 2201 && m.text.includes('зачислена на ваш баланс'))).toBe(true);
    expect(M.tg.state.messages.some((m) => m.chat_id === 9001 && m.text.includes('не выдан'))).toBe(true);
  });

  it('забаненный пользователь оплатил тариф → баланс; временный сбой панели — по-прежнему ретрай, без возврата', async () => {
    const t = await loginUser(2202);
    const plan = await plan30();
    const c = await api('POST', '/payments', { token: t, body: { planId: plan.id, method: 'yookassa' } });
    await sql()`update users set status = 'banned' where tg_id = 2202`;
    const [p] = await sql()`select external_id from payments where id = ${c.json.id}`;
    M.yk.state.statusOverride = 'succeeded';
    await api('POST', '/webhooks/yookassa', { body: { object: { id: p!.external_id } } });
    expect(await balance(2202)).toBe(plan.price);

    const t2 = await loginUser(2203);
    const c2 = await api('POST', '/payments', { token: t2, body: { planId: plan.id, method: 'yookassa' } });
    const [p2] = await sql()`select external_id from payments where id = ${c2.json.id}`;
    M.rw.state.fail = true;
    await api('POST', '/webhooks/yookassa', { body: { object: { id: p2!.external_id } } });
    expect(await balance(2203)).toBe(0);
    const row = (await api('GET', `/payments/${c2.json.id}`, { token: t2 })).json;
    expect(row).toMatchObject({ fulfilled: false, fulfillFailed: true, refundedToBalance: false });
    M.rw.state.fail = false;
    expect(await retryUnfulfilled()).toBe(1);
    expect((await api('GET', '/subscription', { token: t2 })).json.state).toBe('active');
  });
});

describe('возвраты', () => {
  it('YooKassa refund.succeeded по пополнению: списывается с баланса (не ниже 0), статус refunded, проверка через API', async () => {
    const t = await loginUser(2301);
    const { id, ext } = await payYk(t, { topupAmount: 30000 });
    expect(await balance(2301)).toBe(30000);
    await setBalance(2301, 20000); // часть уже потрачена
    const refundId = 'rf-' + randomUUID();
    // без подтверждения в API (refund не найден) — игнорируем/ошибка, баланс не трогаем
    const bad = await api('POST', '/webhooks/yookassa', { body: { event: 'refund.succeeded', object: { id: refundId, payment_id: ext } } });
    expect(bad.status).toBe(500);
    expect(await balance(2301)).toBe(20000);
    M.yk.state.refunds.set(refundId, { id: refundId, status: 'succeeded', payment_id: ext });
    expect((await api('POST', '/webhooks/yookassa', { body: { event: 'refund.succeeded', object: { id: refundId, payment_id: ext } } })).status).toBe(200);
    expect(await balance(2301)).toBe(0);
    expect((await sql()`select status from payments where id = ${id}`)[0]!.status).toBe('refunded');
    const tx = (await sql()`select amount from transactions where payment_id = ${id} and type = 'refund'`)[0]!;
    expect(Number(tx.amount)).toBe(-20000);
    // повтор — не списываем второй раз
    await api('POST', '/webhooks/yookassa', { body: { event: 'refund.succeeded', object: { id: refundId, payment_id: ext } } });
    expect((await sql()`select count(*)::int as n from transactions where payment_id = ${id} and type = 'refund'`)[0]!.n).toBe(1);
    await tick();
    expect(M.tg.state.messages.some((m) => m.chat_id === 9001 && m.text.includes('Возврат платежа за пополнение') && m.text.includes('Не хватило'))).toBe(true);
  });

  it('Platega CHARGEBACKED по тарифу: статус refunded и алерт админам', async () => {
    await put('platega', { enabled: true, merchant_id: M.pl.merchant, secret: M.pl.secret });
    const t = await loginUser(2302);
    const c = await api('POST', '/payments', { token: t, body: { planId: (await plan30()).id, method: 'platega:sbp' } });
    const [p] = await sql()`select external_id from payments where id = ${c.json.id}`;
    const h = { 'x-merchantid': M.pl.merchant, 'x-secret': M.pl.secret };
    M.pl.state.txs.get(p!.external_id).status = 'CONFIRMED';
    await api('POST', '/webhooks/platega', { body: { id: p!.external_id, status: 'CONFIRMED' }, headers: h });
    M.pl.state.txs.get(p!.external_id).status = 'CHARGEBACKED';
    await api('POST', '/webhooks/platega', { body: { id: p!.external_id, status: 'CHARGEBACKED' }, headers: h });
    expect((await sql()`select status from payments where id = ${c.json.id}`)[0]!.status).toBe('refunded');
    await tick();
    const msg = M.tg.state.messages.find((m) => m.chat_id === 9001 && m.text.includes('Возврат платежа за тариф'));
    expect(msg?.text).toContain('u2302');
  });
});

describe('подписки, сквады, локации, докупки', () => {
  async function setupLoc() {
    const squad = randomUUID();
    const loc = (await adm('POST', '/locations', { name: 'DE', squadUuid: squad })).json.id;
    const timed = (await adm('POST', '/addons', { kind: 'location', name: 'DE 30д', price: 1000, qty: 1, locationId: loc, durationDays: 30 })).json.id;
    const forever = (await adm('POST', '/addons', { kind: 'location', name: 'DE навсегда', price: 5000, qty: 1, locationId: loc })).json.id;
    return { squad, loc, timed, forever };
  }

  it('после удаления просроченных локаций продление шлёт явный список сквадов (премиум-сквад убирается)', async () => {
    const a = await setupLoc();
    const t = await loginUser(2401);
    await setBalance(2401, 100000);
    await api('POST', '/payments', { token: t, body: { planId: (await plan30()).id, method: 'balance' } });
    await api('POST', '/payments', { token: t, body: { addonId: a.timed, method: 'balance' } });
    expect(rwUser(2401).activeInternalSquads).toContain(a.squad);
    await sql()`delete from user_locations`; // как после старого воркера
    await extendDays(await userId(2401), 5);
    expect(rwUser(2401).activeInternalSquads).toEqual([M.rw.state.squadUuid]);
  });

  it('expireLocations: при сбое панели строка не удаляется и обработается позже', async () => {
    const a = await setupLoc();
    const t = await loginUser(2402);
    await setBalance(2402, 100000);
    await api('POST', '/payments', { token: t, body: { planId: (await plan30()).id, method: 'balance' } });
    await api('POST', '/payments', { token: t, body: { addonId: a.timed, method: 'balance' } });
    await sql()`update user_locations set expires_at = now() - interval '1 minute'`;
    M.rw.state.fail = true;
    expect(await expireLocations()).toBe(0);
    expect((await sql()`select count(*)::int as n from user_locations`)[0]!.n).toBe(1);
    M.rw.state.fail = false;
    expect(await expireLocations()).toBe(1);
    expect((await sql()`select count(*)::int as n from user_locations`)[0]!.n).toBe(0);
    expect(rwUser(2402).activeInternalSquads).toEqual([M.rw.state.squadUuid]);
  });

  it('неактивная локация не продаётся; срочный пакет не покупается поверх бессрочной локации', async () => {
    const a = await setupLoc();
    const t = await loginUser(2403);
    await setBalance(2403, 100000);
    await api('POST', '/payments', { token: t, body: { planId: (await plan30()).id, method: 'balance' } });
    expect((await api('POST', '/payments', { token: t, body: { addonId: a.forever, method: 'balance' } })).status).toBe(200);
    const r = await api('POST', '/quote', { token: t, body: { addonId: a.timed } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('location_owned_forever');
    expect((await sql()`select expires_at >= '2099-12-31' as f from user_locations`)[0]!.f).toBe(true);
    await sql()`update locations set is_active = false`;
    expect((await api('POST', '/quote', { token: t, body: { addonId: a.timed } })).status).toBe(404);
  });

  it('триал с require_channel: нет каналов / не удалось проверить — разрешён; не подписан — нет', async () => {
    await put('trial', { require_channel: true });
    const t = await loginUser(2404);
    expect((await api('POST', '/subscription/trial', { token: t })).status).toBe(200);
    await put('gate', { enabled: false, chats: [{ chat: '@nochat' }] }); // бот не может проверить (чат не найден)
    const t2 = await loginUser(2405);
    expect((await api('POST', '/subscription/trial', { token: t2 })).status).toBe(200);
    M.tg.state.members.set('@chan', new Set());
    await put('gate', { enabled: false, chats: [{ chat: '@chan' }] });
    const t3 = await loginUser(2406);
    const r = await api('POST', '/subscription/trial', { token: t3 });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('subscribe_required');
  });
});

describe('автопродление и рефералы: ретраи', () => {
  it('нехватка баланса: уведомление один раз, но после пополнения продление выполняется', async () => {
    const t = await loginUser(2501);
    const plan = await plan30();
    await sql()`update users set balance = 100000 where tg_id = 2501`;
    await api('POST', '/payments', { token: t, body: { planId: plan.id, method: 'balance' } });
    await setBalance(2501, 0);
    await sql()`update users set auto_renew = true, discount_pct = 50 where tg_id = 2501`;
    await sql()`update subscriptions set expires_at = now() + interval '2 days'`;
    expect(await autoRenew()).toBe(0);
    expect(await autoRenew()).toBe(0);
    const warns = M.tg.state.messages.filter((m) => m.chat_id === 2501 && m.text.includes('не хватает'));
    expect(warns).toHaveLength(1);
    expect(warns[0]!.text).toContain('99'); // цена со скидкой 50% (≈99,50 ₽), а не 199
    await setBalance(2501, 20000);
    expect(await autoRenew()).toBe(1);
    expect(await balance(2501)).toBe(20000 - (plan.price - Math.floor(plan.price / 2)));
  });

  it('воркер дожимает реферальную награду по каждому платежу, а не только первому у реферала', async () => {
    await put('referral', { enabled: false });
    const a = await loginUser(2601);
    const code = (await api('GET', '/me', { token: a })).json.referralCode;
    const b = (await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: 2602, first_name: 'B' }, { startParam: `ref_${code}` }) } })).json.accessToken;
    const plan = await plan30();
    await payYk(b, { planId: plan.id });
    await payYk(b, { planId: plan.id });
    await put('referral', { enabled: true, days: 0, percent: 10, recurring: true, choice_enabled: false });
    await retryUnfulfilled();
    expect((await sql()`select count(*)::int as n from referral_rewards where level = 1`)[0]!.n).toBe(2);
    await retryUnfulfilled();
    expect(await balance(2601)).toBe(Math.floor(plan.price * 0.1) * 2);
  });
});

describe('безопасность и настройки', () => {
  it('/auth/admin-tg: при включённой 2FA нужен TOTP или свежий initData', async () => {
    const t = await loginUser(9001);
    expect((await api('POST', '/auth/admin-tg', { token: t })).status).toBe(200); // без 2FA — как раньше
    const setup = await adm('POST', '/me/2fa/setup');
    await adm('POST', '/me/2fa/enable', { code: totpAt(setup.json.secret, Date.now()) });
    const r1 = await api('POST', '/auth/admin-tg', { token: t });
    expect(r1.status).toBe(200);
    expect(r1.json).toEqual({ needTotp: true });
    expect((await api('POST', '/auth/admin-tg', { token: t, body: { totp: '000000' } })).status).toBe(401);
    const ok = await api('POST', '/auth/admin-tg', { token: t, body: { totp: totpAt(setup.json.secret, Date.now()) } });
    expect(ok.json.accessToken).toBeTruthy();
    const fresh = await api('POST', '/auth/admin-tg', { token: t, body: { initData: makeInitData({ id: 9001, first_name: 'A' }) } });
    expect(fresh.json.accessToken).toBeTruthy();
    const stale = await api('POST', '/auth/admin-tg', { token: t, body: { initData: makeInitData({ id: 9001 }, { authDate: Math.floor(Date.now() / 1000) - 3600 }) } });
    expect(stale.json).toEqual({ needTotp: true });
  });

  it('гейт: ссылка канала должна быть https://, http:// или tg://', async () => {
    const bad = await put('gate', { enabled: true, chats: [{ chat: '@c', url: 'javascript:alert(1)' }] });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toContain('https://');
    expect((await put('gate', { enabled: true, chats: [{ chat: '@c', url: 'tg://resolve?domain=c' }] })).status).toBe(200);
    expect((await put('gate', { enabled: true, chats: [{ chat: '@c', url: ' https://t.me/c ' }] })).json.chats[0].url).toBe('https://t.me/c');
  });
});
