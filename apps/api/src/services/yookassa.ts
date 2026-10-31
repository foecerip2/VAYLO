import { randomUUID } from 'node:crypto';
import { badGateway } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { alertAdminsThrottled } from './alerts.js';
import { escapeHtml } from '../lib/errors.js';
import { getSettings } from './settings.js';

const BASE = 'https://api.yookassa.ru/v3';

export function yookassaBase(): string {
  return process.env.YOOKASSA_API_BASE || BASE;
}

export const PAY_ERROR_RU = 'Не удалось создать платёж: платёжный сервис временно недоступен. Попробуйте через пару минут или выберите другой способ оплаты.';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idemKey?: string): Promise<T> {
  const s = await getSettings('yookassa');
  if (!s.shop_id || !s.secret_key) throw badGateway(PAY_ERROR_RU, 'yookassa', 'YooKassa не настроена');
  const res = await fetch(yookassaBase() + path, {
    method,
    headers: {
      authorization: 'Basic ' + Buffer.from(`${s.shop_id}:${s.secret_key}`).toString('base64'),
      'content-type': 'application/json',
      ...(method === 'POST' ? { 'idempotence-key': idemKey ?? randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = `YooKassa ${method} ${path} → ${res.status}: ${json?.description ?? json?.code ?? ''}`;
    log.error('yookassa request failed', { method, path, status: res.status, description: json?.description, code: json?.code });
    void alertAdminsThrottled('yookassa-error', `🔴 <b>ЮKassa вернула ошибку</b>\n<code>${escapeHtml(raw.slice(0, 800))}</code>`, 600);
    throw badGateway(PAY_ERROR_RU, 'yookassa', raw);
  }
  return json as T;
}

export interface YkPayment {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  payment_id?: string;
  paid?: boolean;
  amount: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
}

export const yookassa = {
  async createPayment(p: { paymentId: string; amountKop: number; description: string; returnUrl: string }): Promise<{ externalId: string; payUrl: string }> {
    const s = await getSettings('yookassa');
    const value = (p.amountKop / 100).toFixed(2);
    const body: Record<string, unknown> = {
      amount: { value, currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: p.returnUrl },
      description: p.description.slice(0, 128),
      metadata: { payment_id: p.paymentId },
    };
    if (s.send_receipt) {
      body.receipt = {
        customer: { email: s.receipt_email },
        items: [
          {
            description: p.description.slice(0, 128),
            quantity: '1.00',
            amount: { value, currency: 'RUB' },
            vat_code: s.vat_code,
            payment_mode: 'full_payment',
            payment_subject: 'service',
          },
        ],
      };
    }
    // Idempotence-Key = наш paymentId: повторный вызов вернёт тот же платёж
    const r = await call<YkPayment>('POST', '/payments', body, p.paymentId);
    const url = r.confirmation?.confirmation_url;
    if (!url) throw badGateway(PAY_ERROR_RU, 'yookassa', 'YooKassa не вернула ссылку на оплату');
    return { externalId: r.id, payUrl: url };
  },

  /** Возврат: статус и id исходного платежа (для проверки webhook refund.succeeded) */
  getRefund(id: string): Promise<{ id: string; status: string; payment_id: string }> {
    return call('GET', `/refunds/${encodeURIComponent(id)}`);
  },

  getPayment(id: string): Promise<YkPayment> {
    return call<YkPayment>('GET', `/payments/${encodeURIComponent(id)}`);
  },

  /** Успешные платежи за период (постранично по cursor) — для сверки выручки */
  async listSucceeded(sinceIso: string): Promise<YkPayment[]> {
    const out: YkPayment[] = [];
    let cursor = '';
    for (let i = 0; i < 50; i++) {
      const r = await call<{ items?: YkPayment[]; next_cursor?: string }>('GET', `/payments?status=succeeded&limit=100&created_at.gte=${encodeURIComponent(sinceIso)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...(r.items ?? []));
      if (!r.next_cursor || !(r.items?.length)) break;
      cursor = r.next_cursor;
    }
    return out;
  },

  /** Тест подключения: запрашиваем список платежей (limit=1) */
  async ping(): Promise<void> {
    await call('GET', '/payments?limit=1');
  },
};
