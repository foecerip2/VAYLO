import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import { createBot } from './bot.js';

// забытый отклонённый промис не должен ронять бота
process.on('unhandledRejection', (r) => console.error('[bot] unhandled rejection', r));

const env = (k: string, d = '') => process.env[k] ?? d;
const token = env('BOT_TOKEN');
if (!token) {
  console.error('BOT_TOKEN не задан');
  process.exit(1);
}

const appUrl = env('APP_URL');
const bot = createBot({
  token,
  apiUrl: env('API_INTERNAL_URL', 'http://api:3000'),
  internalKey: env('INTERNAL_KEY'),
  appUrl,
  botUsername: env('BOT_USERNAME'),
  apiRoot: process.env.TELEGRAM_API_ROOT,
});

async function setup() {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'buy', description: 'Тарифы и оплата' },
    { command: 'connect', description: 'Подключиться к VPN' },
    { command: 'status', description: 'Статус серверов' },
    { command: 'devices', description: 'Мои устройства' },
    { command: 'balance', description: 'Баланс и пополнение' },
    { command: 'quests', description: 'Задания и награды' },
    { command: 'wheel', description: 'Колесо удачи' },
    { command: 'support', description: 'Поддержка' },
  ]);
  if (appUrl.startsWith('https://')) await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: appUrl } } });
}

async function main() {
  const webhookUrl = env('WEBHOOK_URL');
  await setup().catch((e) => console.error('[bot] setup:', e.message));
  if (webhookUrl) {
    const secret = env('WEBHOOK_SECRET');
    if (!secret) throw new Error('WEBHOOK_SECRET обязателен в режиме webhook');
    const handler = webhookCallback(bot, 'http', { secretToken: secret || undefined });
    const port = Number(env('PORT', '3001'));
    createServer((req, res) => {
      if (req.url === '/health') return void res.writeHead(200).end('ok');
      if (req.method === 'POST' && req.url === '/tg/webhook') return void handler(req, res);
      res.writeHead(404).end();
    }).listen(port, '0.0.0.0', () => console.log(`[bot] webhook-сервер на :${port}`));
    for (let i = 0; i < 10; i++) {
      try {
        await bot.api.setWebhook(webhookUrl, { secret_token: secret || undefined, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
        console.log('[bot] webhook установлен:', webhookUrl);
        break;
      } catch (e) {
        console.error('[bot] setWebhook не удался, повтор через 5с:', (e as Error).message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  } else {
    await bot.api.deleteWebhook();
    console.log('[bot] режим long polling');
    await bot.start({ allowed_updates: ['message', 'callback_query'] });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
