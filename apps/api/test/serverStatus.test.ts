import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache, setSettings } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { buildApp } from '../src/app.js';
import { signAdminToken, signUserToken } from '../src/lib/jwt.js';
import { flagOf, guessGroup, runCompensation, statusTick, statusView, syncStatusServers } from '../src/services/serverStatus.js';

const M = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let serial = 97000;
beforeAll(async () => { await sql()`drop schema public cascade`; await sql()`create schema public`; await migrate(); app = await buildApp({ logger: false }); });
beforeEach(async () => {
  await sql()`truncate users, admins, plans, settings, monitor_state, status_servers, subscriptions cascade`;
  clearSettingsCache(); M.tg.state.messages.length = 0; M.tg.state.blocked.clear(); M.rw.state.users.clear(); M.rw.state.fail = false;
});
afterAll(async () => { await app.close(); await closeDb(); for (const m of Object.values(M) as any[]) m.server.close(); });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const server = async (node: string, title: string, grp = 'location', planIds: string[] | null = null) =>
  (await sql()`insert into status_servers (node_uuid, title, grp, plan_ids) values (${node}, ${title}, ${grp}, ${planIds}::uuid[]) returning id`)[0]!.id as string;
const mon = (node: string, status: 'up' | 'down', hoursAgo = 0) => sql()`insert into monitor_state (target, label, status, since, checked_at) values (${'node:' + node}, ${'Нода'}, ${status}, now() - make_interval(hours => ${hoursAgo}), now())
  on conflict (target) do update set status = excluded.status, since = excluded.since, checked_at = now()`;
const user = async (active: boolean, planId: string | null = null, blocked = false) => {
  const u = await upsertTelegramUser({ id: serial++, first_name: 'Клиент' });
  if (blocked) await sql()`update users set bot_blocked = true where id = ${u.id}`;
  if (active || planId) await sql()`insert into subscriptions (user_id, plan_id, plan_name, expires_at) values (${u.id}, ${planId}, 'Тариф', ${new Date(Date.now() + 10 * 86400_000)})`;
  return u;
};
const msgs = (u: { tg_id: number | null }) => M.tg.state.messages.filter((m: any) => m.chat_id === u.tg_id);

it('флаг, раздел по названию', () => {
  expect(flagOf('SE')).toBe('🇸🇪');
  expect(flagOf(null)).toBe('🌐');
  expect(guessGroup('🇸🇪 LTE‑2')).toBe('lte');
  expect(guessGroup('🇷🇺 ➜ 🇩🇪 Германия')).toBe('bridge');
  expect(guessGroup('Sweden')).toBe('location');
});

it('синхронизация подтягивает ноды из Remnawave без дублей', async () => {
  expect(await syncStatusServers()).toBe(1);
  expect(await syncStatusServers()).toBe(0);
  const [s] = await sql()`select title, grp from status_servers`;
  expect(s).toMatchObject({ title: '🇳🇱 NL-1', grp: 'location' });
});

it('сводка для пользователей: группы, статусы, «все работают» и «часть недоступна»', async () => {
  await server('a', '🇸🇪 Швеция'); await server('b', '🇩🇪 Германия'); await server('c', '🇷🇺 ➜ 🇩🇪 Германия', 'bridge'); await server('d', '🇸🇪 LTE', 'lte');
  for (const n of ['a', 'b', 'c', 'd']) await mon(n, 'up');
  let v = await statusView();
  expect(v.overall).toBe('ok');
  expect(v.summary).toBe('Все локации работают · мосты работают · LTE работает');
  expect(v.groups.map((g) => g.key)).toEqual(['location', 'bridge', 'lte']);
  await mon('b', 'down');
  v = await statusView();
  expect(v.overall).toBe('partial');
  expect(v.summary).toMatch(/Недоступно 1 из 2 локаций/);
  await mon('a', 'down');
  expect((await statusView()).overall).toBe('down');
  await sql()`update status_servers set visible = false where node_uuid = 'c'`;
  expect((await statusView()).groups.map((g) => g.key)).toEqual(['location', 'lte']);
});

it('простой: оповещение после задержки, один раз; восстановление; короткий простой без компенсации', async () => {
  await server('a', '🇸🇪 Швеция'); await server('b', '🇩🇪 Германия');
  await mon('b', 'up');
  const active = await user(true); const expired = await user(false); const blocked = await user(true, null, true);
  await mon('a', 'down', 0);
  await sql()`update monitor_state set since = now() - interval '1 minute' where target = 'node:a'`;
  expect(await statusTick()).toBe(0); // ещё меньше 3 минут
  await sql()`update monitor_state set since = now() - interval '10 minutes' where target = 'node:a'`;
  await sql()`update status_outages set started_at = now() - interval '10 minutes'`; // простой «длится» уже 10 минут
  expect(await statusTick()).toBe(1);
  await wait(300);
  expect(msgs(active).some((m: any) => /Швеция недоступен/.test(m.text) && /Остальные локации работают/.test(m.text))).toBe(true);
  expect(msgs(expired).length).toBe(1); // «всем»: и тем, у кого подписка закончилась
  expect(msgs(blocked).length).toBe(0);
  expect(await statusTick()).toBe(0);
  await wait(100);
  expect(msgs(active).length).toBe(1); // второго оповещения нет
  const [o] = await sql()`select * from status_outages`;
  expect(o!.compensated_at).toBeNull(); // 10 минут — компенсации нет
  await mon('a', 'up');
  expect(await statusTick()).toBe(1);
  await wait(300);
  expect(msgs(active).some((m: any) => /снова работает/.test(m.text))).toBe(true);
  expect((await sql()`select resolved_at from status_outages`)[0]!.resolved_at).not.toBeNull();
});

it('аудитория «только с подпиской» и серверы с выбранным тарифом (LTE только PURPLE)', async () => {
  const [purple] = await sql()`insert into plans (name, duration_days, device_limit, price) values ('PURPLE', 30, 3, 50000) returning id`;
  const [basic] = await sql()`insert into plans (name, duration_days, device_limit, price) values ('BASIC', 30, 3, 10000) returning id`;
  await server('l', '🇸🇪 LTE', 'lte', [purple!.id]);
  const p = await user(true, purple!.id as string); const b = await user(true, basic!.id as string); const none = await user(false);
  await mon('l', 'down', 1);
  await statusTick(); await wait(300);
  expect(msgs(p).length).toBe(1); expect(msgs(b).length).toBe(0); expect(msgs(none).length).toBe(0);
  await sql()`delete from status_outages`;
  await setSettings('statuspage', { notify_audience: 'active' });
  await sql()`delete from status_servers`; await server('a', '🇸🇪 Швеция'); await mon('a', 'down', 1);
  await statusTick(); await wait(300);
  expect(msgs(none).length).toBe(0); expect(msgs(b).length).toBe(1);
});

it('простой дольше 5 часов: всем активным +1 день один раз, истёкшим и заблокировавшим бота — нет, повторов нет', async () => {
  await server('a', '🇸🇪 Швеция');
  const a1 = await user(true); const a2 = await user(true); const exp = await user(false);
  await mon('a', 'down', 6);
  await statusTick();
  await wait(1200);
  for (const u of [a1, a2]) {
    const [s] = await sql()`select expires_at from subscriptions where user_id = ${u.id}`;
    const days = Math.round(((s!.expires_at as Date).getTime() - Date.now()) / 86400_000);
    expect(days).toBe(11); // было 10 + 1
    expect(msgs(u).some((m: any) => /Компенсируем простой/.test(m.text))).toBe(true);
  }
  expect((await sql()`select 1 from subscriptions where user_id = ${exp.id}`).length).toBe(0);
  const [o] = await sql()`select * from status_outages`;
  expect(o).toMatchObject({ comp_users: 2, comp_done: true, comp_days: 1 });
  await statusTick(); await runCompensation(o!.id as string); await wait(200);
  const [s2] = await sql()`select expires_at from subscriptions where user_id = ${a1.id}`;
  expect(Math.round(((s2!.expires_at as Date).getTime() - Date.now()) / 86400_000)).toBe(11);
  expect((await sql()`select count(*)::int as n from status_compensations`)[0]!.n).toBe(2);
}, 30000);

it('не чаще раза в сутки: при втором простое другого сервера компенсация тому же человеку не повторяется', async () => {
  await server('a', '🇸🇪 Швеция'); await server('b', '🇩🇪 Германия');
  const u = await user(true);
  await mon('a', 'down', 6); await mon('b', 'down', 6);
  await statusTick(); await wait(1500);
  expect((await sql()`select count(*)::int as n from status_compensations where user_id = ${u.id}`)[0]!.n).toBe(1);
}, 30000);

it('если панель Remnawave недоступна — статус «неизвестно», простои не открываются', async () => {
  await server('a', '🇸🇪 Швеция');
  await mon('a', 'down', 6);
  await sql()`insert into monitor_state (target, label, status) values ('remnawave', 'Панель', 'down')`;
  expect(await statusTick()).toBe(0);
  expect((await sql()`select 1 from status_outages`).length).toBe(0);
  const v = await statusView();
  expect(v.overall).toBe('unknown');
  expect(v.groups[0]!.items[0]!.status).toBe('unknown');
});

it('API: пользователь видит статус; админ редактирует сервер и настройки; доступы по ролям', async () => {
  const sid = await server('a', '🇸🇪 Швеция'); await mon('a', 'up');
  const u = await user(true);
  const ut = await signUserToken(u.id);
  const r = await app.inject({ method: 'GET', url: '/api/v1/status/servers', headers: { authorization: 'Bearer ' + ut } });
  expect(r.json().overall).toBe('ok');
  expect((await app.inject({ method: 'GET', url: '/api/v1/status/servers' })).statusCode).toBe(401);
  const owner = (await sql()`insert into admins(email,password_hash,role) values('st@test','x','owner') returning id`)[0]!;
  const analyst = (await sql()`insert into admins(email,password_hash,role) values('st2@test','x','analyst') returning id`)[0]!;
  const ot = await signAdminToken(owner.id, 'owner'); const at = await signAdminToken(analyst.id, 'analyst');
  const put = (url: string, tok: string, payload: any) => app.inject({ method: 'PUT', url: '/api/v1/admin' + url, headers: { authorization: 'Bearer ' + tok }, payload });
  expect((await put(`/status-servers/${sid}`, at, { title: 'X', group: 'lte', sort: 5, visible: true, planIds: [] })).statusCode).toBe(403);
  expect((await put(`/status-servers/${sid}`, ot, { title: '🇸🇪 Швеция LTE', group: 'lte', sort: 5, visible: true, planIds: [] })).statusCode).toBe(200);
  expect((await put('/status-servers/settings', ot, { compensate_after_hours: 8, compensate_days: 2 })).json()).toMatchObject({ compensate_after_hours: 8, compensate_days: 2 });
  expect((await put('/status-servers/settings', ot, { compensate_days: 0 })).statusCode).toBe(400);
  const g = (await app.inject({ method: 'GET', url: '/api/v1/admin/status-servers', headers: { authorization: 'Bearer ' + at } })).json();
  expect(g.servers[0]).toMatchObject({ title: '🇸🇪 Швеция LTE', group: 'lte' });
  expect(g.preview.compensate).toMatchObject({ hours: 8, days: 2 });
});
