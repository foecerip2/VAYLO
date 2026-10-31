import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache, setSettings } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { buildApp } from '../src/app.js';
import { signAdminToken, signUserToken } from '../src/lib/jwt.js';
import { contestsTick, createContest, finishContest, joinContest, publishContest } from '../src/services/contests.js';

const M = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let serial = 97000;
const CH = '@vaylo_test';
beforeAll(async () => { await sql()`drop schema public cascade`; await sql()`create schema public`; await migrate(); app = await buildApp({ logger: false }); });
beforeEach(async () => {
  await sql()`truncate users, admins, settings, contests, channel_posts, partner_links, promo_codes cascade`; clearSettingsCache();
  M.tg.state.messages.length = 0; M.tg.state.members.clear(); M.tg.state.blocked.clear();
  M.tg.state.members.set(CH, new Set());
  await setSettings('contests', { enabled: true, channel: CH, publish_results: true } as any); clearSettingsCache();
});
afterAll(async () => { await app.close(); await closeDb(); for (const m of Object.values(M) as any[]) m.server.close(); });

const mkUser = async () => { const u = await upsertTelegramUser({ id: serial++, first_name: 'T' + serial, username: 'u' + serial } as any, null); return { u, tg: Number(u.tg_id), tok: await signUserToken(u.id) }; };
const member = (tg: number) => M.tg.state.members.get(CH).add(tg);
const admin = async () => { const [a] = await sql()`insert into admins(email,password_hash,role) values('c@t','x','admin') returning id`; return signAdminToken(a!.id, 'admin'); };
const req = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: unknown) => app.inject({ method, url: '/api/v1' + url, payload: payload as any, headers: { authorization: 'Bearer ' + token } });
const soon = () => new Date(Date.now() + 3600_000);
const mk = (over: Record<string, unknown> = {}) => createContest({ title: 'Тест', prizeKind: 'days', prizeValue: 7, winnersCount: 2, requireChannel: true, endsAt: soon(), ...over } as any);

describe('конкурсы', () => {
  it('публикация шлёт пост с кнопкой «Участвовать» в канал и активирует конкурс', async () => {
    const id = await mk(); const r = await publishContest(id);
    expect(r.postStatus).toBe('sent'); expect(r.link).toContain('test_vpn_bot?start=c_');
    const post = M.tg.state.messages.find((m: any) => m.chat_id === CH);
    expect(post.text).toContain('Тест'); expect(JSON.stringify(post.reply_markup)).toContain('Участвовать');
    expect((await sql()`select status from contests where id = ${id}`)[0]!.status).toBe('active');
  });

  it('без канала публикация отклоняется понятной ошибкой', async () => {
    await setSettings('contests', { enabled: true, channel: '' } as any); clearSettingsCache();
    await expect(publishContest(await mk())).rejects.toThrow(/Канал/);
  });

  it('участие: нужна подписка на канал, повтор не дублирует', async () => {
    const id = await mk(); await publishContest(id);
    const [c] = await sql()`select code from contests where id = ${id}`;
    const a = await mkUser();
    expect((await joinContest(a.u, c!.code)).reason).toBe('need_channel');
    member(a.tg);
    expect((await joinContest(a.u, c!.code)).ok).toBe(true);
    expect((await joinContest(a.u, c!.code)).reason).toBe('already');
    expect((await sql()`select count(*)::int n from contest_entries`)[0]!.n).toBe(1);
  });

  it('выключенный модуль и неактивный конкурс не принимают участие', async () => {
    const id = await mk(); const [c] = await sql()`select code from contests where id = ${id}`; const a = await mkUser(); member(a.tg);
    expect((await joinContest(a.u, c!.code)).reason).toBe('not_active'); // ещё черновик
    await setSettings('contests', { enabled: false } as any); clearSettingsCache();
    expect((await joinContest(a.u, c!.code)).reason).toBe('disabled');
  });

  it('итоги: победители выбираются среди подписанных, дни начисляются, уведомления и пост итогов уходят', async () => {
    const id = await mk({ winnersCount: 2 }); await publishContest(id);
    const [c] = await sql()`select code from contests where id = ${id}`;
    const users = [await mkUser(), await mkUser(), await mkUser(), await mkUser()];
    for (const u of users) member(u.tg);
    for (const u of users) await joinContest(u.u, c!.code);
    M.tg.state.members.get(CH).delete(users[0]!.tg); // отписался до итогов
    M.tg.state.messages.length = 0;
    const r = await finishContest(id);
    expect(r!.winners).toHaveLength(2);
    expect(r!.winners.every((w) => w.userId !== users[0]!.u.id)).toBe(true);
    expect(r!.winners.every((w) => w.status === 'paid')).toBe(true);
    const subs = await sql()`select count(*)::int n from subscriptions`; expect(subs[0]!.n).toBe(2);
    expect(M.tg.state.messages.filter((m: any) => /победили/.test(m.text))).toHaveLength(2);
    expect(M.tg.state.messages.some((m: any) => m.chat_id === CH && /Итоги конкурса/.test(m.text))).toBe(true);
    expect(await finishContest(id)).toBeNull(); // повторный вызов ничего не делает
  });

  it('призы: баланс, промокод и ручной', async () => {
    for (const [kind, value, text] of [['balance', 30000, ''], ['discount', 50, ''], ['manual', 0, 'Наушники']] as const) {
      const id = await mk({ prizeKind: kind, prizeValue: value, prizeText: text, winnersCount: 1, requireChannel: false }); await publishContest(id);
      const [c] = await sql()`select code from contests where id = ${id}`; const a = await mkUser();
      await joinContest(a.u, c!.code); const r = await finishContest(id);
      expect(r!.winners[0]!.status).toBe(kind === 'manual' ? 'manual_pending' : 'paid');
      if (kind === 'balance') expect(Number((await sql()`select balance from users where id = ${a.u.id}`)[0]!.balance)).toBe(30000);
      if (kind === 'discount') expect((await sql()`select count(*)::int n from promo_codes where code like 'WIN-%' and type = 'percent' and value = 50`)[0]!.n).toBe(1);
    }
  });

  it('тик воркера сам подводит итоги по сроку', async () => {
    const id = await mk(); await publishContest(id);
    await sql()`update contests set ends_at = now() - interval '1 minute' where id = ${id}`;
    await contestsTick();
    expect((await sql()`select status from contests where id = ${id}`)[0]!.status).toBe('finished');
  });

  it('отложенный пост уходит по расписанию, а не сразу', async () => {
    const id = await mk(); const r = await publishContest(id, { scheduleAt: new Date(Date.now() + 3600_000) });
    expect(r.postStatus).toBe('scheduled'); expect(M.tg.state.messages.filter((m: any) => m.chat_id === CH)).toHaveLength(0);
    await sql()`update channel_posts set scheduled_at = now() - interval '1 minute'`;
    await contestsTick();
    expect(M.tg.state.messages.filter((m: any) => m.chat_id === CH)).toHaveLength(1);
  });

  it('админка: быстрый конкурс одним запросом, права и валидация', async () => {
    const tok = await admin();
    const r = await req('POST', '/admin/contests/quick', tok, { preset: 'week' });
    expect(r.statusCode).toBe(200); expect(r.json().postStatus).toBe('sent');
    const list = (await req('GET', '/admin/contests', tok)).json();
    expect(list.items[0]).toMatchObject({ status: 'active', winnersCount: 5 });
    expect((await req('POST', '/admin/contests', tok, { title: 'x', prizeKind: 'days', prizeValue: 0, endsAt: soon().toISOString() })).statusCode).toBe(400);
    const u = await mkUser();
    expect((await req('GET', '/admin/contests', u.tok)).statusCode).toBeGreaterThanOrEqual(401);
  });

  it('пользовательские маршруты: список и участие через API', async () => {
    const id = await mk({ requireChannel: false }); await publishContest(id);
    const a = await mkUser();
    expect((await req('GET', '/contests', a.tok)).json()).toHaveLength(1);
    const [c] = await sql()`select code from contests where id = ${id}`;
    expect((await req('POST', '/contests/join', a.tok, { code: c!.code })).json().ok).toBe(true);
  });
});

describe('реклама', () => {
  it('ссылка, затраты и окупаемость считаются по пришедшим пользователям', async () => {
    const tok = await admin();
    const created = (await req('POST', '/admin/ads', tok, { name: 'Блогер Вася', source: 'YouTube', costRub: 1000 })).json();
    expect(created.link).toMatch(/start=ref_ad-/);
    const code = created.link.split('ref_')[1];
    const u = await upsertTelegramUser({ id: serial++, first_name: 'R' } as any, code);
    await upsertTelegramUser({ id: serial++, first_name: 'R2' } as any, code);
    const [plan] = await sql()`insert into plans (name, duration_days, price) values ('M', 30, 30000) returning id`;
    await sql()`insert into payments (user_id, provider, purpose, plan_id, amount, status, paid_at) values (${u.id}, 'yookassa', 'plan', ${plan!.id}, 150000, 'succeeded', now())`;
    const r = (await req('GET', '/admin/ads', tok)).json();
    expect(r.items[0]).toMatchObject({ registrations: 2, paying: 1, revenueRub: 1500, costRub: 1000, roiPct: 50, cpaRub: 1000 });
    expect(r.totals.roiPct).toBe(50);
  });

  it('пост с рекламной ссылкой подставляет {{link}} и кнопку', async () => {
    const tok = await admin();
    const ad = (await req('POST', '/admin/ads', tok, { name: 'Канал А', costRub: 0 })).json();
    const [row] = await sql()`select id from partner_links`;
    const r = await req('POST', '/admin/channel-posts', tok, { text: 'Привет {{link}}', buttonText: 'Открыть', adId: row!.id });
    expect(r.json().status).toBe('sent');
    const m = M.tg.state.messages.find((x: any) => x.chat_id === CH);
    expect(m.text).toContain(ad.link); expect(JSON.stringify(m.reply_markup)).toContain(ad.link);
  });

  it('шаблоны постов доступны', async () => {
    const t = (await req('GET', '/admin/post-templates', await admin())).json();
    expect(t.length).toBeGreaterThanOrEqual(4);
  });
});
