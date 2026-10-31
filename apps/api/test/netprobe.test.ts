import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { buildApp } from '../src/app.js';
import { signAdminToken, signUserToken } from '../src/lib/jwt.js';
import { netTick, operatorOf, osOf, prefixOf, setAsnResolver } from '../src/services/netprobe.js';

const M = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let serial = 95000;
beforeAll(async () => { await sql()`drop schema public cascade`; await sql()`create schema public`; await migrate(); app = await buildApp({ logger: false }); });
beforeEach(async () => { await sql()`truncate users, admins, settings, monitor_state, net_probes, asn_cache, net_issues cascade`; clearSettingsCache(); M.tg.state.messages.length = 0; });
afterAll(async () => { await app.close(); await closeDb(); for (const m of Object.values(M) as any[]) m.server.close(); });

const call = (method: 'GET' | 'POST', url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: '/api/v1' + url, payload: payload as any, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } });

it('определяет оператора, ОС и префикс', () => {
  expect(operatorOf(16345, 'VIMPELCOM')).toBe('beeline');
  expect(operatorOf(null, 'PJSC Mobile TeleSystems')).toBe('mts');
  expect(operatorOf(31133, 'PJSC MegaFon')).toBe('megafon');
  expect(operatorOf(41330, 'Tele2 Russia')).toBe('tele2');
  expect(operatorOf(64512, 'Some Hosting')).toBe('other');
  expect(osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('ios');
  expect(osOf('Mozilla/5.0 (Linux; Android 14)')).toBe('android');
  expect(prefixOf('85.26.12.77')).toBe('85.26.12.0/24');
  expect(prefixOf('::ffff:85.26.12.77')).toBe('85.26.12.0/24');
});

it('замеры клиентов сохраняются без IP, оператор берётся из кэша; повтор раньше 20 минут игнорируется', async () => {
  setAsnResolver(async () => ({ asn: 16345, holder: 'VIMPELCOM' }));
  const u = await upsertTelegramUser({ id: serial++, first_name: 'Клиент' });
  const token = await signUserToken(u.id);
  const body = { results: [{ target: 'sub', kind: 'sub', ok: false, ms: 6000 }, { target: 'api', kind: 'api', ok: true, ms: 120 }] };
  const r = await call('POST', '/net/report', token, body, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  expect(r.json()).toMatchObject({ ok: true, saved: 2 });
  const rows = await sql()`select operator, os, source, target, ok from net_probes order by target`;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ operator: 'beeline', os: 'ios', source: 'client', target: 'api', ok: true });
  expect(JSON.stringify(await sql()`select * from asn_cache`)).not.toMatch(/\d+\.\d+\.\d+\.\d+(?!\/24)/);
  expect((await call('POST', '/net/report', token, body)).json().saved).toBe(0);
  expect((await call('POST', '/net/report', undefined, body)).statusCode).toBe(401);
  expect((await call('POST', '/net/report', token, { results: [] })).statusCode).toBe(400);
});

it('тревога: мало замеров — молчим; много неудач у оператора — алерт один раз и красный индикатор; восстановление закрывает', async () => {
  const admin = (await sql()`insert into admins(email,password_hash,role,tg_id) values('net@test','x','owner',9100) returning id`)[0]!;
  const tok = await signAdminToken(admin.id, 'owner');
  const add = (n: number, ok: boolean, op = 'beeline', target = 'sub') => sql()`insert into net_probes (source, operator, os, target, kind, ok, ms) select 'client', ${op}, 'ios', ${target}, 'sub', ${ok}, 100 from generate_series(1, ${n})`;
  await add(4, false);
  expect(await netTick()).toBe(0); // меньше 5 замеров
  await add(2, false);
  expect(await netTick()).toBe(1);
  await new Promise((r) => setTimeout(r, 100));
  expect(M.tg.state.messages.some((m: any) => m.chat_id === 9100 && /Билайн/.test(m.text))).toBe(true);
  expect(await netTick()).toBe(0); // повторно не шлём
  const att = (await call('GET', '/admin/attention', tok)).json();
  expect(att.items.find((i: any) => i.key === 'network')).toMatchObject({ count: 1, level: 'critical', web: '/network' });
  const st = (await call('GET', '/admin/net', tok)).json();
  expect(st.issues).toHaveLength(1);
  expect(st.rows[0]).toMatchObject({ operator: 'beeline', target: 'sub', okPct: 0, samples: 6 });
  await sql()`delete from net_probes`;
  await add(8, true);
  await netTick();
  expect((await call('GET', '/admin/attention', tok)).json().items.find((i: any) => i.key === 'network')).toBeUndefined();
});

it('Android-клиенты на другом операторе не вызывают тревогу; «всегда не работало» без базы тоже не молчит при достаточной выборке только если нет истории', async () => {
  await sql()`insert into net_probes (source, operator, os, target, kind, ok, ms) select 'client', 'mts', 'android', 'sub', 'sub', true, 90 from generate_series(1, 20)`;
  expect(await netTick()).toBe(0);
  // исторически плохая цель (вчера 10% успеха): новая волна неудач не считается «внезапной» поломкой
  await sql()`insert into net_probes (at, source, operator, os, target, kind, ok, ms) select now() - interval '5 hours', 'client', 'tele2', 'ios', 'host:A', 'host', (g % 10 = 0), 100 from generate_series(1, 30) g`;
  await sql()`insert into net_probes (source, operator, os, target, kind, ok, ms) select 'client', 'tele2', 'ios', 'host:A', 'host', false, 100 from generate_series(1, 8)`;
  expect(await netTick()).toBe(0);
});

it('пробы по ключу: только с внутренним ключом, неудача даёт алерт и индикатор', async () => {
  const key = process.env.INTERNAL_KEY ?? '';
  const payload = { name: 'phone-beeline', operator: 'beeline', results: [{ target: 'Латвия', kind: 'vless', ok: false, detail: 'таймаут' }, { target: 'Нидерланды', kind: 'vless', ok: true, ms: 480 }] };
  expect((await call('POST', '/net/probe-report', undefined, payload)).statusCode).toBe(401);
  if (!key) return;
  const r = await call('POST', '/net/probe-report', undefined, payload, { 'x-internal-key': key });
  expect(r.json()).toMatchObject({ ok: true, saved: 2 });
  const admin = (await sql()`insert into admins(email,password_hash,role) values('net2@test','x','owner') returning id`)[0]!;
  const att = (await call('GET', '/admin/attention', await signAdminToken(admin.id, 'owner'))).json();
  expect(att.items.find((i: any) => i.key === 'network')?.count).toBe(1);
});
