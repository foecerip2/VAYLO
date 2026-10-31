import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache, setSettings } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { buildApp } from '../src/app.js';
import { signAdminToken, signUserToken } from '../src/lib/jwt.js';
import { createPayment } from '../src/services/payments.js';
import { startTrial } from '../src/services/subscriptions.js';
import { assertSalesOpen, announceClosure, closureTick, lastPaidUser } from '../src/services/closure.js';

const M = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let serial = 96000;
beforeAll(async () => { await sql()`drop schema public cascade`; await sql()`create schema public`; await migrate(); app = await buildApp({ logger: false }); });
beforeEach(async () => { await sql()`truncate users, admins, settings, plans, payments, bot_funnel_sent, channel_posts cascade`; clearSettingsCache(); M.tg.state.messages.length = 0; M.tg.state.blocked.clear(); });
afterAll(async () => { await app.close(); await closeDb(); for (const m of Object.values(M) as any[]) m.server.close(); });

const mkUser = async () => { const u = await upsertTelegramUser({ id: serial++, first_name: 'U' + serial } as any, null); return { u, tg: Number(u.tg_id), tok: await signUserToken(u.id) }; };
const plan = async () => (await sql()`insert into plans (name, duration_days, price) values ('M', 30, 30000) returning id`)[0]!.id as string;
const subFor = (id: string, plan_id: string, daysLeft: number, trial = false) => sql().unsafe(`insert into subscriptions (user_id, plan_id, expires_at, is_trial, started_at) values ('${id}', '${plan_id}', now() + interval '${daysLeft} days', ${trial}, now() - interval '1 day')`);
const pay = (id: string, plan_id: string, provider: string, days: number, extra: Record<string, unknown> = {}) =>
  sql()`insert into payments (user_id, provider, purpose, plan_id, plan_name, amount, status, paid_at, external_id, payload) values (${id}, ${provider}, 'plan', ${plan_id}, 'M', 30000, 'succeeded', now() - interval '1 hour', ${'ext-' + Math.random()}, ${sql().json({ plan: { days }, ...extra } as any)})`;
const admin = async () => { const [a] = await sql()`insert into admins(email,password_hash,role) values('c@t','x','admin') returning id`; return signAdminToken(a!.id, 'admin'); };
const call = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: unknown) => app.inject({ method, url: '/api/v1' + url, payload: payload as any, headers: { authorization: 'Bearer ' + token } });

/** A — ЮKassa, ещё 20 дней; D — ЮKassa на 10 дней, но админ добавил до 100; B — Platega; C — выдана вручную; E — подарок; F — пробный */
async function seed() {
  const p = await plan();
  const [A, B, C, D, E, F] = [await mkUser(), await mkUser(), await mkUser(), await mkUser(), await mkUser(), await mkUser()];
  await subFor(A.u.id, p, 20); await pay(A.u.id, p, 'yookassa', 20);
  await subFor(B.u.id, p, 90); await pay(B.u.id, p, 'platega', 90);
  await subFor(C.u.id, p, 365);
  await subFor(D.u.id, p, 100); await pay(D.u.id, p, 'yookassa', 10);
  await subFor(E.u.id, p, 60); await pay(E.u.id, p, 'yookassa', 60, { gift: true });
  await subFor(F.u.id, p, 7, true);
  return { p, A, B, C, D, E, F };
}

describe('закрытие проекта: поиск последнего оплатившего', () => {
  it('учитывает только оплаты ЮKassa и только оплаченный срок', async () => {
    const { A, D } = await seed();
    const last = await lastPaidUser();
    expect(last!.userId).toBe(A.u.id);                       // не B (Platega), не C (выдана), не E (подарок), не F (пробный)
    expect(Math.round((last!.effective.getTime() - Date.now()) / 86400000)).toBe(20);
    const next = await lastPaidUser([A.u.id]);               // после пропуска — D, и срок только оплаченные 10 дней, а не 100
    expect(next!.userId).toBe(D.u.id);
    expect(Math.round((next!.effective.getTime() - Date.now()) / 86400000)).toBe(10);
  });

  it('без оплат ЮKassa авто-режим просит указать дату вручную', async () => {
    const p = await plan(); const x = await mkUser(); await subFor(x.u.id, p, 30); await pay(x.u.id, p, 'platega', 30);
    expect(await lastPaidUser()).toBeNull();
    await expect(announceClosure({ mode: 'auto' })).rejects.toThrow(/вручную/);
  });
});

describe('закрытие проекта: запуск и блокировки', () => {
  it('объявление закрывает продажи, пробный период и регистрацию; существующие пользователи и подписки не затронуты', async () => {
    const { p, A } = await seed();
    await sql()`update users set auto_renew = true`;
    const r = await announceClosure({ mode: 'auto', reason: 'Проект не приносит пользы, закрываем.' });
    expect(Math.round((r.endsAt.getTime() - Date.now()) / 86400000)).toBe(20);
    await expect(createPayment(A.u, { planId: p, method: 'balance' } as any)).rejects.toMatchObject({ code: 'sales_closed' });
    const fresh = await mkUserExisting(A.u.tg_id);
    await expect(startTrial(fresh.id)).rejects.toMatchObject({ code: 'sales_closed' });
    await expect(upsertTelegramUser({ id: 777000111, first_name: 'Новый' } as any, null)).rejects.toMatchObject({ code: 'registration_closed', status: 403 });
    expect((await upsertTelegramUser({ id: Number(A.u.tg_id), first_name: 'A' } as any, null)).id).toBe(A.u.id); // старый пользователь заходит
    expect((await sql()`select count(*)::int n from users where auto_renew`)[0]!.n).toBe(0);
    expect((await sql()`select count(*)::int n from subscriptions where expires_at > now()`)[0]!.n).toBe(6); // подписки целы
  });

  it('/config отдаёт таймер, повторное объявление отклоняется', async () => {
    await seed(); const a = await announceClosure({ mode: 'auto' });
    const cfg = (await app.inject({ method: 'GET', url: '/api/v1/config' })).json();
    expect(cfg.closure).toMatchObject({ active: true, endsAt: a.endsAt.toISOString() });
    expect(typeof cfg.closure.serverNow).toBe('string');
    await expect(announceClosure({ mode: 'auto' })).rejects.toThrow(/уже объявлено/);
  });

  it('админка: дата редактируется, пользователя можно пропустить, режим вручную, отмена возвращает всё как было', async () => {
    const { A, D, p } = await seed(); const tok = await admin(); const outsider = await mkUser();
    const ann = await call('POST', '/admin/closure/announce', tok, { mode: 'auto' });
    expect(ann.statusCode).toBe(200);
    let o = (await call('GET', '/admin/closure', tok)).json();
    expect(o.lastPaid.userId).toBe(A.u.id);
    o = (await call('PUT', '/admin/closure', tok, { skipAdd: A.u.id })).json();           // пропуск → следующий
    expect(o.skipped).toHaveLength(1); expect(o.lastPaid.userId).toBe(D.u.id);
    expect(Math.round((new Date(o.endsAt).getTime() - Date.now()) / 86400000)).toBe(10);
    const manual = new Date(Date.now() + 5 * 86400000);
    o = (await call('PUT', '/admin/closure', tok, { mode: 'manual', endsAt: manual.toISOString() })).json();
    expect(o.mode).toBe('manual'); expect(new Date(o.endsAt).getTime()).toBe(manual.getTime());
    o = (await call('PUT', '/admin/closure', tok, { mode: 'auto', skipRemove: A.u.id })).json();  // назад в авто
    expect(o.lastPaid.userId).toBe(A.u.id);
    expect((await call('GET', '/admin/closure', outsider.tok)).statusCode).toBeGreaterThanOrEqual(401);
    expect((await call('POST', '/admin/closure/cancel', tok, { notify: false })).json().ok).toBe(true);
    await expect(assertSalesOpen()).resolves.toBeUndefined(); // продажи снова открыты
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().closure.active).toBe(false);
    void p;
    void D;
  });
});

async function mkUserExisting(tg: unknown) { return (await sql()`select * from users where tg_id = ${tg as any}`)[0] as any; }

describe('закрытие проекта: рассылки и возвраты', () => {
  it('объявление: всем с чатом, один раз; у подписчика — дата его подписки', async () => {
    const { A, F } = await seed();
    const blocked = await mkUser(); M.tg.state.blocked.add(blocked.tg);
    await announceClosure({ mode: 'auto', reason: 'Проект не приносит пользы.' });
    M.tg.state.messages.length = 0;
    const n = await closureTick();
    expect(n).toBeGreaterThanOrEqual(7);
    const toA = M.tg.state.messages.find((m: any) => m.chat_id === A.tg);
    expect(toA.text).toContain('не слетит'); expect(toA.text).toContain('Проект не приносит пользы');
    const toNoSub = M.tg.state.messages.find((m: any) => m.chat_id === F.tg);
    expect(toNoSub).toBeDefined();
    const before = M.tg.state.messages.length;
    await closureTick();
    expect(M.tg.state.messages.length).toBe(before);   // повторный тик не дублирует
  });

  it('напоминания идут только владельцам подписки и один раз на порог; в день закрытия — прощание', async () => {
    const { A, C } = await seed(); const nosub = await mkUser();
    await announceClosure({ mode: 'manual', endsAt: new Date(Date.now() + 2 * 86400000) });
    await closureTick();
    await sql()`update bot_funnel_sent set sent_at = now() - interval '2 days' where step = 'closure_announce'`;
    M.tg.state.messages.length = 0;
    await closureTick();
    const got = M.tg.state.messages.filter((m: any) => /До закрытия проекта осталось/.test(m.text)).map((m: any) => m.chat_id);
    expect(got).toContain(A.tg); expect(got).toContain(C.tg); expect(got).not.toContain(nosub.tg);
    M.tg.state.messages.length = 0; await closureTick(); expect(M.tg.state.messages).toHaveLength(0);
    const s = await sql()`select value from settings where key = 'closure'`;
    await sql()`update settings set value = jsonb_set(value, '{ends_at}', to_jsonb(${new Date(Date.now() - 60000).toISOString()}::text)) where key = 'closure'`; clearSettingsCache(); void s;
    M.tg.state.messages.length = 0; await closureTick();
    expect(M.tg.state.messages.filter((m: any) => /Спасибо, что были с нами/.test(m.text)).length).toBeGreaterThanOrEqual(3);
  });

  it('список для возвратов: только платежи ЮKassa с неиспользованным остатком, CSV скачивается', async () => {
    await seed(); const tok = await admin();
    const j = (await call('GET', '/admin/closure/refunds', tok)).json();
    expect(j.count).toBe(2);                       // A и D; подарок, Platega, выданные вручную — не в списке
    expect(j.rows.every((r: any) => r.unusedRub > 0 && r.unusedRub <= 300)).toBe(true);
    const csv = await call('GET', '/admin/closure/refunds.csv', tok);
    expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.body).toContain('id в ЮKassa');
  });

  it('отмена с уведомлением сообщает получателям объявления и очищает метки', async () => {
    await seed(); const tok = await admin();
    await call('POST', '/admin/closure/announce', tok, { mode: 'auto' }); await closureTick();
    M.tg.state.messages.length = 0;
    const r = (await call('POST', '/admin/closure/cancel', tok, { notify: true })).json();
    expect(r.notified).toBeGreaterThanOrEqual(5);
    await new Promise((res) => setTimeout(res, 600));
    expect(M.tg.state.messages.some((m: any) => /закрытие проекта отменено/.test(m.text))).toBe(true);
    expect((await sql()`select count(*)::int n from bot_funnel_sent where step like 'closure\_%'`)[0]!.n).toBe(0);
  });
});

void setSettings;
