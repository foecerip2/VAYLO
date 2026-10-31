import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, sql } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache } from '../src/services/settings.js';
import { seedDefaultPlans } from '../src/services/plans.js';
import { issueGift } from '../src/services/gifts.js';
import type { PaymentRow } from '../src/db/types.js';
import { makeInitData } from './helpers/initdata.js';

const mocks = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let operation = 0;
const DAY = 86_400_000;

async function api(method: string, path: string, token = '', body?: unknown) {
  const response = await app.inject({ method: method as any, url: '/api/v1' + path,
    headers: token ? { authorization: `Bearer ${token}`, 'idempotency-key': `gifts-test-${++operation}` } : {}, payload: body as any });
  return { status: response.statusCode, body: response.json() };
}
async function user(tgId: number) {
  const login = await api('POST', '/auth/miniapp', '', { initData: makeInitData({ id: tgId, first_name: `GiftUser${tgId}` }) });
  expect(login.status).toBe(200);
  const token = login.body.accessToken as string;
  const me = await api('GET', '/me', token);
  return { token, id: me.body.id as string, tgId };
}
async function admin(role: 'admin' | 'analyst' = 'admin') {
  const who = await user(role === 'admin' ? 8001 : 8002);
  await sql()`insert into admins (email, password_hash, role, tg_id) values (${`${role}@gift.test`}, 'not-used-for-tg-login', ${role}, ${who.tgId})`;
  const login = await api('POST', '/auth/admin-tg', who.token, {});
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}
async function paidGift() {
  const buyer = await user(1001);
  await sql()`update users set balance = 100000 where id = ${buyer.id}`;
  const [plan] = await sql()`select * from plans order by price limit 1`;
  const paid = await api('POST', '/payments', buyer.token, { planId: plan!.id, method: 'balance', gift: true });
  expect(paid.status).toBe(200);
  const listed = await api('GET', '/gifts', buyer.token);
  return { buyer, plan: plan!, paymentId: paid.body.id as string, gift: listed.body[0] };
}

beforeAll(async () => {
  await sql()`drop schema public cascade`;
  await sql()`create schema public`;
  await migrate();
  app = await buildApp({ logger: false });
});
beforeEach(async () => {
  await sql()`truncate users, plans, payments, settings, admins, audit_log, monitor_state, monitor_events cascade`;
  clearSettingsCache();
  mocks.rw.state.users.clear(); mocks.rw.state.calls.length = 0; mocks.rw.state.fail = false;
  mocks.yk.state.payments.clear(); mocks.yk.state.statusOverride = null;
  await seedDefaultPlans();
});
afterAll(async () => {
  await app.close(); await closeDb();
  for (const mock of Object.values(mocks) as any[]) mock.server.close();
});

describe('gift lifecycle, ownership and activation', () => {
  it('requires authentication for lists and preview', async () => {
    expect((await api('GET', '/gifts')).status).toBe(401);
    expect((await api('GET', '/gifts/received')).status).toBe(401);
    expect((await api('POST', '/gifts/preview', '', { code: 'VAYLO-' + 'A'.repeat(24) })).status).toBe(401);
  });

  it('only the buyer may edit or replace an unclaimed gift link', async () => {
    const { buyer, gift } = await paidGift(); const stranger = await user(1002);
    for (const [method, path, body] of [
      ['PATCH', `/gifts/${gift.id}`, { recipientName: 'Не ваш подарок', expectedVersion: gift.version }],
      ['POST', `/gifts/${gift.id}/rotate`, { expectedVersion: gift.version }],
    ] as const) {
      const denied = await api(method, path, stranger.token, body);
      expect([403, 404]).toContain(denied.status);
    }
    expect((await api('GET', '/gifts', stranger.token)).body).toEqual([]);
    const unchanged = (await api('GET', '/gifts', buyer.token)).body[0];
    expect(unchanged.code).toBe(gift.code); expect(unchanged.version).toBe(gift.version);
  });

  it('saves a greeting and theme, validates inputs, and serializes concurrent edits', async () => {
    const { buyer, gift } = await paidGift();
    expect((await api('PATCH', `/gifts/${gift.id}`, buyer.token, { theme: 'invalid-theme', expectedVersion: gift.version })).status).toBe(400);
    const results = await Promise.all([
      api('PATCH', `/gifts/${gift.id}`, buyer.token, { recipientName: 'Алексей', senderName: 'Мария', message: 'Будь на связи!', theme: 'pearl', expectedVersion: gift.version }),
      api('PATCH', `/gifts/${gift.id}`, buyer.token, { recipientName: 'Другое имя', theme: 'aurora', expectedVersion: gift.version }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = results.find(r => r.status === 200)!.body;
    expect(saved.version).toBe(gift.version + 1);
    expect(['pearl', 'aurora']).toContain(saved.theme);
    expect(saved.code).toBe(gift.code);
  });

  it('rotation invalidates the old code, and stale retries cannot rotate again', async () => {
    const { buyer, gift } = await paidGift(); const recipient = await user(1002);
    const rotated = await api('POST', `/gifts/${gift.id}/rotate`, buyer.token, { expectedVersion: gift.version });
    expect(rotated.status).toBe(200); expect(rotated.body.code).not.toBe(gift.code);
    expect(rotated.body.version).toBe(gift.version + 1);
    expect((await api('POST', `/gifts/${gift.id}/rotate`, buyer.token, { expectedVersion: gift.version })).status).toBe(409);
    expect((await api('POST', '/gifts/redeem', recipient.token, { code: gift.code })).status).toBe(400);
    expect((await api('POST', '/gifts/redeem', recipient.token, { code: rotated.body.code })).status).toBe(200);
  });

  it('an edit racing with rotation uses one shared version guard', async () => {
    const { buyer, gift } = await paidGift();
    const results = await Promise.all([
      api('PATCH', `/gifts/${gift.id}`, buyer.token, { message: 'Для тебя!', expectedVersion: gift.version }),
      api('POST', `/gifts/${gift.id}/rotate`, buyer.token, { expectedVersion: gift.version }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const current = (await api('GET', '/gifts', buyer.token)).body[0];
    expect(current.version).toBe(gift.version + 1);
    expect(current.code).toBe(results.find(r => r.status === 200)!.body.code);
  });

  it('keeps an older paid ready gift accessible beyond the former 100-item limit', async () => {
    const { buyer, plan, gift } = await paidGift();
    await sql()`update gifts set created_at = now() - interval '1 day' where id = ${gift.id}`;
    await sql().begin(async tx => {
      const payload = { gift: true, plan: { name: plan.name, days: plan.duration_days, trafficGb: plan.traffic_limit_gb, devices: plan.device_limit } };
      const rows = await tx<PaymentRow[]>`insert into payments (user_id, provider, purpose, plan_id, plan_name, amount, status, payload, paid_at, fulfilled_at)
        select ${buyer.id}, 'balance', 'plan', ${plan.id}, ${plan.name}, 0, 'succeeded', ${tx.json(payload)}, now(), now() from generate_series(1, 100) returning *`;
      for (const row of rows) await issueGift(tx, row);
    });
    const listed = await api('GET', '/gifts', buyer.token);
    expect(listed.status).toBe(200); expect(listed.body).toHaveLength(101);
    expect(listed.body.find((g: any) => g.id === gift.id)?.code).toBe(gift.code);
  });

  it('preview discloses only safe metadata and does not consume or grant a gift', async () => {
    const { buyer, gift } = await paidGift(); const recipient = await user(1002);
    const updated = await api('PATCH', `/gifts/${gift.id}`, buyer.token, { recipientName: 'Друг', senderName: 'Мария', message: 'С праздником!', theme: 'orbit', expectedVersion: gift.version });
    expect(updated.status).toBe(200);
    const preview = await api('POST', '/gifts/preview', recipient.token, { code: gift.code });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ planName: gift.planName, days: gift.days, keepsCurrentPlan: false });
    expect(Number.isFinite(Date.parse(preview.body.resultExpiresAt))).toBe(true);
    expect(JSON.stringify(preview.body)).not.toContain(gift.code);
    expect(JSON.stringify(preview.body)).not.toMatch(/code_hash|code_encrypted|paymentId|buyerId|tgId/);
    expect((await sql()`select count(*)::int as n from subscriptions where user_id = ${recipient.id}`)[0]!.n).toBe(0);
    expect((await api('GET', '/gifts', buyer.token)).body[0].state).toBe('ready');
  });

  it('preserves the current paid tariff, limits and renewal identity while adding days', async () => {
    const { plan, gift } = await paidGift(); const recipient = await user(1002);
    const [premium] = await sql()`insert into plans (name, duration_days, traffic_limit_gb, device_limit, price) values ('Премиум', 90, 20, 10, 99000) returning id`;
    const until = new Date(Date.now() + 45 * DAY); const traffic = 20 * 1024 ** 3; const used = 2 * 1024 ** 3;
    await sql()`update users set auto_renew = true where id = ${recipient.id}`;
    await sql()`insert into subscriptions (user_id, plan_id, plan_name, is_trial, expires_at, traffic_limit_bytes, traffic_used_bytes, device_limit) values (${recipient.id}, ${premium!.id}, 'Премиум', false, ${until}, ${traffic}, ${used}, 10)`;
    const preview = await api('POST', '/gifts/preview', recipient.token, { code: gift.code });
    expect(preview.status).toBe(200); expect(preview.body.keepsCurrentPlan).toBe(true);
    expect(Math.abs(Date.parse(preview.body.resultExpiresAt) - until.getTime() - plan.duration_days * DAY)).toBeLessThan(1000);
    expect((await api('POST', '/gifts/redeem', recipient.token, { code: gift.code })).status).toBe(200);
    const [subscription] = await sql()`select * from subscriptions where user_id = ${recipient.id}`;
    expect(subscription).toMatchObject({ plan_id: premium!.id, plan_name: 'Премиум', traffic_limit_bytes: traffic, traffic_used_bytes: used, device_limit: 10, is_trial: false });
    expect(new Date(subscription!.expires_at).getTime()).toBe(until.getTime() + plan.duration_days * DAY);
    expect((await sql()`select auto_renew from users where id = ${recipient.id}`)[0]!.auto_renew).toBe(true);
  });

  it.each(['new', 'expired', 'trial'] as const)('applies gift snapshot and its correct plan to %s access', async state => {
    const { plan, gift } = await paidGift(); const recipient = await user(1002);
    if (state !== 'new') await sql()`insert into subscriptions (user_id, plan_name, is_trial, expires_at, traffic_limit_bytes, device_limit) values (${recipient.id}, 'Предыдущий', ${state === 'trial'}, ${new Date(Date.now() + (state === 'trial' ? 2 : -2) * DAY)}, 1073741824, 1)`;
    const result = await api('POST', '/gifts/redeem', recipient.token, { code: gift.code });
    expect(result.status).toBe(200);
    const [subscription] = await sql()`select * from subscriptions where user_id = ${recipient.id}`;
    expect(subscription).toMatchObject({ plan_id: plan.id, plan_name: plan.name, is_trial: false, device_limit: plan.device_limit, traffic_limit_bytes: plan.traffic_limit_gb * 1024 ** 3 });
  });

  it('honors the paid snapshot when its original plan has been deleted', async () => {
    const { plan, gift } = await paidGift(); const recipient = await user(1002);
    await sql()`delete from plans where id = ${plan.id}`;
    const result = await api('POST', '/gifts/redeem', recipient.token, { code: gift.code });
    expect(result.status).toBe(200);
    const [subscription] = await sql()`select * from subscriptions where user_id = ${recipient.id}`;
    expect(subscription!.plan_id).toBeNull(); expect(subscription!.plan_name).toBe(plan.name);
  });

  it('idempotently retries a successful activation for its recipient but refuses another account', async () => {
    const { buyer, gift } = await paidGift(); const recipient = await user(1002); const other = await user(1003);
    const first = await api('POST', '/gifts/redeem', recipient.token, { code: gift.code });
    expect(first.status).toBe(200);
    const repeated = await api('POST', '/gifts/redeem', recipient.token, { code: gift.code });
    expect(repeated.status).toBe(200); expect(repeated.body.expiresAt).toBe(first.body.expiresAt);
    expect((await api('POST', '/gifts/redeem', other.token, { code: gift.code })).status).toBe(409);
    const received = await api('GET', '/gifts/received', recipient.token);
    expect(received.status).toBe(200); expect(received.body.map((g: any) => g.id)).toContain(gift.id);
    expect(JSON.stringify(received.body)).not.toContain(gift.code);
    expect((await api('GET', '/gifts/received', other.token)).body).toEqual([]);
    const mine = (await api('GET', '/gifts', buyer.token)).body[0];
    expect(mine.state).toBe('redeemed'); expect(mine.code).toBeNull();
    expect((await api('PATCH', `/gifts/${gift.id}`, buyer.token, { message: 'Поздно', expectedVersion: mine.version })).status).toBe(409);
    expect((await api('POST', `/gifts/${gift.id}/rotate`, buyer.token, { expectedVersion: mine.version })).status).toBe(409);
  });

  it('administrator can revoke only a ready gift without a refund and without exposing codes', async () => {
    const { buyer, gift, paymentId } = await paidGift(); const recipient = await user(1002);
    const adminToken = await admin(); const analystToken = await admin('analyst');
    const listed = await api('GET', '/admin/gifts?state=ready&page=1', adminToken);
    expect(listed.status).toBe(200); expect(listed.body).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(listed.body.items[0]).toMatchObject({ id: gift.id, paymentId, buyer: { id: buyer.id, tgId: buyer.tgId }, recipient: null });
    expect(JSON.stringify(listed.body)).not.toContain(gift.code);
    expect(JSON.stringify(listed.body)).not.toMatch(/code_hash|code_encrypted/);
    expect((await api('GET', '/admin/gifts', buyer.token)).status).toBe(401);
    expect((await api('POST', `/admin/gifts/${gift.id}/revoke`, analystToken, {})).status).toBe(403);
    const [before] = await sql()`select balance from users where id = ${buyer.id}`;
    expect((await api('POST', `/admin/gifts/${gift.id}/revoke`, adminToken, {})).status).toBe(200);
    expect((await api('POST', '/gifts/redeem', recipient.token, { code: gift.code })).status).toBe(400);
    expect((await sql()`select status from payments where id = ${paymentId}`)[0]!.status).toBe('succeeded');
    expect((await sql()`select balance from users where id = ${buyer.id}`)[0]!.balance).toBe(before!.balance);
    expect((await sql()`select count(*)::int as n from audit_log where entity_id = ${gift.id}`)[0]!.n).toBeGreaterThan(0);
    expect((await api('GET', '/admin/gifts?state=ready&page=1', adminToken)).body.total).toBe(0);
    expect((await api('GET', '/admin/gifts?state=revoked&page=1', adminToken)).body.total).toBe(1);
  });
});
