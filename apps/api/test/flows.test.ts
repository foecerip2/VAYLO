import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, sql } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/lib/crypto.js';
import { base32Decode, totpAt } from '../src/lib/totp.js';
import { clearSettingsCache } from '../src/services/settings.js';
import { seedDefaultPlans } from '../src/services/plans.js';
import { checkPendingPayments, expiryNotices, retryUnfulfilled } from '../src/worker.js';
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
  return { status: res.statusCode, json, text: res.body, headers: res.headers };
}

async function loginUser(tgId: number, startParam?: string, username = 'user' + tgId) {
  const r = await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: tgId, first_name: 'Test', username }, { startParam }) } });
  expect(r.status).toBe(200);
  return r.json.accessToken as string;
}

const put = (group: string, body: unknown) => api('PUT', `/admin/settings/${group}`, { token: adminToken, body });

async function enableProviders() {
  expect((await put('yookassa', { enabled: true, shop_id: M.yk.shopId, secret_key: M.yk.secret })).status).toBe(200);
  expect((await put('platega', { enabled: true, merchant_id: M.pl.merchant, secret: M.pl.secret, methods: ['sbp', 'card_acquiring', 'crypto'] })).status).toBe(200);
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
  await sql()`truncate users, plans, subscriptions, payments, promo_codes, promo_uses, transactions, referral_rewards, settings, admins, audit_log, broadcasts, auth_links cascade`;
  clearSettingsCache();
  M.rw.state.users.clear();
  M.rw.state.calls.length = 0;
  M.rw.state.fail = false;
  M.yk.state.payments.clear();
  M.yk.state.calls.length = 0;
  M.yk.state.statusOverride = null;
  M.pl.state.txs.clear();
  M.tg.state.messages.length = 0;
  M.tg.state.blocked.clear();
  await seedDefaultPlans();
  await sql()`insert into admins (email, password_hash, role) values ('owner@test.dev', ${await hashPassword('super-secret-pass')}, 'owner')`;
  const r = await api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'super-secret-pass' } });
  adminToken = r.json.accessToken;
});

describe('авторизация и профиль', () => {
  it('отклоняет подделанный initData и принимает настоящий', async () => {
    const bad = await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: 5 }, { token: '1:WRONG' }) } });
    expect(bad.status).toBe(401);
    const token = await loginUser(100);
    const me = await api('GET', '/me', { token });
    expect(me.status).toBe(200);
    expect(me.json.tgId).toBe(100);
    expect(me.json.trialAvailable).toBe(true);
    expect(me.json.subscription.state).toBe('none');
    expect((await api('GET', '/me')).status).toBe(401);
  });

  it('вход на сайт через бота (tglink) работает end-to-end', async () => {
    const start = await api('POST', '/auth/tglink/start', { body: {} });
    expect(start.json.url).toContain('t.me/test_vpn_bot?start=auth_');
    const token = start.json.token as string;
    expect((await api('GET', `/auth/tglink/${token}`)).json.status).toBe('pending');
    const tgUser = Buffer.from(JSON.stringify({ id: 777, first_name: 'Web', username: 'webuser' })).toString('base64');
    const bad = await api('POST', '/internal/tglink/confirm', { body: { token }, headers: { 'x-internal-key': 'wrong', 'x-tg-user': tgUser } });
    expect(bad.status).toBe(401);
    const ok = await api('POST', '/internal/tglink/confirm', { body: { token }, headers: { 'x-internal-key': 'internal-key-for-tests', 'x-tg-user': tgUser } });
    expect(ok.status).toBe(200);
    const poll = await api('GET', `/auth/tglink/${token}`);
    expect(poll.json.status).toBe('ok');
    const me = await api('GET', '/me', { token: poll.json.accessToken });
    expect(me.json.tgId).toBe(777);
    expect((await api('GET', `/auth/tglink/${token}`)).json.status).toBe('expired'); // одноразовая
  });

  it('бот ходит в API по внутреннему ключу', async () => {
    const tgUser = Buffer.from(JSON.stringify({ id: 888, first_name: 'Bot' })).toString('base64');
    const r = await api('GET', '/me', { headers: { 'x-internal-key': 'internal-key-for-tests', 'x-tg-user': tgUser } });
    expect(r.status).toBe(200);
    expect(r.json.tgId).toBe(888);
  });
});

describe('пробный период и подписка в Remnawave', () => {
  it('создаёт пользователя в Remnawave с лимитами триала (запрос валиден по контракту панели)', async () => {
    const token = await loginUser(101);
    const r = await api('POST', '/subscription/trial', { token });
    expect(r.status).toBe(200);
    expect(r.json.subscription.state).toBe('trial');
    expect(r.json.subscription.subUrl).toMatch(/^https:\/\/sub\.example\.test\/api\/sub\//);
    expect(r.json.subscription.daysLeft).toBe(3);
    const rwUser = [...M.rw.state.users.values()][0];
    expect(rwUser.username).toBe('tg_101');
    expect(rwUser.telegramId).toBe(101);
    expect(rwUser.trafficLimitBytes).toBe(5 * 1024 ** 3);
    expect(rwUser.hwidDeviceLimit).toBe(1);
    expect(rwUser.activeInternalSquads).toEqual([M.rw.state.squadUuid]);
    // второй раз нельзя
    expect((await api('POST', '/subscription/trial', { token })).status).toBe(409);
  });

  it('сбрасывает ссылку подписки (revoke)', async () => {
    const token = await loginUser(102);
    const t = await api('POST', '/subscription/trial', { token });
    const before = t.json.subscription.subUrl;
    const r = await api('POST', '/subscription/reset-link', { token });
    expect(r.status).toBe(200);
    expect(r.json.subUrl).not.toBe(before);
    expect((await api('GET', '/subscription', { token })).json.subUrl).toBe(r.json.subUrl);
  });

  it('триал можно отключить в настройках', async () => {
    await put('trial', { enabled: false });
    const token = await loginUser(103);
    const r = await api('POST', '/subscription/trial', { token });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('trial_disabled');
  });

  it('если Remnawave недоступна — понятная ошибка 502, триал не сгорает', async () => {
    const token = await loginUser(104);
    M.rw.state.fail = true;
    const r = await api('POST', '/subscription/trial', { token });
    expect(r.status).toBe(502);
    M.rw.state.fail = false;
    expect((await api('POST', '/subscription/trial', { token })).status).toBe(200);
  });
});

describe('оплата через ЮKassa', () => {
  it('полный цикл: создание → webhook → доступ выдан, повтор webhook безопасен', async () => {
    await enableProviders();
    const token = await loginUser(200);
    const methods = await api('GET', '/payment-methods', { token });
    expect(methods.json.map((m: any) => m.id)).toEqual(['yookassa', 'platega:sbp', 'platega:card_acquiring', 'platega:crypto']);

    const plans = (await api('GET', '/plans')).json;
    const plan = plans.find((p: any) => p.durationDays === 90);
    const created = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
    expect(created.status).toBe(200);
    expect(created.json.payUrl).toMatch(/^https:\/\/yoomoney\.test\/pay\//);

    const call = M.yk.state.calls.find((c) => c.method === 'POST')!;
    expect(call.body.amount).toEqual({ value: '499.00', currency: 'RUB' });
    expect(call.body.capture).toBe(true);
    expect(call.body.confirmation.return_url).toBe(`https://app.example.test/payment/${created.json.id}`);
    expect(call.headers['idempotence-key']).toBe(created.json.id);

    // webhook до оплаты не должен активировать (статус берётся из API, а не из тела)
    const extId = [...M.yk.state.payments.keys()][0]!;
    await api('POST', '/webhooks/yookassa', { body: { event: 'payment.succeeded', object: { id: extId, status: 'succeeded' } } });
    expect((await api('GET', '/subscription', { token })).json.state).toBe('none');

    // оплата прошла
    M.yk.state.statusOverride = 'succeeded';
    const wh = await api('POST', '/webhooks/yookassa', { body: { event: 'payment.succeeded', object: { id: extId } } });
    expect(wh.status).toBe(200);
    const sub = (await api('GET', '/subscription', { token })).json;
    expect(sub.state).toBe('active');
    expect(sub.daysLeft).toBe(90);
    expect(sub.planName).toBe('3 месяца');
    const rwUser = [...M.rw.state.users.values()][0];
    expect(Math.round((new Date(rwUser.expireAt).getTime() - Date.now()) / 86400000)).toBe(90);
    expect(rwUser.trafficLimitBytes).toBe(0);
    expect(rwUser.hwidDeviceLimit).toBe(3);
    expect(M.tg.state.messages.some((m) => m.chat_id === 200 && m.text.includes('Оплата прошла'))).toBe(true);

    // повторный webhook (и ещё один) не продлевает повторно
    for (let i = 0; i < 2; i++) await api('POST', '/webhooks/yookassa', { body: { event: 'payment.succeeded', object: { id: extId } } });
    const sub2 = (await api('GET', '/subscription', { token })).json;
    expect(sub2.daysLeft).toBe(90);
    const [{ n }] = await sql()`select count(*)::int as n from payments where status = 'succeeded' and fulfilled_at is not null`;
    expect(n).toBe(1);
  });

  it('продление добавляет срок к текущему', async () => {
    await enableProviders();
    const token = await loginUser(201);
    const plan = (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30);
    M.yk.state.statusOverride = 'succeeded';
    for (let i = 0; i < 2; i++) {
      const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
      const ext = (await sql()`select external_id from payments where id = ${c.json.id}`)[0]!.external_id;
      await api('POST', '/webhooks/yookassa', { body: { object: { id: ext } } });
    }
    expect((await api('GET', '/subscription', { token })).json.daysLeft).toBe(60);
  });

  it('отменённый платёж не даёт доступ, воркер подхватывает потерянный webhook', async () => {
    await enableProviders();
    const token = await loginUser(202);
    const plan = (await api('GET', '/plans')).json[0];
    const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
    M.yk.state.statusOverride = 'canceled';
    const poll = await api('GET', `/payments/${c.json.id}`, { token });
    expect(poll.json.status).toBe('canceled');
    expect((await api('GET', '/subscription', { token })).json.state).toBe('none');

    // новый платёж: webhook "потерян", воркер сверяет статус
    const c2 = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
    M.yk.state.statusOverride = 'succeeded';
    await sql()`update payments set created_at = now() - interval '2 minutes' where id = ${c2.json.id}`;
    expect(await checkPendingPayments()).toBeGreaterThanOrEqual(1);
    expect((await api('GET', '/subscription', { token })).json.state).toBe('active');
  });

  it('чек 54-ФЗ добавляется, если включён в настройках', async () => {
    await put('yookassa', { enabled: true, shop_id: M.yk.shopId, secret_key: M.yk.secret, send_receipt: true, receipt_email: 'shop@example.com', vat_code: 1 });
    const token = await loginUser(203);
    const plan = (await api('GET', '/plans')).json[0];
    await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
    const body = M.yk.state.calls.find((c) => c.method === 'POST')!.body;
    expect(body.receipt.customer.email).toBe('shop@example.com');
    expect(body.receipt.items[0].amount.value).toBe('199.00');
    expect(body.receipt.items[0].vat_code).toBe(1);
  });

  it('неверные ключи ЮKassa → ошибка, платёж помечается отменённым', async () => {
    await put('yookassa', { enabled: true, shop_id: 'x', secret_key: 'bad' });
    const token = await loginUser(204);
    const plan = (await api('GET', '/plans')).json[0];
    const r = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
    expect(r.status).toBe(502);
    expect((await sql()`select status from payments`)[0]!.status).toBe('canceled');
  });
});

describe('оплата через Platega', () => {
  it('создаёт транзакцию с нужным методом и суммой, callback проверяется по заголовкам', async () => {
    await enableProviders();
    const token = await loginUser(300);
    const plan = (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30);
    const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'platega:sbp' } });
    expect(c.status).toBe(200);
    expect(c.json.payUrl).toMatch(/^https:\/\/pay\.platega\.test\//);
    const sent = M.pl.state.calls.find((x) => x.path === '/transaction/process')!.body;
    expect(sent.paymentMethod).toBe(2);
    expect(sent.paymentDetails).toEqual({ amount: 199, currency: 'RUB' });
    expect(sent.return).toBe(`https://app.example.test/payment/${c.json.id}`);
    expect(sent.payload).toBe(c.json.id);
    expect(sent).not.toHaveProperty('id');

    const txId = [...M.pl.state.txs.keys()][0]!;
    const payload = { id: txId, amount: 199, currency: 'RUB', status: 'CONFIRMED', paymentMethod: 2 };
    // без/с неверными заголовками
    expect((await api('POST', '/webhooks/platega', { body: payload })).status).toBe(401);
    expect((await api('POST', '/webhooks/platega', { body: payload, headers: { 'x-merchantid': M.pl.merchant, 'x-secret': 'nope' } })).status).toBe(401);
    expect((await api('GET', '/subscription', { token })).json.state).toBe('none');

    // callback настоящий, но API Platega ещё говорит PENDING → не активируем (двойная проверка)
    const h = { 'x-merchantid': M.pl.merchant, 'x-secret': M.pl.secret };
    await api('POST', '/webhooks/platega', { body: payload, headers: h });
    expect((await api('GET', '/subscription', { token })).json.state).toBe('none');

    // реально оплачено
    M.pl.state.txs.get(txId).status = 'CONFIRMED';
    expect((await api('POST', '/webhooks/platega', { body: payload, headers: h })).status).toBe(200);
    expect((await api('GET', '/subscription', { token })).json.daysLeft).toBe(30);
    await api('POST', '/webhooks/platega', { body: payload, headers: h });
    expect((await api('GET', '/subscription', { token })).json.daysLeft).toBe(30);
  });

  it('CANCELED отменяет платёж; недоступный метод отклоняется', async () => {
    await enableProviders();
    const token = await loginUser(301);
    const plan = (await api('GET', '/plans')).json[0];
    const bad = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'platega:international' } });
    expect(bad.status).toBe(400);
    const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'platega:crypto' } });
    expect([...M.pl.state.calls].find((x) => x.path === '/transaction/process' && x.body.paymentMethod === 13)).toBeTruthy();
    const txId = [...M.pl.state.txs.keys()][0]!;
    M.pl.state.txs.get(txId).status = 'CANCELED';
    await api('POST', '/webhooks/platega', { body: { id: txId, status: 'CANCELED' }, headers: { 'x-merchantid': M.pl.merchant, 'x-secret': M.pl.secret } });
    expect((await sql()`select status from payments where id = ${c.json.id}`)[0]!.status).toBe('canceled');
  });
});

describe('баланс, промокоды, рефералы', () => {
  async function pay(token: string, method: string, body: Record<string, unknown>) {
    const c = await api('POST', '/payments', { token, body: { method, ...body } });
    expect(c.status).toBe(200);
    if (c.json.status === 'pending') {
      const [p] = await sql()`select provider, external_id from payments where id = ${c.json.id}`;
      if (p!.provider === 'yookassa') {
        M.yk.state.statusOverride = 'succeeded';
        await api('POST', '/webhooks/yookassa', { body: { object: { id: p!.external_id } } });
      } else {
        M.pl.state.txs.get(p!.external_id).status = 'CONFIRMED';
        await api('POST', '/webhooks/platega', { body: { id: p!.external_id, status: 'CONFIRMED' }, headers: { 'x-merchantid': M.pl.merchant, 'x-secret': M.pl.secret } });
      }
    }
    return c.json.id as string;
  }

  it('пополнение баланса и покупка с баланса; нехватка средств → 409', async () => {
    await enableProviders();
    const token = await loginUser(400);
    const plan = (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30); // 199 ₽
    expect((await api('POST', '/payments', { token, body: { planId: plan.id, method: 'balance' } })).status).toBe(409);
    expect((await api('POST', '/payments', { token, body: { topupAmount: 5000, method: 'yookassa' } })).status).toBe(400); // меньше 100 ₽
    await pay(token, 'yookassa', { topupAmount: 30000 });
    expect((await api('GET', '/me', { token })).json.balance).toBe(30000);
    const r = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'balance' } });
    expect(r.status).toBe(200);
    const me = (await api('GET', '/me', { token })).json;
    expect(me.balance).toBe(30000 - 19900);
    expect(me.subscription.daysLeft).toBe(30);
    const tx = await sql()`select type, amount, balance_after from transactions order by created_at`;
    expect(tx.map((t) => t.type)).toEqual(['topup', 'purchase']);
  });

  it('если Remnawave упала при покупке с баланса — деньги не списываются; воркер дожимает оплаченный платёж', async () => {
    await enableProviders();
    const token = await loginUser(401);
    await pay(token, 'yookassa', { topupAmount: 30000 });
    const plan = (await api('GET', '/plans')).json[0];
    M.rw.state.fail = true;
    expect((await api('POST', '/payments', { token, body: { planId: plan.id, method: 'balance' } })).status).toBe(502);
    expect((await api('GET', '/me', { token })).json.balance).toBe(30000);

    // оплата картой при упавшей панели: платёж succeeded, но не выполнен
    const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
    const [p] = await sql()`select external_id from payments where id = ${c.json.id}`;
    M.yk.state.statusOverride = 'succeeded';
    await api('POST', '/webhooks/yookassa', { body: { object: { id: p!.external_id } } });
    let row = (await sql()`select status, fulfilled_at, fulfill_error from payments where id = ${c.json.id}`)[0]!;
    expect(row.status).toBe('succeeded');
    expect(row.fulfilled_at).toBeNull();
    expect(row.fulfill_error).toContain('Remnawave');
    M.rw.state.fail = false;
    expect(await retryUnfulfilled()).toBe(1);
    row = (await sql()`select status, fulfilled_at from payments where id = ${c.json.id}`)[0]!;
    expect(row.fulfilled_at).not.toBeNull();
    expect((await api('GET', '/subscription', { token })).json.state).toBe('active');
  });

  it('промокоды: скидка %, фикс, подарок днями/балансом, лимиты', async () => {
    await enableProviders();
    const mk = (b: any) => api('POST', '/admin/promo', { token: adminToken, body: b });
    expect((await mk({ code: 'half', type: 'percent', value: 50 })).status).toBe(200);
    expect((await mk({ code: 'HALF', type: 'percent', value: 50 })).status).toBe(409);
    expect((await mk({ code: 'minus50', type: 'fixed', value: 5000, maxUses: 1 })).status).toBe(200);
    expect((await mk({ code: 'gift7', type: 'days', value: 7 })).status).toBe(200);
    expect((await mk({ code: 'bonus100', type: 'balance', value: 10000 })).status).toBe(200);
    expect((await mk({ code: 'over', type: 'percent', value: 150 })).status).toBe(400);

    const token = await loginUser(402);
    const plan = (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30); // 19900
    const q = await api('POST', '/quote', { token, body: { planId: plan.id, promo: 'half' } });
    expect(q.json).toMatchObject({ gross: 19900, discount: 9950, total: 9950 });
    const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa', promo: 'half' } });
    expect(M.yk.state.calls.find((x) => x.method === 'POST')!.body.amount.value).toBe('99.50');
    await pay(token, 'yookassa', { planId: plan.id, promo: 'half' }).catch(() => {});

    // скидочный код нельзя "погасить" как подарок, подарочный — нельзя применить к оплате
    expect((await api('POST', '/promo/redeem', { token, body: { code: 'half' } })).status).toBe(400);
    expect((await api('POST', '/quote', { token, body: { planId: plan.id, promo: 'gift7' } })).status).toBe(400);
    expect((await api('POST', '/promo/redeem', { token, body: { code: 'nope' } })).status).toBe(400);

    const g = await api('POST', '/promo/redeem', { token, body: { code: 'gift7' } });
    expect(g.json).toEqual({ type: 'days', value: 7 });
    expect((await api('POST', '/promo/redeem', { token, body: { code: 'gift7' } })).status).toBe(409);
    const b = await api('POST', '/promo/redeem', { token, body: { code: 'bonus100' } });
    expect(b.json).toEqual({ type: 'balance', value: 10000 });
    expect((await api('GET', '/me', { token })).json.balance).toBe(10000);
    void c;
  });

  it('100% скидка выдаёт доступ без провайдера', async () => {
    await api('POST', '/admin/promo', { token: adminToken, body: { code: 'FREE', type: 'percent', value: 100 } });
    const token = await loginUser(403);
    const plan = (await api('GET', '/plans')).json[0];
    const r = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'balance', promo: 'FREE' } });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('succeeded');
    expect((await api('GET', '/subscription', { token })).json.state).toBe('active');
  });

  it('рефералка: награда пригласившему только за первую оплату', async () => {
    await enableProviders();
    const a = await loginUser(500);
    const refCode = (await api('GET', '/me', { token: a })).json.referralCode;
    await api('POST', '/subscription/trial', { token: a });
    const b = await loginUser(501, `ref_${refCode}`);
    const stats0 = (await api('GET', '/referrals', { token: a })).json;
    expect(stats0).toMatchObject({ invited: 1, paid: 0, link: `https://t.me/test_vpn_bot?start=ref_${refCode}` });
    // свой код на себя не работает
    const self = await loginUser(502, `ref_${(await api('GET', '/me', { token: a })).json.referralCode}`);
    void self;

    const plan = (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30);
    const before = (await api('GET', '/subscription', { token: a })).json.daysLeft;
    await pay(b, 'yookassa', { planId: plan.id });
    const after = (await api('GET', '/subscription', { token: a })).json.daysLeft;
    expect(after - before).toBe(7);
    expect(M.tg.state.messages.some((m) => m.chat_id === 500 && m.text.includes('Ваш друг'))).toBe(true);
    await pay(b, 'yookassa', { planId: plan.id });
    expect((await api('GET', '/subscription', { token: a })).json.daysLeft).toBe(after);
    expect((await api('GET', '/referrals', { token: a })).json).toMatchObject({ invited: 2, paid: 1, earnedDays: 7 });
  });

  it('проценты от платежа рефералу зачисляются на баланс', async () => {
    await enableProviders();
    await put('referral', { days: 0, percent: 20, choice_enabled: false });
    const a = await loginUser(510);
    const code = (await api('GET', '/me', { token: a })).json.referralCode;
    const b = await loginUser(511, `ref_${code}`);
    const plan = (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30);
    await pay(b, 'platega:sbp', { planId: plan.id });
    expect((await api('GET', '/me', { token: a })).json.balance).toBe(3980);
  });
});

describe('уведомления воркера', () => {
  it('напоминает за 3 дня и 1 день один раз, помечает заблокировавших бота', async () => {
    const token = await loginUser(600);
    await api('POST', '/subscription/trial', { token });
    await sql()`update subscriptions set expires_at = now() + interval '2 days 12 hours'`;
    expect(await expiryNotices()).toBe(1);
    expect(M.tg.state.messages.at(-1)!.text).toContain('3 дня');
    expect(await expiryNotices()).toBe(0); // повторно не шлём
    await sql()`update subscriptions set expires_at = now() + interval '10 hours'`;
    expect(await expiryNotices()).toBe(1);
    expect(M.tg.state.messages.at(-1)!.text).toContain('завтра');

    const t2 = await loginUser(601);
    await api('POST', '/subscription/trial', { token: t2 });
    await sql()`update subscriptions s set expires_at = now() + interval '5 hours' from users u where u.id = s.user_id and u.tg_id = 601`;
    M.tg.state.blocked.add(601);
    await expiryNotices();
    expect((await sql()`select bot_blocked from users where tg_id = 601`)[0]!.bot_blocked).toBe(true);
  });
});

describe('админ API', () => {
  it('логин, 2FA, роли', async () => {
    expect((await api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'wrong-pass-xx' } })).status).toBe(401);
    expect((await api('GET', '/admin/stats/overview')).status).toBe(401);
    const user = await loginUser(700);
    expect((await api('GET', '/admin/stats/overview', { token: user })).status).toBe(401); // токен пользователя не подходит

    const setup = await api('POST', '/admin/me/2fa/setup', { token: adminToken });
    expect(setup.json.uri).toContain('otpauth://totp/');
    const code = totpAt(setup.json.secret, Date.now());
    expect((await api('POST', '/admin/me/2fa/enable', { token: adminToken, body: { code: '000000' } })).status).toBe(400);
    expect((await api('POST', '/admin/me/2fa/enable', { token: adminToken, body: { code } })).status).toBe(200);
    const step1 = await api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'super-secret-pass' } });
    expect(step1.json).toEqual({ needTotp: true });
    expect((await api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'super-secret-pass', totp: '123456' } })).status).toBe(401);
    const step2 = await api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'super-secret-pass', totp: totpAt(setup.json.secret, Date.now()) } });
    expect(step2.status).toBe(200);

    // роли
    const mk = await api('POST', '/admin/admins', { token: adminToken, body: { email: 'sup@test.dev', password: 'support-password-1', role: 'support' } });
    expect(mk.status).toBe(200);
    const sup = (await api('POST', '/admin/auth/login', { body: { email: 'sup@test.dev', password: 'support-password-1' } })).json.accessToken;
    expect((await api('GET', '/admin/users', { token: sup })).status).toBe(200);
    expect((await api('GET', '/admin/settings', { token: sup })).status).toBe(403);
    expect((await api('POST', '/admin/plans', { token: sup, body: {} })).status).toBe(403);
    const tgId = (await sql()`select id from users where tg_id = 700`)[0]!.id;
    expect((await api('POST', `/admin/users/${tgId}/extend`, { token: sup, body: { days: 100 } })).status).toBe(403);
    expect((await api('POST', `/admin/users/${tgId}/extend`, { token: sup, body: { days: 5 } })).status).toBe(200);
  });

  it('настройки: секреты шифруются, в API маскируются, тест подключения работает', async () => {
    await enableProviders();
    await put('remnawave', { url: M.rw.url, token: M.rw.token });
    const s = await api('GET', '/admin/settings', { token: adminToken });
    expect(s.json.settings.yookassa.secret_key).toBe('********');
    expect(s.json.settings.platega.secret).toBe('********');
    expect(s.json.webhooks.yookassa).toBe('https://api.example.test/api/v1/webhooks/yookassa');
    const raw = (await sql()`select value from settings where key = 'yookassa'`)[0]!.value;
    expect(JSON.stringify(raw)).not.toContain(M.yk.secret);
    // сохранение с маской не затирает секрет
    await put('yookassa', { secret_key: '********', send_receipt: true });
    expect((await api('POST', '/admin/settings/test/yookassa', { token: adminToken })).json.ok).toBe(true);
    expect((await api('POST', '/admin/settings/test/platega', { token: adminToken })).json.ok).toBe(true);
    const rw = await api('POST', '/admin/settings/test/remnawave', { token: adminToken });
    expect(rw.json).toMatchObject({ ok: true, nodes: 1, squads: 1 });
    await put('platega', { secret: 'wrong' });
    const bad = await api('POST', '/admin/settings/test/platega', { token: adminToken });
    expect(bad.json.ok).toBe(false);
    expect((await put('trial', { days: 0 })).status).toBe(400);
  });

  it('статистика, пользователи, платежи, тарифы, рассылки, ноды', async () => {
    await enableProviders();
    const token = await loginUser(701, undefined, 'alice');
    const plan = (await api('GET', '/plans')).json.find((p: any) => p.durationDays === 30);
    const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'yookassa' } });
    M.yk.state.statusOverride = 'succeeded';
    await api('POST', '/webhooks/yookassa', { body: { object: { id: [...M.yk.state.payments.keys()][0] } } });

    const st = (await api('GET', '/admin/stats/overview', { token: adminToken })).json;
    expect(st.users.total).toBe(1);
    expect(st.subscriptions.active).toBe(1);
    expect(st.revenue.today).toBe(19900);
    expect(st.revenue.total).toBe(19900);
    expect(st.revenueSeries).toHaveLength(30);
    expect(st.byProvider[0]).toMatchObject({ provider: 'yookassa', amount: 19900 });

    const list = (await api('GET', '/admin/users?q=alice&filter=active', { token: adminToken })).json;
    expect(list.total).toBe(1);
    const uid = list.items[0].id;
    const detail = (await api('GET', `/admin/users/${uid}`, { token: adminToken })).json;
    expect(detail.subscription.state).toBe('active');
    expect(detail.payments).toHaveLength(1);

    expect((await api('POST', `/admin/users/${uid}/balance`, { token: adminToken, body: { amount: 5000 } })).json.balance).toBe(5000);
    expect((await api('POST', `/admin/users/${uid}/balance`, { token: adminToken, body: { amount: -9000 } })).status).toBe(409);
    expect((await api('POST', `/admin/users/${uid}/extend`, { token: adminToken, body: { days: 10 } })).status).toBe(200);
    expect((await api('GET', '/subscription', { token })).json.daysLeft).toBe(40);

    // бан: пользователь отключается в Remnawave и теряет доступ к API
    expect((await api('POST', `/admin/users/${uid}/ban`, { token: adminToken, body: { banned: true } })).status).toBe(200);
    expect([...M.rw.state.users.values()][0].status).toBe('DISABLED');
    expect((await api('GET', '/me', { token })).status).toBe(403);
    await api('POST', `/admin/users/${uid}/ban`, { token: adminToken, body: { banned: false } });
    expect([...M.rw.state.users.values()][0].status).toBe('ACTIVE');

    const pays = (await api('GET', '/admin/payments?status=succeeded', { token: adminToken })).json;
    expect(pays.total).toBe(1);
    const csv = await api('GET', '/admin/payments/export.csv', { token: adminToken });
    expect(csv.text).toContain('yookassa');
    expect(csv.headers['content-type']).toContain('text/csv');

    // тарифы
    const np = await api('POST', '/admin/plans', { token: adminToken, body: { name: 'Тест', durationDays: 7, price: 9900, trafficLimitGb: 50, deviceLimit: 2 } });
    expect(np.status).toBe(200);
    expect((await api('PUT', `/admin/plans/${np.json.id}`, { token: adminToken, body: { name: 'Тест2', durationDays: 7, price: 12900, deviceLimit: 2, isActive: false } })).json.name).toBe('Тест2');
    expect((await api('GET', '/plans')).json.some((p: any) => p.name === 'Тест2')).toBe(false); // скрыт
    expect((await api('DELETE', `/admin/plans/${np.json.id}`, { token: adminToken })).status).toBe(200);
    // выдача тарифа вручную
    const free = (await api('GET', '/plans')).json[0];
    expect((await api('POST', `/admin/users/${uid}/grant-plan`, { token: adminToken, body: { planId: free.id } })).status).toBe(200);

    // рассылка
    const prev = await api('GET', '/admin/broadcasts/preview?segment=active', { token: adminToken });
    expect(prev.json.count).toBe(1);
    const nodes = (await api('GET', '/admin/nodes', { token: adminToken })).json;
    expect(nodes.items[0]).toMatchObject({ name: 'NL-1', online: true, usersOnline: 7 });
    expect((await api('GET', '/nodes', { token })).json[0]).toMatchObject({ name: 'NL-1', countryCode: 'NL' });

    const audit = (await api('GET', '/admin/audit', { token: adminToken })).json;
    expect(audit.items.map((x: any) => x.action)).toEqual(expect.arrayContaining(['user.ban', 'plan.create', 'user.balance']));
    void c;
  });

  it('ручное подтверждение платежа доступно только владельцу', async () => {
    await enableProviders();
    const token = await loginUser(702);
    const plan = (await api('GET', '/plans')).json[0];
    const c = await api('POST', '/payments', { token, body: { planId: plan.id, method: 'platega:sbp' } });
    await api('POST', '/admin/admins', { token: adminToken, body: { email: 'adm@test.dev', password: 'admin-password-1', role: 'admin' } });
    const adm = (await api('POST', '/admin/auth/login', { body: { email: 'adm@test.dev', password: 'admin-password-1' } })).json.accessToken;
    expect((await api('POST', `/admin/payments/${c.json.id}/mark-paid`, { token: adm })).status).toBe(403);
    expect((await api('POST', `/admin/payments/${c.json.id}/mark-paid`, { token: adminToken })).status).toBe(200);
    expect((await api('GET', '/subscription', { token })).json.state).toBe('active');
  });

  it('рассылка: сегменты, кнопка, заблокированные боты, превью и тест-отправка', async () => {
    const mk = async (tg: number, sub: 'active' | 'expired' | 'none') => {
      const [u] = await sql()`insert into users (tg_id, referral_code) values (${tg}, ${'bc' + tg}) returning id`;
      if (sub !== 'none') await sql()`insert into subscriptions (user_id, plan_name, expires_at) values (${u!.id}, 'x', now() + ${sub === 'active' ? '5 days' : '-5 days'}::interval)`;
    };
    await mk(9001, 'active');
    await mk(9002, 'active');
    await mk(9003, 'expired');
    await mk(9004, 'none');
    M.tg.state.blocked.add(9002);

    expect((await api('GET', '/admin/broadcasts/preview?segment=all', { token: adminToken })).json.count).toBe(4);
    expect((await api('GET', '/admin/broadcasts/preview?segment=active', { token: adminToken })).json.count).toBe(2);
    expect((await api('GET', '/admin/broadcasts/preview?segment=expired', { token: adminToken })).json.count).toBe(1);
    expect((await api('GET', '/admin/broadcasts/preview?segment=no_sub', { token: adminToken })).json.count).toBe(1);
    expect((await api('GET', '/admin/broadcasts/preview?segment=bogus', { token: adminToken })).status).toBe(400);

    const bc = await api('POST', '/admin/broadcasts', { token: adminToken, body: { text: 'Привет', segment: 'active', buttonText: 'Открыть', buttonUrl: 'https://example.com' } });
    expect(bc.status).toBe(200);
    const { runBroadcast } = await import('../src/services/broadcast.js');
    await runBroadcast(bc.json.id);
    const [row] = await sql()`select * from broadcasts where id = ${bc.json.id}`;
    expect(row).toMatchObject({ status: 'done', total: 2, sent: 1, failed: 1 });
    const got = M.tg.state.messages.filter((m) => m.text === 'Привет');
    expect(got.map((m) => m.chat_id)).toEqual([9001]);
    expect(JSON.stringify(got[0]!.reply_markup)).toContain('https://example.com');
    // заблокировавший бота исключается из следующих рассылок
    expect((await api('GET', '/admin/broadcasts/preview?segment=all', { token: adminToken })).json.count).toBe(3);

    expect((await api('POST', '/admin/broadcasts', { token: adminToken, body: { text: 'x', segment: 'nope' } })).status).toBe(400);
    expect((await api('POST', '/admin/broadcasts/test', { token: adminToken, body: { text: 'тест', tgId: 9004 } })).status).toBe(200);
    expect(M.tg.state.messages.some((m) => m.chat_id === 9004 && m.text === 'тест')).toBe(true);
    expect((await api('POST', '/admin/broadcasts/test', { token: adminToken, body: { text: 'тест', tgId: 9002 } })).status).toBe(400);
  });
});
