import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { issueGift } from './gifts.js';
import { PLATEGA_METHODS, ROLLYPAY_METHODS, durationLabel, formatRub, type PaymentMethodDTO, type PlategaMethodKey, type RollypayMethodKey } from '@vpn/shared';
import { config } from '../config.js';
import { sql, type TxSql } from '../db/index.js';
import type { PaymentRow, PlanRow, PromoRow, UserRow } from '../db/types.js';
import { badRequest, conflict, escapeHtml, HttpError, isPermanentError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { alertAdmins, alertAdminsThrottled } from './alerts.js';
import { notifyUser, openAppButton } from './notify.js';
import { dispatchPaymentNotice } from './paymentNotifications.js';
import { getPlan } from './plans.js';
import { planDiscountFor, topupBonusPct } from './campaigns.js';
import { discountFor, findPromo, isDiscount, markUsed, releasePromoForPayment, reserveForPayment } from './promo.js';
import { mapPlategaStatus, platega } from './platega.js';
import { mapRollypayStatus, rollypay } from './rollypay.js';
import { rewardReferrer } from './referrals.js';
import { applyAddon, assertCanBuyAddon, getAddon, type AddonRow } from './addons.js';
import { getSettings } from './settings.js';
import { assertNotMaintenance, grantAccess } from './subscriptions.js';
import { assertSalesOpen } from './closure.js';
import { yookassa } from './yookassa.js';

const GB = 1024 ** 3;

/** Бонус к пополнению по ступеням из настроек (копейки) */
export async function topupBonus(amount: number, extraPct = 0): Promise<number> {
  const cfg = await getSettings('topup');
  const tier = [...cfg.bonuses].sort((a, b) => b.from - a.from).find((t) => amount >= t.from);
  return Math.floor((amount * ((tier?.percent ?? 0) + extraPct)) / 100);
}

export async function availableMethods(): Promise<PaymentMethodDTO[]> {
  const out: PaymentMethodDTO[] = [];
  const yk = await getSettings('yookassa');
  if (yk.enabled && yk.shop_id && yk.secret_key) {
    out.push({ id: 'yookassa', provider: 'yookassa', title: 'Карта · СБП · SberPay', hint: 'ЮKassa' });
  }
  const pl = await getSettings('platega');
  if (pl.enabled && pl.merchant_id && pl.secret) {
    for (const key of pl.methods) {
      const m = PLATEGA_METHODS[key];
      if (m) out.push({ id: `platega:${key}`, provider: 'platega', method: key, title: m.title, hint: 'Platega' });
    }
  }
  const rp = await getSettings('rollypay');
  if (rp.enabled && rp.api_key && rp.signing_secret) {
    for (const key of rp.methods) {
      const m = ROLLYPAY_METHODS[key];
      if (m) out.push({ id: `rollypay:${key}`, provider: 'rollypay', method: key, title: m.title, hint: 'RollyPay' });
    }
  }
  return out;
}

interface Quote {
  plan: PlanRow | null;
  addon: AddonRow | null;
  promo: PromoRow | null;
  gross: number;
  discount: number;
  total: number;
  bonus: number;
}

export interface CartThen {
  planId?: string;
  addonId?: string;
}

export async function quote(userId: string, input: { planId?: string; addonId?: string; topupAmount?: number; promo?: string | null }): Promise<Quote> {
  if (input.planId || input.addonId) {
    const [u] = await sql()<UserRow[]>`select discount_pct from users where id = ${userId}`;
    const pct = u?.discount_pct ?? 0;
    let plan: PlanRow | null = null;
    let addon: AddonRow | null = null;
    let price: number;
    if (input.planId) {
      plan = await getPlan(input.planId);
      price = plan.price;
    } else {
      addon = await getAddon(input.addonId!);
      await assertCanBuyAddon(userId, addon);
      price = addon.price;
    }
    // акция «скидка на тарифы» действует на тарифы (не на докупки) и суммируется со скидкой пользователя
    const camp = plan ? await planDiscountFor(userId, plan.id) : null;
    let promo: PromoRow | null = null;
    let discount = Math.floor((price * Math.min(100, pct + (camp?.pct ?? 0))) / 100);
    if (input.promo && plan) {
      promo = await findPromo(input.promo, userId);
      if (!isDiscount(promo)) throw badRequest('Этот промокод нужно активировать в профиле', 'promo_gift_only');
      discount = Math.min(price, discount + discountFor(promo, price));
    }
    return { plan, addon, promo, gross: price, discount, total: price - discount, bonus: 0 };
  }
  const cfg = await getSettings('topup');
  const amount = input.topupAmount ?? 0;
  if (!Number.isInteger(amount) || amount < cfg.min || amount > cfg.max) {
    throw badRequest(`Сумма пополнения — от ${formatRub(cfg.min)} до ${formatRub(cfg.max)}`, 'bad_amount');
  }
  return { plan: null, addon: null, promo: null, gross: amount, discount: 0, total: amount, bonus: await topupBonus(amount, await topupBonusPct(userId)) };
}

export interface CreatedPayment {
  id: string;
  status: PaymentRow['status'];
  payUrl: string | null;
}

async function checkThen(userId: string, t: CartThen | undefined): Promise<CartThen | null> {
  if (!t || (!t.planId && !t.addonId)) return null;
  if (t.planId) await getPlan(t.planId);
  else await getAddon(t.addonId!);
  return t.planId ? { planId: t.planId } : { addonId: t.addonId! };
}

export interface PaymentInput { planId?: string; addonId?: string; topupAmount?: number; method: string; promo?: string | null; then?: CartThen; gift?: boolean; operationKey?: string }

function requestHash(input: PaymentInput): string {
  return createHash('sha256').update(JSON.stringify([input.planId ?? null, input.addonId ?? null, input.topupAmount ?? null, input.method, input.promo ?? null, input.then?.planId ?? null, input.then?.addonId ?? null, !!input.gift])).digest('hex');
}

export async function createPayment(user: UserRow, input: PaymentInput): Promise<CreatedPayment> {
  if (input.gift && (!input.planId || input.then)) throw badRequest('Для подарка выберите тариф');
  if (!input.operationKey) return createPaymentOnce(user, input);
  if (input.operationKey.length > 128 || !/^[A-Za-z0-9:_-]{8,128}$/.test(input.operationKey)) throw badRequest('Некорректный идентификатор покупки');
  const lockDb = postgres(config().DATABASE_URL, { max: 1, onnotice: () => {} });
  const conn = await lockDb.reserve();
  const lock = `${user.id}:${input.operationKey}`;
  try {
    await conn`select pg_advisory_lock(hashtextextended(${lock}, 0))`;
    const [p] = await sql()<PaymentRow[]>`select * from payments where user_id = ${user.id} and request_key = ${input.operationKey}`;
    if (p) {
      if (p.request_hash !== requestHash(input)) throw conflict('Этот идентификатор уже использован для другой покупки');
      if (p.status === 'pending' && !p.pay_url) throw conflict('Покупка уже создаётся. Проверьте историю платежей или обратитесь в поддержку.', 'payment_in_progress');
      return { id: p.id, status: p.status, payUrl: p.pay_url };
    }
    return await createPaymentOnce(user, input);
  } finally {
    try { await conn`select pg_advisory_unlock(hashtextextended(${lock}, 0))`; } finally { conn.release(); await lockDb.end(); }
  }
}

async function createPaymentOnce(
  user: UserRow,
  input: PaymentInput,
): Promise<CreatedPayment> {
  if (user.status === 'banned') throw conflict('Аккаунт заблокирован', 'banned');
  await assertNotMaintenance();
  await assertSalesOpen();
  const q = await quote(user.id, input);
  const purpose: PaymentRow['purpose'] = q.plan ? 'plan' : q.addon ? 'addon' : 'topup';
  const title = q.plan ? q.plan.name : q.addon ? q.addon.name : null;
  const snapshot: Record<string, unknown> = q.plan
    ? { plan: { name: q.plan.name, days: q.plan.duration_days, trafficGb: q.plan.traffic_limit_gb, devices: q.plan.device_limit } }
    : q.addon
      ? { addon: { id: q.addon.id, kind: q.addon.kind, name: q.addon.name, qty: q.addon.qty, locationId: q.addon.location_id, days: q.addon.duration_days } }
      : {};
  if (input.gift) snapshot.gift = true;
  if (purpose === 'topup') {
    snapshot.extraBonusPct = await topupBonusPct(user.id); // фиксируем процент акции на момент создания платежа
    const then = await checkThen(user.id, input.then);
    if (then) snapshot.then = then;
  }

  // Бесплатно по промокоду (100% скидка)
  if (q.total === 0 && q.plan) {
    const id = await sql().begin(async (tx) => {
      const [p] = await tx<PaymentRow[]>`
        insert into payments (user_id, provider, purpose, plan_id, plan_name, amount, discount, status, promo_id, payload, request_key, request_hash, paid_at)
        values (${user.id}, 'promo', 'plan', ${q.plan!.id}, ${q.plan!.name}, 0, ${q.discount}, 'succeeded', ${q.promo?.id ?? null}, ${tx.json(snapshot as any)}, ${input.operationKey ?? null}, ${requestHash(input)}, now()) returning *`;
      if (q.promo) await reserveForPayment(tx, q.promo.id, user.id, p!.id);
      return p!.id;
    });
    await fulfillPayment(id, { throwOnError: true });
    return { id, status: 'succeeded', payUrl: null };
  }

  // Оплата с баланса
  if (input.method === 'balance') {
    if (purpose === 'topup') throw badRequest('Нельзя пополнить баланс балансом', 'bad_method');
    const id = await sql().begin(async (tx) => {
      const [u] = await tx<UserRow[]>`select * from users where id = ${user.id} for update`;
      if (u!.balance < q.total) throw conflict('Недостаточно средств на балансе', 'insufficient_balance');
      const [p] = await tx<PaymentRow[]>`
        insert into payments (user_id, provider, purpose, plan_id, plan_name, amount, discount, status, promo_id, payload, request_key, request_hash, paid_at)
        values (${user.id}, 'balance', ${purpose}, ${q.plan?.id ?? null}, ${title}, ${q.total}, ${q.discount}, 'succeeded', ${q.promo?.id ?? null}, ${tx.json(snapshot as any)}, ${input.operationKey ?? null}, ${requestHash(input)}, now()) returning *`;
      if (q.promo) await reserveForPayment(tx, q.promo.id, user.id, p!.id);
      const left = u!.balance - q.total;
      await tx`update users set balance = ${left} where id = ${user.id}`;
      await tx`insert into transactions (user_id, type, amount, balance_after, payment_id, note) values (${user.id}, 'purchase', ${-q.total}, ${left}, ${p!.id}, ${(q.plan ? 'Тариф «' : 'Докупка «') + title + '»'})`;
      await fulfillTx(tx, p!); // откатит и списание, если Remnawave недоступна
      return p!.id;
    });
    await afterFulfilled(id);
    return { id, status: 'succeeded', payUrl: null };
  }

  const [provider, sub] = input.method.split(':');
  const available = await availableMethods();
  const chosen = available.find((m) => m.id === input.method);
  if (!chosen) throw badRequest('Способ оплаты недоступен', 'method_unavailable');

  const p = await sql().begin(async (tx) => {
    const [row] = await tx<PaymentRow[]>`
      insert into payments (user_id, provider, method, purpose, plan_id, plan_name, amount, discount, status, promo_id, payload, request_key, request_hash)
      values (${user.id}, ${provider!}, ${sub ?? null}, ${purpose}, ${q.plan?.id ?? null}, ${title}, ${q.total}, ${q.discount}, 'pending', ${q.promo?.id ?? null}, ${tx.json(snapshot as any)}, ${input.operationKey ?? null}, ${requestHash(input)})
      returning *`;
    // резерв промокода на время оплаты: параллельные платежи не превысят max_uses; снимается при отмене/истечении
    if (q.promo) await reserveForPayment(tx, q.promo.id, user.id, row!.id);
    return row;
  });
  const description = q.plan ? `VPN: ${q.plan.name} (${durationLabel(q.plan.duration_days)})` : q.addon ? `VPN: ${q.addon.name}` : 'Пополнение баланса VPN';
  const returnUrl = `${config().APP_URL}/payment/${p!.id}`;
  try {
    const r =
      provider === 'yookassa'
        ? await yookassa.createPayment({ paymentId: p!.id, amountKop: q.total, description, returnUrl })
        : provider === 'rollypay'
          ? await rollypay.createPayment({ paymentId: p!.id, method: sub as RollypayMethodKey, amountKop: q.total, description, returnUrl, failedUrl: `${returnUrl}?failed=1`, customerId: String(user.tg_id ?? user.id) })
          : await platega.createTransaction({ paymentId: p!.id, method: sub as PlategaMethodKey, amountKop: q.total, description, returnUrl, failedUrl: `${returnUrl}?failed=1` });
    await sql()`update payments set external_id = ${r.externalId}, pay_url = ${r.payUrl} where id = ${p!.id}`;
    return { id: p!.id, status: 'pending', payUrl: r.payUrl };
  } catch (e) {
    await sql()`update payments set status = 'canceled', payload = payload || ${sql().json({ error: ((e as HttpError).detail ?? (e as Error).message).slice(0, 500) })} where id = ${p!.id}`;
    await releasePromoForPayment(p!.id);
    throw e;
  }
}

/** Применение выполнения заказа внутри транзакции (платёж уже succeeded, fulfilled_at ещё null). */
export async function fulfillTx(tx: TxSql, p: PaymentRow): Promise<void> {
  if (p.payload?.gift) {
    await issueGift(tx, p);
  } else if (p.purpose === 'topup') {
    const [u] = await tx`update users set balance = balance + ${p.amount} where id = ${p.user_id} returning balance`;
    await tx`insert into transactions (user_id, type, amount, balance_after, payment_id, note) values (${p.user_id}, 'topup', ${p.amount}, ${u!.balance}, ${p.id}, ${'Пополнение через ' + p.provider})`;
    const bonus = await topupBonus(p.amount, Number((p.payload as Record<string, unknown> | null)?.extraBonusPct ?? 0));
    if (bonus > 0) {
      const [u2] = await tx`update users set balance = balance + ${bonus} where id = ${p.user_id} returning balance`;
      await tx`insert into transactions (user_id, type, amount, balance_after, payment_id, note) values (${p.user_id}, 'bonus', ${bonus}, ${u2!.balance}, ${p.id}, 'Бонус за пополнение')`;
    }
  } else if (p.purpose === 'addon') {
    const snap = (p.payload?.addon ?? null) as { kind: AddonRow['kind']; qty: number; locationId?: string | null; days?: number | null } | null;
    if (!snap) throw new Error('В платеже нет данных докупки');
    await applyAddon(tx, p.user_id, snap, p.id);
  } else {
    const snap = (p.payload?.plan ?? {}) as { name?: string; days?: number; trafficGb?: number; devices?: number };
    if (!snap.days) throw new Error('В платеже нет данных тарифа');
    await grantAccess(tx, p.user_id, {
      days: snap.days,
      trafficLimitBytes: (snap.trafficGb ?? 0) * GB,
      deviceLimit: snap.devices ?? 3,
      planId: p.plan_id,
      planName: snap.name ?? p.plan_name,
      isTrial: false,
    });
  }
  if (p.promo_id) await markUsed(tx, p.promo_id, p.user_id, p.id);
  await tx`update payments set fulfilled_at = now(), fulfill_error = null where id = ${p.id}`;
}

/** Выполнить оплаченный заказ. Идемпотентно и безопасно при гонках (for update skip locked). */
export async function fulfillPayment(paymentId: string, opts: { throwOnError?: boolean } = {}): Promise<'fulfilled' | 'skipped' | 'failed'> {
  let result: 'fulfilled' | 'skipped' = 'skipped';
  try {
    result = await sql().begin(async (tx) => {
      const [p] = await tx<PaymentRow[]>`select * from payments where id = ${paymentId} and status = 'succeeded' and fulfilled_at is null and fulfill_failed_at is null for update skip locked`;
      if (!p) return 'skipped' as const;
      await fulfillTx(tx, p);
      return 'fulfilled' as const;
    });
  } catch (e) {
    const msg = ((e as HttpError).detail ?? (e as Error).message).slice(0, 500);
    await sql()`update payments set fulfill_error = ${msg} where id = ${paymentId}`;
    // 4xx (нет подписки, бан, товар удалён…) повторять бессмысленно: возвращаем деньги на баланс
    if (isPermanentError(e)) await failPermanently(paymentId, e).catch((err) => log.error('failPermanently failed', { paymentId, err: (err as Error).message }));
    if (opts.throwOnError) throw e;
    return 'failed';
  }
  if (result === 'fulfilled') await afterFulfilled(paymentId);
  return result;
}

/** Постоянный сбой выдачи: сумма платежа → на баланс пользователя, платёж помечается как не подлежащий повтору, пользователь уведомляется. */
async function failPermanently(paymentId: string, e: HttpError): Promise<void> {
  const done = await sql().begin(async (tx) => {
    const [p] = await tx<PaymentRow[]>`select * from payments where id = ${paymentId} and status = 'succeeded' and fulfilled_at is null and fulfill_failed_at is null for update skip locked`;
    if (!p) return null;
    let credited = false;
    if (p.amount > 0) {
      const [u] = await tx`update users set balance = balance + ${p.amount} where id = ${p.user_id} returning balance`;
      await tx`insert into transactions (user_id, type, amount, balance_after, payment_id, note) values (${p.user_id}, 'refund', ${p.amount}, ${u!.balance}, ${p.id}, ${'Возврат на баланс: не удалось выдать «' + (p.plan_name ?? 'покупку') + '» (' + e.message.slice(0, 120) + ')'})`;
      credited = true;
    }
    await tx`update payments set fulfill_failed_at = now(), refunded_to_balance = ${credited}, fulfill_error = ${e.message.slice(0, 500)} where id = ${p.id}`;
    await releasePromoForPayment(p.id, tx);
    return { p, credited };
  });
  if (!done) return;
  const { p, credited } = done;
  log.warn('payment fulfilment failed permanently', { paymentId, reason: e.message, credited });
  void alertAdmins(`⚠️ <b>Оплаченный заказ не выдан</b>\nПлатёж <code>${p.id}</code>, ${escapeHtml(p.plan_name ?? p.purpose)}, ${formatRub(p.amount)}\nПричина: ${escapeHtml(e.message)}\n${credited ? 'Сумма возвращена на баланс пользователя.' : ''}`);
  await notifyUser(
    p.user_id,
    `⚠️ <b>Не удалось выдать покупку</b>${p.plan_name ? ` «${escapeHtml(p.plan_name)}»` : ''}\n${escapeHtml(e.message)}.\n${credited ? `Оплаченная сумма <b>${formatRub(p.amount)}</b> зачислена на ваш баланс — ею можно оплатить покупку заново.` : ''}`,
    [openAppButton()],
  ).catch(() => {});
}

const MSK_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' };

async function afterFulfilled(paymentId: string): Promise<void> {
  const [p] = await sql()<PaymentRow[]>`select * from payments where id = ${paymentId}`;
  if (!p) return;
  dispatchPaymentNotice(paymentId);
  try {
    if (p.payload?.gift) {
      await notifyUser(p.user_id, '🎁 <b>Подарок готов</b>\nКод активации доступен в разделе «Подарки». Перешлите его получателю.', [[{ text: '🎁 Мои подарки', web_app: { url: config().APP_URL + '/gifts' } }]]);
    } else if (p.purpose === 'plan') {
      const [s] = await sql()`select expires_at from subscriptions where user_id = ${p.user_id}`;
      const until = s ? new Date(s.expires_at).toLocaleDateString('ru-RU', MSK_DATE) : '';
      await notifyUser(p.user_id, `✅ <b>Оплата прошла</b>\nТариф «${escapeHtml(p.plan_name ?? '')}» активен${until ? ` до <b>${until}</b>` : ''}.`, [openAppButton('🔑 Подключиться')]);
      await rewardReferrer(p.id);
    } else if (p.purpose === 'addon') {
      await notifyUser(p.user_id, `✅ <b>Докупка применена</b>\n${escapeHtml(p.plan_name ?? '')}`, [openAppButton()]);
    } else {
      const bonus = await sql()`select amount from transactions where payment_id = ${p.id} and type = 'bonus'`;
      await notifyUser(p.user_id, `✅ <b>Баланс пополнен</b> на ${formatRub(p.amount)}${bonus[0] ? ` (+${formatRub(Number(bonus[0].amount))} бонус)` : ''}.`, [openAppButton()]);
      const then = (p.payload?.then ?? null) as CartThen | null;
      if (then) {
        try {
          const [u] = await sql()<UserRow[]>`select * from users where id = ${p.user_id}`;
          await createPayment(u!, { ...then, method: 'balance' });
        } catch (e) {
          // 4xx — наши понятные русские сообщения; всё остальное пользователю не показываем
          const reason = e instanceof HttpError && e.status < 500 ? `: ${escapeHtml(e.message)}` : '';
          log.warn('autopurchase failed', { paymentId, err: (e as Error).message, detail: (e as HttpError).detail });
          await notifyUser(p.user_id, `⚠️ Баланс пополнен, но автопокупка не удалась${reason}\nОформите покупку вручную.`, [openAppButton()]);
        }
      }
    }
  } catch {
    /* уведомления не должны ломать платёж */
  }
}

/** Идемпотентная смена статуса платежа от провайдера (webhook или опрос). */
export async function applyProviderStatus(paymentId: string, status: 'succeeded' | 'canceled' | 'refunded' | 'pending'): Promise<void> {
  if (status === 'pending') return;
  if (status === 'succeeded') {
    await sql()`update payments set status = 'succeeded', paid_at = now() where id = ${paymentId} and status in ('pending','canceled','expired')`;
    try { await fulfillPayment(paymentId); } finally { dispatchPaymentNotice(paymentId); }
    return;
  }
  if (status === 'canceled') {
    const r = await sql()`update payments set status = 'canceled' where id = ${paymentId} and status = 'pending' returning id`;
    if (r.length) await releasePromoForPayment(paymentId);
    return;
  }
  await refundPayment(paymentId);
}

/**
 * Возврат платежа у провайдера (YooKassa refund.succeeded / Platega CHARGEBACKED).
 * Пополнение: списываем зачисленное (с бонусом) с баланса, но не ниже 0. Тариф/докупка: доступ автоматически не отзываем — алерт админам.
 */
export async function refundPayment(paymentId: string): Promise<void> {
  const res = await sql().begin(async (tx) => {
    const [p] = await tx<PaymentRow[]>`update payments set status = 'refunded', refunded_at = now() where id = ${paymentId} and status = 'succeeded' returning *`;
    if (!p) return null;
    await tx`update gifts set revoked_at = now() where payment_id = ${p.id}`;
    let debited = 0;
    let credited = 0;
    if (p.purpose === 'topup' && p.fulfilled_at && !p.refunded_to_balance) {
      const [b] = await tx`select coalesce(sum(amount),0)::bigint as n from transactions where payment_id = ${p.id} and type in ('topup','bonus')`;
      credited = Number(b!.n);
      const [u] = await tx`select balance from users where id = ${p.user_id} for update`;
      debited = Math.min(credited, Math.max(0, Number(u!.balance)));
      if (debited > 0) {
        const left = Number(u!.balance) - debited;
        await tx`update users set balance = ${left} where id = ${p.user_id}`;
        await tx`insert into transactions (user_id, type, amount, balance_after, payment_id, note) values (${p.user_id}, 'refund', ${-debited}, ${left}, ${p.id}, 'Возврат платежа: списание пополнения')`;
      }
    }
    await releasePromoForPayment(p.id, tx);
    const [gift] = await tx`select redeemed_by, redeemed_at from gifts where payment_id = ${p.id}`;
    const [usr] = await tx`select tg_id, username from users where id = ${p.user_id}`;
    return { p, debited, credited, usr, gift };
  });
  if (!res) return;
  const { p, debited, credited, usr, gift } = res;
  const who = `${usr?.username ? '@' + escapeHtml(usr.username) : 'без username'}${usr?.tg_id ? ` (tg ${usr.tg_id})` : ''}, user <code>${p.user_id}</code>`;
  log.warn('payment refunded', { paymentId, purpose: p.purpose, debited });
  if (p.purpose === 'topup') {
    const short = credited - debited;
    await alertAdmins(`↩️ <b>Возврат платежа за пополнение</b>\nПлатёж <code>${p.id}</code> (${p.provider}), ${formatRub(p.amount)}\nПользователь: ${who}\nСписано с баланса: ${formatRub(debited)}${short > 0 ? `\n⚠️ Не хватило на балансе: ${formatRub(short)} (деньги уже потрачены)` : ''}`);
    await notifyUser(p.user_id, `↩️ Платёж на ${formatRub(p.amount)} возвращён, с баланса списано ${formatRub(debited)}.`, [openAppButton()]).catch(() => {});
  } else {
    const giftNotice = p.payload?.gift ? `\n🎁 Подарок отозван.${gift?.redeemed_at ? ` Получатель: <code>${gift.redeemed_by}</code>. Доступ получателя требует ручного решения.` : ' Код больше не действует.'}` : '';
    await alertAdmins(`↩️ <b>Возврат платежа за ${p.purpose === 'plan' ? 'тариф' : 'докупку'}</b>\nПлатёж <code>${p.id}</code> (${p.provider}), «${escapeHtml(p.plan_name ?? '')}», ${formatRub(p.amount)}\nПользователь: ${who}\nДоступ автоматически НЕ отозван — при необходимости заблокируйте пользователя или сократите срок в панели Remnawave.${giftNotice}`);
  }
}

export async function findByExternal(provider: string, externalId: string): Promise<PaymentRow | null> {
  const [p] = await sql()<PaymentRow[]>`select * from payments where provider = ${provider} and external_id = ${externalId}`;
  return p ?? null;
}

/** Сверка статуса с провайдером — для воркера и ручной проверки */
export async function syncWithProvider(p: PaymentRow): Promise<void> {
  if (!p.external_id) return;
  if (p.provider === 'yookassa') {
    const r = await yookassa.getPayment(p.external_id);
    await applyProviderStatus(p.id, r.status === 'succeeded' ? 'succeeded' : r.status === 'canceled' ? 'canceled' : 'pending');
  } else if (p.provider === 'platega') {
    const r = await platega.getTransaction(p.external_id);
    await applyProviderStatus(p.id, mapPlategaStatus(r.status));
  } else if (p.provider === 'rollypay') {
    const r = await rollypay.getPayment(p.external_id);
    await applyProviderStatus(p.id, mapRollypayStatus(r.status));
  }
}
