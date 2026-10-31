/**
 * Локальный стенд для ручной проверки и e2e: настоящий API + БД + моки Remnawave/ЮKassa/Platega/Telegram.
 * Запуск: pnpm --filter @vpn/api exec tsx test/helpers/devstack.ts
 */
import { startPlategaMock, startRemnawaveMock, startTelegramMock, startYookassaMock } from './mocks.js';

process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:5432/vpn';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/8';
process.env.APP_SECRET = 'dev-secret-dev-secret-dev-secret-12345';
process.env.BOT_TOKEN = '123456:DEV-TOKEN';
process.env.BOT_USERNAME = 'dev_vpn_bot';
process.env.INTERNAL_KEY = 'dev-internal-key';
process.env.API_URL = 'http://localhost:3000';
process.env.APP_URL = 'http://localhost:5173';
process.env.ADMIN_URL = 'http://localhost:5174';

const rw = await startRemnawaveMock();
const yk = await startYookassaMock();
const pl = await startPlategaMock();
const tg = await startTelegramMock();
process.env.REMNAWAVE_URL = rw.url;
process.env.REMNAWAVE_TOKEN = rw.token;
process.env.YOOKASSA_API_BASE = yk.url;
process.env.PLATEGA_API_BASE = pl.url;
process.env.TELEGRAM_API_ROOT = tg.url;

const { sql } = await import('../../src/db/index.js');
const { migrate } = await import('../../src/db/migrate.js');
const { hashPassword } = await import('../../src/lib/crypto.js');
const { setSettings } = await import('../../src/services/settings.js');
const { seedDefaultPlans } = await import('../../src/services/plans.js');
const { buildApp } = await import('../../src/app.js');

await sql()`drop schema public cascade`;
await sql()`create schema public`;
await migrate();
await seedDefaultPlans();
await sql()`insert into admins (email, password_hash, role) values ('admin@example.com', ${await hashPassword('admin-password-123')}, 'owner')`;
await setSettings('yookassa', { enabled: true, shop_id: yk.shopId, secret_key: yk.secret });
await setSettings('platega', { enabled: true, merchant_id: pl.merchant, secret: pl.secret, methods: ['sbp', 'card_acquiring', 'crypto'] });
await setSettings('general', { brand_name: 'Shield VPN', support_url: 'https://t.me/support', channel_url: 'https://t.me/news' });
// демо-данные
const names = ['Анна', 'Борис', 'Виктор', 'Галина', 'Дмитрий', 'Елена', 'Жанна', 'Игорь', 'Кирилл', 'Лариса', 'Максим', 'Наталья'];
for (let i = 0; i < names.length; i++) {
  const [u] = await sql()`insert into users (tg_id, username, first_name, referral_code, created_at, balance) values (${1000 + i}, ${'user' + i}, ${names[i]!}, ${'ref' + i + 'abcde'}, now() - (${i} || ' days')::interval, ${i * 5000}) returning id`;
  if (i % 3 !== 2) {
    await sql()`insert into subscriptions (user_id, plan_name, is_trial, expires_at, started_at, traffic_limit_bytes, traffic_used_bytes, device_limit) values (${u!.id}, ${i % 4 === 0 ? 'Пробный период' : '3 месяца'}, ${i % 4 === 0}, now() + (${(i % 5) * 9 - 5} || ' days')::interval, now() - interval '10 days', 0, ${i * 1e9}, 3)`;
    if (i % 4 !== 0) await sql()`insert into payments (user_id, provider, purpose, plan_name, amount, status, paid_at, fulfilled_at, created_at) values (${u!.id}, ${i % 2 ? 'yookassa' : 'platega'}, 'plan', '3 месяца', 49900, 'succeeded', now() - (${i} || ' days')::interval, now(), now() - (${i} || ' days')::interval)`;
  }
}
{
  const { randomUUID } = await import('node:crypto');
  const [loc] = await sql()`insert into locations (name, country_code, description, squad_uuid) values ('Германия Premium', 'DE', 'Быстрые каналы, низкий пинг', ${rw.state.squadUuid}) returning id`;
  await sql()`insert into locations (name, country_code, squad_uuid) values ('Нидерланды Premium', 'NL', ${randomUUID()})`;
  await sql()`insert into addon_products (kind, name, price, qty, sort) values ('devices', '+1 устройство', 5000, 1, 1), ('devices', '+3 устройства', 12000, 3, 2), ('traffic', '+50 ГБ', 10000, 50, 3), ('traffic', '+200 ГБ', 30000, 200, 4)`;
  await sql()`insert into addon_products (kind, name, price, qty, location_id, duration_days, sort) values ('location', 'Германия, 30 ГБ · 30 дней', 15000, 30, ${loc!.id}, 30, 5)`;
  await sql()`insert into partner_links (code, name) values ('yt-vasya', 'YouTube Вася')`;
  await setSettings('topup', { bonuses: [{ from: 50000, percent: 5 }, { from: 100000, percent: 10 }] });
  await setSettings('referral', { days: 7, percent: 10, level2_percent: 3, signup_bonus_invitee: 5000 });
  await setSettings('appearance', { banner_text: '🔥 Скидка 20% на годовой тариф до воскресенья' });
}
await sql()`insert into promo_codes (code, type, value, max_uses) values ('WELCOME10', 'percent', 10, 100), ('GIFT7', 'days', 7, null)`;

const { startBroadcastWorker } = await import('../../src/services/broadcast.js');
startBroadcastWorker();
const app = await buildApp({ logger: false });
await app.listen({ port: 3000, host: '0.0.0.0' });
console.log('DEVSTACK READY http://localhost:3000');
(globalThis as any).__devstack = { rw, yk, pl, tg };

// маленький управляющий эндпоинт для e2e: подтвердить платёж "как провайдер"
import { createServer } from 'node:http';
createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/__pay') {
    const provider = u.searchParams.get('provider');
    if (provider === 'yookassa') {
      yk.state.statusOverride = 'succeeded';
      const ext = [...yk.state.payments.keys()].at(-1);
      await app.inject({ method: 'POST', url: '/api/v1/webhooks/yookassa', payload: { event: 'payment.succeeded', object: { id: ext } } });
    } else {
      const id = [...pl.state.txs.keys()].at(-1)!;
      pl.state.txs.get(id).status = 'CONFIRMED';
      await app.inject({ method: 'POST', url: '/api/v1/webhooks/platega', headers: { 'x-merchantid': pl.merchant, 'x-secret': pl.secret }, payload: { id, status: 'CONFIRMED' } });
    }
    return void res.writeHead(200).end('ok');
  }
  if (u.pathname === '/__members') {
    const chat = u.searchParams.get('chat')!;
    const set = tg.state.members.get(chat) ?? new Set<number>();
    for (const id of (u.searchParams.get('add') ?? '').split(',').filter(Boolean)) set.add(Number(id));
    tg.state.members.set(chat, set);
    return void res.writeHead(200).end('ok');
  }
  if (u.pathname === '/__tg') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(tg.state.messages));
  res.writeHead(404).end();
}).listen(3099);
