import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { buildApp } from '../src/app.js';
import { signAdminToken, signUserToken } from '../src/lib/jwt.js';

const M = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let serial = 91000;
beforeAll(async () => { await sql()`drop schema public cascade`; await sql()`create schema public`; await migrate(); app = await buildApp({ logger: false }); });
beforeEach(async () => { await sql()`truncate users, admins, plans, settings, monitor_state cascade`; clearSettingsCache(); });
afterAll(async () => { await app.close(); await closeDb(); for (const m of Object.values(M) as any[]) m.server.close(); });

const admin = async (role: string, tg: number | null = null) => (await sql()`insert into admins(email,password_hash,role,tg_id) values(${serial++ + '@attn.test'},'x',${role},${tg}) returning id`)[0]!;
const get = async (url: string, token: string) => app.inject({ method: 'GET', url: '/api/v1' + url, headers: { authorization: 'Bearer ' + token } });

it('пусто, пока ничего не требует внимания', async () => {
  const a = await admin('owner');
  const r = await get('/admin/attention', await signAdminToken(a.id, 'owner'));
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ items: [], total: 0, critical: 0 });
});

it('считает упавшие сервисы, оплаты без выдачи, обращения и выводы; поддержка видит только своё', async () => {
  const a = await admin('owner');
  const sup = await admin('support');
  const u = await upsertTelegramUser({ id: serial++, first_name: 'Клиент' });
  await sql()`insert into monitor_state (target,label,status) values ('api','API','up'),('node1','Нода 1','down')`;
  const [plan] = await sql()`insert into plans(name,duration_days,device_limit,price) values('1 месяц',30,3,19900) returning id`;
  // оплачено давно, доступ не выдан — критично; оплачено только что — воркер ещё не успел, не считаем
  await sql()`insert into payments(user_id,provider,purpose,plan_id,plan_name,amount,status,paid_at) values (${u.id},'platega','plan',${plan!.id},'1 месяц',19900,'succeeded', now() - interval '10 minutes')`;
  await sql()`insert into payments(user_id,provider,purpose,plan_id,plan_name,amount,status,paid_at) values (${u.id},'platega','plan',${plan!.id},'1 месяц',19900,'succeeded', now())`;
  await sql()`insert into withdrawals(user_id,amount,method,details,status) values (${u.id},50000,'sbp','+7','pending'),(${u.id},50000,'sbp','+7','paid')`;
  const owner = (await get('/admin/attention', await signAdminToken(a.id, 'owner'))).json();
  const by = Object.fromEntries(owner.items.map((i: any) => [i.key, i]));
  expect(by.down).toMatchObject({ count: 1, level: 'critical', web: '/monitoring' });
  expect(by.unfulfilled).toMatchObject({ count: 1, level: 'critical' });
  expect(by.withdrawals).toMatchObject({ count: 1, level: 'todo' });
  expect(owner.critical).toBe(2);
  expect(owner.total).toBe(owner.items.reduce((n: number, i: any) => n + i.count, 0));
  const s = (await get('/admin/attention', await signAdminToken(sup.id, 'support'))).json();
  expect(s.items.some((i: any) => i.key === 'down')).toBe(true); // роль analyst и выше видит мониторинг
});

it('профиль в Mini App: администратору — данные, обычному пользователю — пусто, без токена — 401', async () => {
  const tg = serial++;
  const u = await upsertTelegramUser({ id: tg, first_name: 'Админ' });
  await admin('owner', tg);
  await sql()`insert into monitor_state (target,label,status) values ('node1','Нода 1','down')`;
  const mine = await get('/admin-attention', await signUserToken(u.id));
  expect(mine.json().critical).toBe(1);
  const other = await upsertTelegramUser({ id: serial++, first_name: 'Обычный' });
  expect((await get('/admin-attention', await signUserToken(other.id))).json()).toEqual({ items: [], total: 0, critical: 0 });
  expect((await app.inject({ method: 'GET', url: '/api/v1/admin-attention' })).statusCode).toBe(401);
});
