import { startPlategaMock, startRollypayMock, startRemnawaveMock, startTelegramMock, startYookassaMock } from './helpers/mocks.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/vpn_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/9';
process.env.APP_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.BOT_USERNAME = 'test_vpn_bot';
process.env.INTERNAL_KEY = 'internal-key-for-tests';
process.env.API_URL = 'https://api.example.test';
process.env.APP_URL = 'https://app.example.test';
process.env.ADMIN_URL = 'https://admin.example.test';

const rw = await startRemnawaveMock();
const yk = await startYookassaMock();
const pl = await startPlategaMock();
const rp = await startRollypayMock();
const tg = await startTelegramMock();
process.env.REMNAWAVE_URL = rw.url;
process.env.REMNAWAVE_TOKEN = rw.token;
process.env.YOOKASSA_API_BASE = yk.url;
process.env.PLATEGA_API_BASE = pl.url;
process.env.ROLLYPAY_API_BASE = rp.url;
process.env.TELEGRAM_API_ROOT = tg.url;

(globalThis as any).__mocks = { rw, yk, pl, rp, tg };

