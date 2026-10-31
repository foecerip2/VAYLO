import { createHmac, randomUUID } from 'node:crypto';
import { ROLLYPAY_METHODS, type RollypayMethodKey } from '@vpn/shared';
import { config } from '../config.js';
import { safeEqual } from '../lib/crypto.js';
import { badGateway, escapeHtml } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { alertAdminsThrottled } from './alerts.js';
import { getSettings } from './settings.js';

const DEFAULT_BASE = 'https://api.rollypay.io/api/v1';
/** Допустимое расхождение времени в подписанном вебхуке (защита от повторной отправки старого запроса) */
const MAX_SKEW_MS = 5 * 60_000;

export function rollypayBase(s?: { api_base?: string }): string {
  return (process.env.ROLLYPAY_API_BASE || s?.api_base || DEFAULT_BASE).replace(/\/+$/, '');
}

const PAY_ERROR_RU = 'Не удалось создать платёж: платёжный сервис временно недоступен. Попробуйте через пару минут или выберите другой способ оплаты.';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const s = await getSettings('rollypay');
  if (!s.api_key) throw badGateway(PAY_ERROR_RU, 'rollypay', 'RollyPay не настроена');
  const res = await fetch(rollypayBase(s) + path, {
    method,
    headers: {
      'X-API-Key': s.api_key,
      // одноразовый идентификатор запроса: RollyPay отвергает повтор nonce в течение 10 минут
      'X-Nonce': randomUUID(),
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'vaylo-vpn/1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* не JSON */
  }
  if (!res.ok) {
    const raw = `RollyPay ${method} ${path} → ${res.status}: ${json?.error ?? json?.message ?? text.slice(0, 160)}`;
    log.error('rollypay request failed', { method, path, status: res.status, body: text.slice(0, 300) });
    void alertAdminsThrottled('rollypay-error', `🔴 <b>RollyPay вернула ошибку</b>\n<code>${escapeHtml(raw.slice(0, 800))}</code>`, 600);
    throw badGateway(PAY_ERROR_RU, 'rollypay', raw);
  }
  return json as T;
}

/** Ответы бывают как плоскими, так и обёрнутыми в data — достаём объект платежа в любом случае */
const unwrap = (j: any): Record<string, any> => (j && typeof j === 'object' && j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : j) ?? {};

export interface RollypayListed { paymentId: string; orderId?: string; status: string; amount: number; currency: string; test: boolean }
export interface RollypayPayment { paymentId: string; status: string; orderId?: string }

export const rollypay = {
  async createPayment(p: { paymentId: string; method: RollypayMethodKey; amountKop: number; description: string; returnUrl: string; failedUrl: string; customerId?: string }): Promise<{ externalId: string; payUrl: string }> {
    const s = await getSettings('rollypay');
    const m = ROLLYPAY_METHODS[p.method];
    if (!m) throw badGateway(PAY_ERROR_RU, 'rollypay', 'Неизвестный способ RollyPay');
    const r = unwrap(
      await call('POST', '/payments', {
        amount: (p.amountKop / 100).toFixed(2), // строка вида "199.00" — так требует API
        payment_currency: 'RUB',
        order_id: p.paymentId, // наш id платежа: по нему же идемпотентность на стороне RollyPay
        ...(m.api ? { payment_method: m.api } : {}),
        description: p.description.slice(0, 200),
        ...(p.customerId ? { customer_id: p.customerId } : {}),
        redirect_url: p.returnUrl,
        success_redirect_url: p.returnUrl,
        fail_redirect_url: p.failedUrl,
        metadata: { payment_id: p.paymentId },
        ...(s.terminal_id ? { terminal_id: s.terminal_id } : {}),
        callback_url: `${config().API_URL}/api/v1/webhooks/rollypay`,
        ...(s.test_mode ? { test: true } : {}),
      }),
    );
    const id = r.payment_id ?? r.id;
    const url = r.pay_url ?? r.payment_url ?? r.url;
    if (!id || !url) throw badGateway(PAY_ERROR_RU, 'rollypay', 'RollyPay не вернула ссылку на оплату');
    return { externalId: String(id), payUrl: String(url) };
  },

  async getPayment(id: string): Promise<RollypayPayment> {
    const r = unwrap(await call('GET', `/payments/${encodeURIComponent(id)}`));
    return { paymentId: String(r.payment_id ?? r.id ?? id), status: String(r.status ?? ''), orderId: r.order_id ? String(r.order_id) : undefined };
  },

  /** Все платежи кассы за период (постранично) — для сверки выручки. Форма ответа разбирается гибко. */
  async listPayments(sinceIso: string): Promise<RollypayListed[]> {
    const s = await getSettings('rollypay');
    const out: RollypayListed[] = [];
    for (let page = 1; page <= 50; page++) {
      const raw: any = await call('GET', `/payments?limit=100&page=${page}&from=${encodeURIComponent(sinceIso)}${s.terminal_id ? `&terminal_id=${encodeURIComponent(s.terminal_id)}` : ''}`);
      const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.payments) ? raw.payments : Array.isArray(raw?.data?.items) ? raw.data.items : [];
      for (const r of arr) {
        const id = r.payment_id ?? r.id;
        if (!id) continue;
        const n = Number(String(r.amount ?? '').replace(',', '.'));
        out.push({ paymentId: String(id), orderId: r.order_id ? String(r.order_id) : undefined, status: String(r.status ?? ''), amount: Number.isFinite(n) ? n : 0, currency: String(r.payment_currency ?? r.currency ?? 'RUB'), test: r.test === true });
      }
      if (arr.length < 100) break;
    }
    return out;
  },

  /** Проверка подключения: список платежей кассы (эндпоинт работает по API-ключу кассы) */
  async ping(): Promise<void> {
    const s = await getSettings('rollypay');
    await call('GET', `/payments?limit=1${s.terminal_id ? `&terminal_id=${encodeURIComponent(s.terminal_id)}` : ''}`);
  },
};

/** Подпись вебхука: hex HMAC-SHA256 от «timestamp.body» ключом signing_secret кассы */
export function signRollypay(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export async function verifyRollypayWebhook(headers: Record<string, unknown>, rawBody: string, now = Date.now()): Promise<'ok' | 'bad_signature' | 'stale' | 'not_configured'> {
  const s = await getSettings('rollypay');
  if (!s.signing_secret) return 'not_configured';
  const ts = String(headers['x-timestamp'] ?? '');
  const sig = String(headers['x-signature'] ?? '').trim().toLowerCase().replace(/^sha256=/, '');
  if (!ts || !sig) return 'bad_signature';
  if (!safeEqual(sig, signRollypay(s.signing_secret, ts, rawBody))) return 'bad_signature';
  // метка времени — секунды или миллисекунды
  const n = Number(ts);
  const ms = Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.parse(ts);
  if (!Number.isFinite(ms) || Math.abs(now - ms) > MAX_SKEW_MS) return 'stale';
  return 'ok';
}

/** paid → succeeded; canceled/expired/failed → canceled; refunded/chargeback → refunded; остальное — pending. */
export function mapRollypayStatus(s: string): 'succeeded' | 'canceled' | 'refunded' | 'pending' {
  switch (s.toLowerCase().replace(/^payment\./, '')) {
    case 'paid':
    case 'succeeded':
    case 'success':
    case 'completed':
      return 'succeeded';
    case 'canceled':
    case 'cancelled':
    case 'expired':
    case 'failed':
    case 'declined':
      return 'canceled';
    case 'refunded':
    case 'chargeback':
    case 'chargebacked':
      return 'refunded';
    default:
      return 'pending';
  }
}
