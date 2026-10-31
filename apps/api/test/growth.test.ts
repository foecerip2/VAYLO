import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { resetConfigForTests } from '../src/config.js';
import { clearSettingsCache, setSettings } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { buildApp } from '../src/app.js';
import { signAdminToken, signUserToken } from '../src/lib/jwt.js';
import { setAsnResolver } from '../src/services/netprobe.js';
import { autodiscountSync, funnelTick } from '../src/services/growth.js';
import { dropCampaignCache, planDiscountFor } from '../src/services/campaigns.js';
import { noticeUsers } from '../src/services/networkIncidents.js';

const M = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let serial = 98000;
const setFlags = (on: string[]) => { for (const f of ['NETWORK_INTELLIGENCE_ENABLED', 'NETWORK_USER_NOTICES_ENABLED', 'NODE_RECOMMENDATIONS_ENABLED']) process.env[f] = on.includes(f) ? 'true' : 'false'; resetConfigForTests(); };
beforeAll(async () => { await sql()`drop schema public cascade`; await sql()`create schema public`; await migrate(); app = await buildApp({ logger: false }); setAsnResolver(async () => ({ asn: 16345, holder: 'VIMPELCOM' })); });
beforeEach(async () => { setFlags([]); await sql()`truncate users, admins, settings, plans, campaigns, net_probes, network_incidents, bot_funnel_sent cascade`; clearSettingsCache(); dropCampaignCache(); M.tg.state.messages.length = 0; });
afterAll(async () => { setFlags([]); await app.close(); await closeDb(); for (const m of Object.values(M) as any[]) m.server.close(); });

const call = (method: 'GET' | 'POST', url: string, token?: string, payload?: unknown) => app.inject({ method, url: '/api/v1' + url, payload: payload as any, headers: token ? { authorization: 'Bearer ' + token } : {} });
const mkUser = async () => { const u = await upsertTelegramUser({ id: serial++, first_name: 'T' } as any, null); return { u, tok: await signUserToken(u.id) }; };
const mkPlan = async () => (await sql()`insert into plans (name, duration_days, price) values ('M', 30, 30000) returning id`)[0]!.id as string;
const sub = (userId: string, plan: string, expiresSql: string, trial = false) => sql().unsafe(`insert into subscriptions (user_id, plan_id, expires_at, is_trial, started_at) values ('${userId}', '${plan}', ${expiresSql}, ${trial}, now() - interval '2 days')`);

describe('авто-скидки', () => {
  it('выключены по умолчанию: акции созданы, но неактивны; скидки нет', async () => {
    const plan = await mkPlan(); const { u } = await mkUser();
    await sub(u.id, plan, "now() + interval '2 days'");
    await autodiscountSync();
    const camps = await sql()`select auto_key, is_active from campaigns where auto_key is not null order by auto_key`;
    expect(camps.map((c) => [c.auto_key, c.is_active])).toEqual([['expired', false], ['expiring', false]]);
    expect(await planDiscountFor(u.id, plan)).toBeNull();
  });
  it('включены: скидка только «скоро заканчивается» и «недавно закончилась»; повторная синхронизация идемпотентна', async () => {
    const plan = await mkPlan();
    const soon = (await mkUser()).u, far = (await mkUser()).u, gone = (await mkUser()).u, old = (await mkUser()).u, trial = (await mkUser()).u;
    await sub(soon.id, plan, "now() + interval '2 days'"); await sub(far.id, plan, "now() + interval '40 days'");
    await sub(gone.id, plan, "now() - interval '3 days'"); await sub(old.id, plan, "now() - interval '60 days'"); await sub(trial.id, plan, "now() + interval '1 day'", true);
    await setSettings('autodiscount', { enabled: true, expiring_pct: 10, expired_pct: 25 } as any); clearSettingsCache();
    expect(await autodiscountSync()).toBeGreaterThan(0);
    expect(await autodiscountSync()).toBe(0);
    dropCampaignCache();
    expect(await planDiscountFor(soon.id, plan)).toMatchObject({ pct: 10 });
    expect(await planDiscountFor(gone.id, plan)).toMatchObject({ pct: 25 });
    expect(await planDiscountFor(far.id, plan)).toBeNull();
    expect(await planDiscountFor(old.id, plan)).toBeNull();
    expect(await planDiscountFor(trial.id, plan)).toBeNull();
    expect((await sql()`select count(*)::int as n from campaigns where auto_key is not null`)[0]!.n).toBe(2);
  });
});

describe('воронка в боте', () => {
  const tgOf = async (id: string) => Number((await sql()`select tg_id from users where id = ${id}`)[0]!.tg_id);
  it('выключена — тишина; включена — каждый шаг не более одного раза, заблокировавшим не пишем', async () => {
    const plan = await mkPlan();
    const fresh = (await mkUser()).u, blocked = (await mkUser()).u, tri = (await mkUser()).u, ended = (await mkUser()).u, paid = (await mkUser()).u;
    await sql()`update users set created_at = now() - interval '5 hours' where id in (${fresh.id}, ${blocked.id})`;
    await sql()`update users set bot_blocked = true where id = ${blocked.id}`;
    await sub(tri.id, plan, "now() + interval '1 day'", true); await sql()`update users set trial_used = true where id in (${tri.id}, ${ended.id}, ${paid.id})`;
    await sub(ended.id, plan, "now() - interval '1 day'", true); await sub(paid.id, plan, "now() - interval '1 day'", true);
    await sql()`insert into payments (user_id, provider, purpose, plan_id, amount, status, paid_at) values (${paid.id}, 'yk', 'plan', ${plan}, 30000, 'succeeded', now())`;
    expect(await funnelTick()).toBe(0);
    await setSettings('funnel', { enabled: true } as any); clearSettingsCache();
    const sent = await funnelTick();
    expect(sent).toBe(3);
    const texts = M.tg.state.messages.map((m: any) => `${m.chat_id}:${String(m.text).slice(0, 30)}`);
    const tg_fresh = await tgOf(fresh.id), tg_blocked = await tgOf(blocked.id), tg_paid = await tgOf(paid.id);
    expect(M.tg.state.messages.some((m: any) => m.chat_id === tg_fresh && /Подключение занимает/.test(m.text))).toBe(true);
    expect(M.tg.state.messages.some((m: any) => m.chat_id === tg_blocked)).toBe(false);
    expect(M.tg.state.messages.some((m: any) => m.chat_id === tg_paid)).toBe(false); // оплатил — предложение не нужно
    expect(texts.length).toBe(3);
    expect(await funnelTick()).toBe(0);
  });
});

describe('уведомления о сбоях сети и «Не работает»', () => {
  it('сбой подтверждён → один раз пишем пользователям этого оператора; восстановление — отдельно; флаг OFF — тишина', async () => {
    const a = (await mkUser()).u, other = (await mkUser()).u, nobody = (await mkUser()).u;
    await sql()`insert into net_probes (source, user_id, operator, os, target, kind, ok) values ('client', ${a.id}, 'beeline', 'ios', 'sub', 'sub', false), ('client', ${other.id}, 'mts', 'ios', 'sub', 'sub', true)`;
    const [inc] = await sql()`insert into network_incidents (scope_hash, target, operator, state) values ('NL|beeline','NL','beeline','confirmed') returning id`;
    expect(await noticeUsers(inc!.id as string, 'down')).toBe(0); // флаг выключен
    setFlags(['NETWORK_USER_NOTICES_ENABLED']);
    expect(await noticeUsers(inc!.id as string, 'down')).toBe(1);
    expect(await noticeUsers(inc!.id as string, 'down')).toBe(0); // повтор не дублирует
    expect(M.tg.state.messages).toHaveLength(1);
    expect(await noticeUsers(inc!.id as string, 'up')).toBe(1);
    expect(await noticeUsers(inc!.id as string, 'up')).toBe(0);
    void nobody;
  });
  it('/diagnose: требует вход, показывает подписку и серверы, без секретов', async () => {
    expect((await call('GET', '/diagnose')).statusCode).toBe(401);
    const plan = await mkPlan(); const { u, tok } = await mkUser();
    await sub(u.id, plan, "now() - interval '1 day'");
    const r = (await call('GET', '/diagnose', tok)).json();
    expect(r.verdict).toBe('subscription');
    expect(r.steps.find((s: any) => s.id === 'sub')).toMatchObject({ tone: 'bad' });
    expect(JSON.stringify(r)).not.toMatch(/vless:|sub_url|https?:\/\//);
    const adm = (await sql()`insert into admins(email,password_hash,role) values('g@t','x','analyst') returning id`)[0]!;
    const gs = (await call('GET', '/admin/growth/stats', await signAdminToken(adm.id, 'analyst'))).json();
    expect(gs).toHaveProperty('funnel');
  });
});
