import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDb, sql } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/lib/crypto.js';
import { clearSettingsCache } from '../src/services/settings.js';
import { seedDefaultPlans } from '../src/services/plans.js';
import { autoRenew } from '../src/services/autorenew.js';
import { monitorTick } from '../src/services/monitor.js';
import { expireLocations } from '../src/services/addons.js';
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
async function loginUser(tgId: number, startParam?: string) {
  const r = await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: tgId, first_name: 'T', username: 'u' + tgId }, { startParam }) } });
  expect(r.status).toBe(200);
  return r.json.accessToken as string;
}
const put = (group: string, body: unknown) => api('PUT', `/admin/settings/${group}`, { token: adminToken, body });
const adm = (m: string, u: string, body?: unknown) => api(m, '/admin' + u, { token: adminToken, body });
const userId = async (tg: number) => (await sql()`select id from users where tg_id = ${tg}`)[0]!.id as string;
const setBalance = async (tg: number, kop: number) => void (await sql()`update users set balance = ${kop} where tg_id = ${tg}`);

async function payYk(token: string, body: Record<string, unknown>) {
  const c = await api('POST', '/payments', { token, body: { method: 'yookassa', ...body } });
  expect(c.status).toBe(200);
  const [p] = await sql()`select external_id from payments where id = ${c.json.id}`;
  M.yk.state.statusOverride = 'succeeded';
  await api('POST', '/webhooks/yookassa', { body: { object: { id: p!.external_id } } });
  return c.json.id as string;
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
  await sql()`truncate users, plans, subscriptions, payments, promo_codes, promo_uses, transactions, referral_rewards, settings, admins, audit_log, broadcasts, auth_links, partner_links, quest_claims, locations, addon_products, user_locations, monitor_state, monitor_events, node_agents, node_ip_changes, withdrawals, ref_ledger, bot_media cascade`;
  clearSettingsCache();
  M.rw.state.users.clear();
  M.rw.state.calls.length = 0;
  M.rw.state.fail = false;
  M.yk.state.payments.clear();
  M.yk.state.statusOverride = null;
  M.tg.state.messages.length = 0;
  M.tg.state.members.clear();
  M.tg.state.down = false;
  await sql()`update referral_ranks set percent = 5, min_paid = 3 where name = 'Друг'`;
  await seedDefaultPlans();
  await sql()`insert into admins (email, password_hash, role) values ('owner@test.dev', ${await hashPassword('super-secret-pass')}, 'owner')`;
  adminToken = (await api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'super-secret-pass' } })).json.accessToken;
  expect((await put('yookassa', { enabled: true, shop_id: M.yk.shopId, secret_key: M.yk.secret })).status).toBe(200);
});


describe('колесо удачи', () => {
  it('один прокрут в сутки: приз зачисляется, повтор — 409, состояние обновляется', async () => {
    const token = await loginUser(920001);
    const w0 = await api('GET', '/wheel', { token });
    expect(w0.status).toBe(200);
    expect(w0.json.enabled).toBe(true);
    expect(w0.json.canSpin).toBe(true);
    expect(w0.json.prizes.length).toBeGreaterThanOrEqual(2);
    expect(w0.json.prizes[0]).not.toHaveProperty('weight');

    const before = Number((await sql()`select balance from users where tg_id = 920001`)[0]!.balance);
    const r = await api('POST', '/wheel/spin', { token });
    expect(r.status).toBe(200);
    expect(r.json.prizeIndex).toBeGreaterThanOrEqual(0);
    expect(w0.json.prizes[r.json.prizeIndex].id).toBe(r.json.prize.id);
    const after = Number((await sql()`select balance from users where tg_id = 920001`)[0]!.balance);
    if (r.json.prize.type === 'balance') {
      expect(after - before).toBe(r.json.prize.value);
      const [t] = await sql()`select type, amount from transactions where user_id = ${await userId(920001)} and type = 'wheel'`;
      expect(Number(t!.amount)).toBe(r.json.prize.value);
    } else {
      const [sub] = await sql()`select expires_at from subscriptions where user_id = ${await userId(920001)}`;
      expect(sub).toBeTruthy();
    }

    const again = await api('POST', '/wheel/spin', { token });
    expect(again.status).toBe(409);
    const w1 = await api('GET', '/wheel', { token });
    expect(w1.json.canSpin).toBe(false);
    expect(w1.json.nextSpinAt).toBeTruthy();
    expect(new Date(w1.json.nextSpinAt).getTime()).toBeGreaterThan(Date.now());
    expect(w1.json.last.id).toBe(r.json.prize.id);
  });

  it('параллельные прокруты: приз выдаётся ровно один раз', async () => {
    const token = await loginUser(920002);
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => api('POST', '/wheel/spin', { token })));
    expect(res.filter((x) => x.status === 200).length).toBe(1);
    expect(res.filter((x) => x.status === 409).length).toBe(4);
    const [n] = await sql()`select count(*)::int as n from wheel_spins where user_id = ${await userId(920002)}`;
    expect(n!.n).toBe(1);
  });

  it('на следующий день можно крутить снова', async () => {
    const token = await loginUser(920003);
    expect((await api('POST', '/wheel/spin', { token })).status).toBe(200);
    await sql()`update wheel_spins set day = to_char((now() at time zone 'Europe/Moscow') - interval '1 day', 'YYYY-MM-DD') where user_id = ${await userId(920003)}`;
    expect((await api('GET', '/wheel', { token })).json.canSpin).toBe(true);
    expect((await api('POST', '/wheel/spin', { token })).status).toBe(200);
  });

  it('отключённое колесо: спин запрещён, в конфиге wheelEnabled=false', async () => {
    const token = await loginUser(920004);
    expect((await put('wheel', { enabled: false })).status).toBe(200);
    expect((await api('GET', '/config')).json.wheelEnabled).toBe(false);
    expect((await api('POST', '/wheel/spin', { token })).status).toBe(409);
    expect((await api('GET', '/wheel', { token })).json.enabled).toBe(false);
  });

  it('распределение призов следует весам', async () => {
    const { pickPrize } = await import('../src/services/wheel.js');
    const prizes = [{ id: 'a', weight: 1 }, { id: 'b', weight: 9 }];
    const seen = { a: 0, b: 0 } as Record<string, number>;
    for (let i = 0; i < 10; i++) seen[pickPrize(prizes, () => i).prize.id]!++;
    expect(seen).toEqual({ a: 1, b: 9 });
  });

  it('админка: чтение статистики и сохранение призов, валидация', async () => {
    const g = await adm('GET', '/wheel');
    expect(g.status).toBe(200);
    expect(g.json.settings.prizes.length).toBeGreaterThanOrEqual(2);
    const prizes = [
      { id: 'x1', label: '+1 день', type: 'days', value: 1, weight: 1 },
      { id: 'x2', label: '+7 ₽', type: 'balance', value: 700, weight: 3 },
    ];
    expect((await adm('PUT', '/wheel', { enabled: true, prizes })).status).toBe(200);
    expect((await adm('GET', '/wheel')).json.settings.prizes.map((p: any) => p.id)).toEqual(['x1', 'x2']);
    expect((await adm('PUT', '/wheel', { enabled: true, prizes: [prizes[0]] })).status).toBe(400);
    expect((await adm('PUT', '/wheel', { enabled: true, prizes: [prizes[0], { ...prizes[1], id: 'x1' }] })).status).toBe(400);
  });
});

describe('устройства (HWID)', () => {
  it('список, удаление одного и всех; чужие id не работают; без подписки пусто', async () => {
    const token = await loginUser(930001);
    const empty = await api('GET', '/devices', { token });
    expect(empty.status).toBe(200);
    expect(empty.json.devices).toEqual([]);
    expect(empty.json.active).toBe(false);

    expect((await api('POST', '/subscription/trial', { token })).status).toBe(200);
    const [u] = await sql()`select rw_id from users where tg_id = 930001`;
    const mk = (hwid: string, model: string, t: string) => ({ hwid, userId: u!.rw_id, platform: 'Android', osVersion: '14', deviceModel: model, userAgent: null, requestIp: null, createdAt: t, updatedAt: t });
    M.rw.state.devices.set(u!.rw_id as number, [mk('hw-aaa', 'Pixel 8', '2026-10-01T10:00:00.000Z'), mk('hw-bbb', 'Galaxy S23', '2026-10-05T10:00:00.000Z')]);

    const l = await api('GET', '/devices', { token });
    expect(l.json.used).toBe(2);
    expect(l.json.active).toBe(true);
    expect(l.json.devices[0].name).toBe('Galaxy S23 · Android 14');
    expect(JSON.stringify(l.json)).not.toContain('hw-aaa');

    const id = l.json.devices[1].id as string;
    const d = await api('POST', '/devices/delete', { token, body: { id } });
    expect(d.status).toBe(200);
    expect(d.json.used).toBe(1);
    expect((await api('POST', '/devices/delete', { token, body: { id } })).status).toBe(404);
    expect((await api('POST', '/devices/delete', { token, body: { id: 'zz' } })).status).toBe(400);

    const other = await loginUser(930002);
    expect((await api('POST', '/devices/delete', { token: other, body: { id: l.json.devices[0].id } })).status).toBe(409);

    const all = await api('POST', '/devices/delete-all', { token });
    expect(all.json.used).toBe(0);
  });
});

describe('активность пользователей (админка)', () => {
  it('сводка, динамика, лента и последние визиты; доступ только админам', async () => {
    const token = await loginUser(940001);
    await loginUser(940002);
    expect((await api('POST', '/wheel/spin', { token })).status).toBe(200);
    expect((await api('GET', '/admin/activity', { token })).status).toBeGreaterThanOrEqual(401);
    const r = await adm('GET', '/activity');
    expect(r.status).toBe(200);
    expect(r.json.summary.total).toBe(2);
    expect(r.json.summary.active1d).toBe(2);
    expect(r.json.summary.new1d).toBe(2);
    expect(r.json.summary.vpnOnline).toBe(7);
    expect(r.json.series).toHaveLength(14);
    expect(r.json.series[13].signups).toBe(2);
    expect(r.json.series[13].engagement).toBe(1);
    expect(r.json.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['signup', 'wheel']));
    expect(r.json.recent).toHaveLength(2);
    expect(r.json.recent[0].subState).toBe('none');
  });
});

describe('автоперенастройка ноды при смене IP', () => {
  it('агент: смена IP обновляет ноду и хосты, повтор идемпотентен, чужой токен отклоняется', async () => {
    const node = M.rw.state.nodes[0]!;
    node.address = '5.5.5.5';
    M.rw.state.hosts[0]!.address = '5.5.5.5';
    M.rw.state.hosts[1]!.address = '9.9.9.9';
    const issued = await adm('POST', `/nodeip/${node.uuid}/agent`, {});
    expect(issued.status).toBe(200);
    expect(issued.json.token).toMatch(/^na_/);
    const rep = (token: string, ip: string) => api('POST', '/node-agent/report', { headers: { 'x-node-token': token, 'x-forwarded-for': ip } });
    expect((await rep('na_wrongtoken_123456', '8.8.8.8')).status).toBe(401);
    const r1 = await rep(issued.json.token, '8.8.4.4');
    expect(r1.status).toBe(200);
    expect(r1.json.changed).toBe(true);
    expect(M.rw.state.nodes[0]!.address).toBe('8.8.4.4');
    expect(M.rw.state.hosts[0]!.address).toBe('8.8.4.4');
    expect(M.rw.state.hosts[1]!.address).toBe('9.9.9.9');
    const r2 = await rep(issued.json.token, '8.8.4.4');
    expect(r2.json.changed).toBe(false);
    const ov = await adm('GET', '/nodeip');
    expect(ov.json.history).toHaveLength(1);
    expect(ov.json.agents[0].last_ip).toBe('8.8.4.4');
  });
  it('частный IP отклоняется, ручная смена работает', async () => {
    const node = M.rw.state.nodes[0]!;
    node.address = '5.5.5.5';
    expect((await adm('POST', `/nodeip/${node.uuid}/ip`, { ip: '192.168.1.5' })).status).toBe(400);
    const r = await adm('POST', `/nodeip/${node.uuid}/ip`, { ip: '1.2.3.4' });
    expect(r.status).toBe(200);
    expect(M.rw.state.nodes[0]!.address).toBe('1.2.3.4');
  });
});

describe('реферальное дерево для админа', () => {
  it('кто кого привёл: уровни, пригласивший, лента', async () => {
    const a = await loginUser(930001);
    const aCode = (await sql()`select referral_code from users where tg_id = 930001`)[0]!.referral_code as string;
    await loginUser(930002, 'ref_' + aCode);
    const bCode = (await sql()`select referral_code from users where tg_id = 930002`)[0]!.referral_code as string;
    await loginUser(930003, 'ref_' + bCode);
    void a;
    const tree = await adm('GET', `/users/${await userId(930001)}/referrals`);
    expect(tree.status).toBe(200);
    expect(tree.json.totals).toMatchObject({ level1: 1, level2: 1 });
    expect(tree.json.level1[0].invited).toBe(1);
    expect(tree.json.level2[0].via).not.toBeNull();
    const t2 = await adm('GET', `/users/${await userId(930002)}/referrals`);
    expect(t2.json.referrer.tgId).toBe(930001);
    const feed = await adm('GET', '/referrals/feed');
    expect(feed.json).toHaveLength(2);
  });
});

describe('реферальная программа: выбор награды, реферальный счёт, вывод', () => {
  async function friendPays(refTg: number, friendTg: number, amount = 50000) {
    const code = (await sql()`select referral_code from users where tg_id = ${refTg}`)[0]!.referral_code as string;
    await loginUser(friendTg, 'ref_' + code);
    const fid = await userId(friendTg);
    const [p] = await sql()`insert into payments (user_id, provider, purpose, plan_name, amount, status, paid_at, fulfilled_at, payload)
      values (${fid}, 'yookassa', 'plan', 'Премиум', ${amount}, 'succeeded', now(), now(), '{}'::jsonb) returning id`;
    const { rewardReferrer } = await import('../src/services/referrals.js');
    await rewardReferrer(p!.id as string);
  }
  const refs = (tg: number) => sql()`select ref_balance, balance, referral_mode from users where tg_id = ${tg}`.then((r) => r[0]!);

  it('режим «дни»: приходят дни, денег нет; режим «деньги»: процент на реферальный счёт, дней нет', async () => {
    const tokA = await loginUser(940001);
    await sql()`update settings set value = '{}'::jsonb where key = 'referral'`; // дефолты схемы
    await api('POST', '/trial/start', { token: tokA }).catch(() => {});
    // по умолчанию — дни
    const s0 = await api('GET', '/referrals', { token: tokA });
    expect(s0.json.mode).toBe('days');
    await friendPays(940001, 940002);
    let u = await refs(940001);
    expect(Number(u.ref_balance)).toBe(0);
    const daysRows = await sql()`select days, balance from referral_rewards where referrer_id = ${await userId(940001)}`;
    expect(daysRows[0]!.days).toBeGreaterThan(0);
    expect(Number(daysRows[0]!.balance)).toBe(0);
    // переключаем на деньги
    const sw = await api('POST', '/referrals/mode', { token: tokA, body: { mode: 'balance' } });
    expect(sw.status).toBe(200);
    expect(sw.json.mode).toBe('balance');
    await friendPays(940001, 940003, 100000);
    u = await refs(940001);
    expect(Number(u.ref_balance)).toBe(20000); // 20% от 1000 ₽
    expect(Number(u.balance)).toBe(0);
    const row = await sql()`select days, balance from referral_rewards where referrer_id = ${await userId(940001)} order by created_at desc limit 1`;
    expect(row[0]!.days).toBe(0);
    expect((await api('POST', '/referrals/mode', { token: tokA, body: { mode: 'x' } })).status).toBe(400);
  });

  it('перевод на баланс с бонусом и заявка на вывод: резерв, отказ возвращает, выплата закрывает', async () => {
    const tokA = await loginUser(941001);
    await api('POST', '/referrals/mode', { token: tokA, body: { mode: 'balance' } });
    await friendPays(941001, 941002, 300000); // 20% = 600 ₽
    expect(Number((await refs(941001)).ref_balance)).toBe(60000);
    // перевод 100 ₽ с бонусом 10%
    const tr = await api('POST', '/referrals/transfer', { token: tokA, body: { amount: 10000 } });
    expect(tr.status).toBe(200);
    expect(tr.json).toMatchObject({ moved: 10000, bonus: 1000 });
    let u = await refs(941001);
    expect(Number(u.ref_balance)).toBe(50000);
    expect(Number(u.balance)).toBe(11000);
    expect((await api('POST', '/referrals/transfer', { token: tokA, body: { amount: 99999999 } })).status).toBe(409);
    // вывод: меньше минимума, без реквизитов, больше счёта
    const w = (amount: number, details = '2200 7000 0000 0000') => api('POST', '/referrals/withdraw', { token: tokA, body: { amount, method: 'Карта', details } });
    expect((await w(10000)).status).toBe(400);
    expect((await w(50000, 'x')).status).toBe(400);
    expect((await w(90000)).status).toBe(409);
    const ok = await w(50000);
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('pending');
    expect(Number((await refs(941001)).ref_balance)).toBe(0);
    // отказ → деньги вернулись
    const list = await adm('GET', '/withdrawals?status=pending');
    expect(list.json).toHaveLength(1);
    const rej = await adm('POST', `/withdrawals/${ok.json.id}/reject`, { note: 'Неверные реквизиты' });
    expect(rej.status).toBe(200);
    expect(Number((await refs(941001)).ref_balance)).toBe(50000);
    expect((await adm('POST', `/withdrawals/${ok.json.id}/paid`, {})).status).toBe(409); // уже обработана
    // новая заявка → выплачена
    const ok2 = await w(50000);
    const paid = await adm('POST', `/withdrawals/${ok2.json.id}/paid`, {});
    expect(paid.status).toBe(200);
    expect(Number((await refs(941001)).ref_balance)).toBe(0);
    const mine = await api('GET', '/referrals/withdrawals', { token: tokA });
    expect(mine.json.map((x: any) => x.status).sort()).toEqual(['paid', 'rejected']);
    const st = await api('GET', '/referrals', { token: tokA });
    expect(st.json.withdrawn).toBe(50000);
  });

  it('выбор награды можно отключить: тогда начисляются и дни, и деньги на основной баланс', async () => {
    const tokA = await loginUser(942001);
    await put('referral', { choice_enabled: false, percent: 10, days: 7 });
    expect((await api('POST', '/referrals/mode', { token: tokA, body: { mode: 'balance' } })).status).toBe(409);
    await friendPays(942001, 942002, 100000);
    const u = await refs(942001);
    expect(Number(u.balance)).toBe(10000);
    expect(Number(u.ref_balance)).toBe(0);
    const r = await sql()`select days from referral_rewards where referrer_id = ${await userId(942001)}`;
    expect(r[0]!.days).toBe(7);
  });
});

describe('приветствие бота', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='.repeat(1);
  it('текст, картинка и применение описания в Telegram', async () => {
    const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(200)]).toString('base64');
    const put1 = await adm('PUT', '/bot-welcome', { description: 'Описание бота', short_description: 'Коротко', start_text: 'Привет, {name}! Это {brand}', sync: true });
    expect(put1.status).toBe(200);
    expect(put1.json.synced).toEqual({ ok: true });
    expect((await adm('PUT', '/bot-welcome', { description: 'x'.repeat(513), short_description: '', start_text: '' })).status).toBe(400);
    expect((await adm('POST', '/bot-welcome/image', { data: Buffer.alloc(500, 1).toString('base64') })).status).toBe(400); // не картинка
    const up = await adm('POST', '/bot-welcome/image', { data: big });
    expect(up.status).toBe(200);
    expect(up.json.imageUrl).toMatch(/\/api\/v1\/media\/welcome\?v=1$/);
    const raw = await app.inject({ method: 'GET', url: '/api/v1/media/welcome' });
    expect(raw.statusCode).toBe(200);
    expect(raw.headers['content-type']).toBe('image/png');
    const cfg = await api('GET', '/config');
    expect(cfg.json.startText).toBe('Привет, {name}! Это {brand}');
    expect(cfg.json.startImageUrl).toContain('/media/welcome?v=1');
    const up2 = await adm('POST', '/bot-welcome/image', { data: big });
    expect(up2.json.imageUrl).toContain('v=2');
    expect((await adm('DELETE', '/bot-welcome/image')).json.imageUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/v1/media/welcome' })).statusCode).toBe(404);
    // без прав админа — нельзя
    expect((await api('PUT', '/admin/bot-welcome', { body: { description: '', short_description: '', start_text: '' } })).status).toBe(401);
  });
});

describe('вход в Mini App: свежесть данных запуска', () => {
  it('3 дня — принимаем (свёрнутый iPhone), 8 дней — понятная ошибка init_expired, подделка — обычная ошибка', async () => {
    const now = Math.floor(Date.now() / 1000);
    const ok = await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: 950001, first_name: 'T' }, { authDate: now - 3 * 86400 }) } });
    expect(ok.status).toBe(200);
    const old = await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: 950001, first_name: 'T' }, { authDate: now - 8 * 86400 }) } });
    expect(old.status).toBe(401);
    expect(old.json.error.code).toBe('init_expired');
    expect(old.json.error.message).toContain('откройте его заново');
    const fake = await api('POST', '/auth/miniapp', { body: { initData: makeInitData({ id: 950001, first_name: 'T' }, { token: 'wrong-token' }) } });
    expect(fake.status).toBe(401);
    expect(fake.json.error.code).not.toBe('init_expired');
  });
});

describe('сессии админки', () => {
  const login = (remember?: boolean) => api('POST', '/admin/auth/login', { body: { email: 'owner@test.dev', password: 'super-secret-pass', remember } });
  const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString());

  it('«Запомнить меня» даёт 30 дней, без него — 12 часов; refresh продлевает с тем же режимом', async () => {
    const short = await login();
    const long = await login(true);
    expect(long.json.remember).toBe(true);
    const ds = decode(short.json.accessToken), dl = decode(long.json.accessToken);
    expect(ds.exp - ds.iat).toBe(12 * 3600);
    expect(dl.exp - dl.iat).toBe(30 * 86400);
    const r = await api('POST', '/admin/auth/refresh', { token: long.json.accessToken });
    expect(r.status).toBe(200);
    expect(r.json.remember).toBe(true);
    expect(decode(r.json.accessToken).rem).toBe(true);
    expect((await api('POST', '/admin/auth/refresh', {})).status).toBe(401);
  });

  it('«выйти везде» и смена пароля обнуляют старые токены, текущая сессия при смене пароля продолжается', async () => {
    const a = (await login(true)).json.accessToken;
    const b = (await login(true)).json.accessToken;
    const ch = await api('POST', '/admin/me/password', { token: a, body: { current: 'super-secret-pass', next: 'new-super-pass-1' } });
    expect(ch.status).toBe(200);
    expect((await api('GET', '/admin/me', { token: b })).status).toBe(401); // другое устройство вышло
    expect((await api('GET', '/admin/me', { token: a })).status).toBe(401); // старый токен тоже недействителен
    const fresh = ch.json.accessToken as string;
    expect((await api('GET', '/admin/me', { token: fresh })).status).toBe(200); // а выданный взамен работает
    expect((await api('POST', '/admin/auth/logout-all', { token: fresh })).status).toBe(200);
    expect((await api('GET', '/admin/me', { token: fresh })).status).toBe(401);
    // вернуть пароль для других тестов
    await sql()`update admins set password_hash = ${await hashPassword('super-secret-pass')} where email = 'owner@test.dev'`;
  });
});

describe('ошибки интерфейса', () => {
  it('принимает отчёт без авторизации и ограничивает размер', async () => {
    const r = await api('POST', '/client-error', { body: { app: 'miniapp', message: 'boom', where: '/plans', ua: 'test' } });
    expect(r.status).toBe(200);
    const big = await api('POST', '/client-error', { body: { message: 'x'.repeat(5000) } });
    expect(big.status).toBe(400);
  });
});
