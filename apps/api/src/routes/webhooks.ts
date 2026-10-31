import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/index.js';
import type { PaymentRow } from '../db/types.js';
import { findByExternal, applyProviderStatus, refundPayment } from '../services/payments.js';
import { mapPlategaStatus, platega } from '../services/platega.js';
import { mapRollypayStatus, rollypay, verifyRollypayWebhook } from '../services/rollypay.js';
import { getSettings } from '../services/settings.js';
import { yookassa } from '../services/yookassa.js';

export async function webhookRoutes(app: FastifyInstance) {
  /**
   * ЮKassa: в уведомлении подписи нет, поэтому НЕ доверяем телу — берём id платежа и сами
   * запрашиваем его статус по API (рекомендация ЮKassa). Идемпотентно.
   */
  app.post('/webhooks/yookassa', async (req, reply) => {
    const body = z.object({ event: z.string().optional(), object: z.object({ id: z.string() }).passthrough() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false });
    // Возврат: object — это refund, id платежа в object.payment_id. Статус проверяем запросом к API.
    if (body.data.event === 'refund.succeeded' || typeof body.data.object.payment_id === 'string') {
      const pay = await findByExternal('yookassa', String(body.data.object.payment_id ?? ''));
      if (!pay) return { ok: true };
      try {
        const refund = await yookassa.getRefund(body.data.object.id);
        if (refund.status === 'succeeded' && refund.payment_id === pay.external_id) await refundPayment(pay.id);
      } catch (e) {
        req.log.error({ err: e }, 'yookassa refund verify failed');
        return reply.code(500).send({ ok: false });
      }
      return { ok: true };
    }
    const p = await findByExternal('yookassa', body.data.object.id);
    if (!p) return { ok: true }; // чужой/неизвестный платёж — отвечаем 200, чтобы не было повторов
    try {
      const real = await yookassa.getPayment(body.data.object.id);
      await applyProviderStatus(p.id, real.status === 'succeeded' ? 'succeeded' : real.status === 'canceled' ? 'canceled' : 'pending');
    } catch (e) {
      req.log.error({ err: e }, 'yookassa webhook verify failed');
      return reply.code(500).send({ ok: false }); // ЮKassa повторит
    }
    return { ok: true };
  });

  /**
   * Platega: callback аутентифицируется заголовками X-MerchantId / X-Secret.
   * Дополнительно сверяем статус запросом к API (если он недоступен — доверяем заголовкам).
   */
  app.post('/webhooks/platega', async (req, reply) => {
    if (!(await platega.verifyCallbackHeaders(req.headers))) return reply.code(401).send({ ok: false });
    const body = z.object({ id: z.string(), status: z.string() }).passthrough().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false });
    const p = await findByExternal('platega', body.data.id);
    if (!p) return { ok: true };
    let status = mapPlategaStatus(body.data.status);
    try {
      const real = await platega.getTransaction(body.data.id);
      if (real?.status) status = mapPlategaStatus(real.status);
    } catch {
      /* доверяем аутентифицированному callback */
    }
    await applyProviderStatus(p.id, status);
    return { ok: true };
  });

  /**
   * RollyPay: подпись X-Signature = hex HMAC-SHA256("X-Timestamp.тело") ключом signing_secret кассы.
   * Тело не считаем истиной: после проверки подписи берём id платежа и сверяем статус запросом к API.
   * Отвечаем 2xx, когда событие обработано или платёж нам неизвестен; 5xx — RollyPay повторит доставку (до 8 раз).
   */
  app.post('/webhooks/rollypay', async (req, reply) => {
    const raw = (req as { rawBody?: string }).rawBody ?? '';
    const v = await verifyRollypayWebhook(req.headers, raw);
    if (v !== 'ok') {
      req.log.warn({ reason: v }, 'rollypay webhook rejected');
      return reply.code(v === 'not_configured' ? 503 : 403).send({ ok: false });
    }
    const b = (req.body ?? {}) as Record<string, any>;
    const d = (b.data && typeof b.data === 'object' ? b.data : b) as Record<string, any>;
    // тестовые уведомления не должны зачислять деньги, пока не включён тестовый режим
    const isTest = b.test === true || d.test === true || String(req.headers['x-test-mode'] ?? '') === 'true';
    if (isTest && !(await getSettings('rollypay')).test_mode) return { ok: true, ignored: 'test' };
    const extId = String(d.payment_id ?? d.id ?? b.payment_id ?? '');
    const orderId = String(d.order_id ?? b.order_id ?? '');
    let p = extId ? await findByExternal('rollypay', extId) : null;
    if (!p && /^[0-9a-f-]{36}$/i.test(orderId)) {
      const [row] = await sql()<PaymentRow[]>`select * from payments where id = ${orderId} and provider = 'rollypay'`;
      p = row ?? null;
    }
    if (!p) return { ok: true };
    const event = String(b.event ?? b.type ?? d.status ?? '');
    let status = mapRollypayStatus(String(d.status ?? event));
    try {
      const real = await rollypay.getPayment(p.external_id ?? extId);
      if (real.status) status = mapRollypayStatus(real.status);
    } catch (e) {
      // API недоступно: событие подписано нашим секретом, доверяем ему только для понятных переходов
      req.log.warn({ err: (e as Error).message }, 'rollypay verify failed, trusting signed event');
    }
    try {
      await applyProviderStatus(p.id, status);
    } catch (e) {
      req.log.error({ err: e }, 'rollypay apply failed');
      return reply.code(500).send({ ok: false });
    }
    return { ok: true };
  });
}
