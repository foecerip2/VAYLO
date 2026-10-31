import { PLATEGA_METHODS, type PlategaMethodKey } from '@vpn/shared';
import { safeEqual } from '../lib/crypto.js';
import { badGateway, escapeHtml } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { alertAdminsThrottled } from './alerts.js';
import { getSettings } from './settings.js';

const BASE = 'https://app.platega.io';

export function plategaBase(): string {
  return process.env.PLATEGA_API_BASE || BASE;
}

const PAY_ERROR_RU = 'Не удалось создать платёж: платёжный сервис временно недоступен. Попробуйте через пару минут или выберите другой способ оплаты.';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const s = await getSettings('platega');
  if (!s.merchant_id || !s.secret) throw badGateway(PAY_ERROR_RU, 'platega', 'Platega не настроена');
  const res = await fetch(plategaBase() + path, {
    method,
    headers: {
      'X-MerchantId': s.merchant_id,
      'X-Secret': s.secret,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const raw = `Platega ${method} ${path} → ${res.status}: ${json?.message ?? json?.error ?? text.slice(0, 160)}`;
    log.error('platega request failed', { method, path, status: res.status, body: text.slice(0, 300) });
    void alertAdminsThrottled('platega-error', `🔴 <b>Platega вернула ошибку</b>\n<code>${escapeHtml(raw.slice(0, 800))}</code>`, 600);
    throw badGateway(PAY_ERROR_RU, 'platega', raw);
  }
  return json as T;
}

export interface PlategaStatus {
  id?: string;
  status: string;
  paymentMethod?: string | number;
}

export const platega = {
  async createTransaction(p: {
    paymentId: string;
    method: PlategaMethodKey;
    amountKop: number;
    description: string;
    returnUrl: string;
    failedUrl: string;
  }): Promise<{ externalId: string; payUrl: string }> {
    const m = PLATEGA_METHODS[p.method];
    if (!m) throw badGateway(PAY_ERROR_RU, 'platega', 'Неизвестный метод Platega');
    const r = await call<{ transactionId?: string; redirect?: string; status?: string }>('POST', '/transaction/process', {
      paymentMethod: m.id,
      paymentDetails: { amount: Number((p.amountKop / 100).toFixed(2)), currency: 'RUB' },
      description: p.description.slice(0, 200),
      return: p.returnUrl,
      failedUrl: p.failedUrl,
      payload: p.paymentId,
    });
    if (!r.transactionId || !r.redirect) throw badGateway(PAY_ERROR_RU, 'platega', 'Platega не вернула ссылку на оплату');
    return { externalId: r.transactionId, payUrl: r.redirect };
  },

  getTransaction(id: string): Promise<PlategaStatus> {
    return call<PlategaStatus>('GET', `/transaction/${encodeURIComponent(id)}`);
  },

  /** Callback аутентифицируется заголовками X-MerchantId и X-Secret (подписи в API нет). */
  async verifyCallbackHeaders(headers: Record<string, unknown>): Promise<boolean> {
    const s = await getSettings('platega');
    if (!s.merchant_id || !s.secret) return false;
    const mid = String(headers['x-merchantid'] ?? '');
    const sec = String(headers['x-secret'] ?? '');
    return safeEqual(mid, s.merchant_id) && safeEqual(sec, s.secret);
  },

  /** Для теста подключения: запрос курса (требует валидных ключей) */
  async ping(): Promise<void> {
    await call('GET', '/rates/payment_method_rate?paymentMethod=2&currencyFrom=RUB&currencyTo=USDT');
  },
};

/** CONFIRMED → succeeded; CANCELED/EXPIRED/FAILED → canceled; CHARGEBACKED → refunded; остальное — pending. */
export function mapPlategaStatus(s: string): 'succeeded' | 'canceled' | 'refunded' | 'pending' {
  switch (s.toUpperCase()) {
    case 'CONFIRMED':
      return 'succeeded';
    case 'CANCELED':
    case 'EXPIRED':
    case 'FAILED':
      return 'canceled';
    case 'CHARGEBACKED':
      return 'refunded';
    default:
      return 'pending';
  }
}
