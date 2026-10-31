import { sql, type Sql, type TxSql } from '../db/index.js';
import type { PromoRow } from '../db/types.js';
import { badRequest, conflict } from '../lib/errors.js';
import { rwErrorToHttp } from './remnawave.js';
import { grantAccess } from './subscriptions.js';

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function findPromo(code: string, userId?: string): Promise<PromoRow> {
  const [p] = await sql()<PromoRow[]>`select * from promo_codes where code = ${normalizeCode(code)}`;
  if (!p || !p.is_active) throw badRequest('Промокод не найден', 'promo_not_found');
  if (p.expires_at && p.expires_at.getTime() < Date.now()) throw badRequest('Срок действия промокода истёк', 'promo_expired');
  if (p.max_uses !== null && p.used >= p.max_uses) throw badRequest('Промокод больше не действует', 'promo_exhausted');
  if (userId) await assertNotUsed(p.id, userId);
  return p;
}

/** Код уже использован пользователем. Резерв под ещё неоплаченный платёж (pending) использованием не считается. */
export async function assertNotUsed(promoId: string, userId: string): Promise<void> {
  const [u] = await sql()`
    select 1 from promo_uses pu left join payments p on p.id = pu.payment_id
    where pu.promo_id = ${promoId} and pu.user_id = ${userId} and (p.id is null or p.status <> 'pending')`;
  if (u) throw conflict('Вы уже использовали этот промокод', 'promo_used');
}

/** Скидка (копейки) для промокодов типов percent/fixed. Для остальных — 0. */
export function discountFor(promo: PromoRow, amount: number): number {
  if (promo.type === 'percent') return Math.min(amount, Math.floor((amount * Math.min(promo.value, 100)) / 100));
  if (promo.type === 'fixed') return Math.min(amount, promo.value);
  return 0;
}

export function isDiscount(promo: PromoRow): boolean {
  return promo.type === 'percent' || promo.type === 'fixed';
}

/**
 * Погашение подарочного промокода (дни или баланс). Всё в одной транзакции:
 * сначала атомарно занимаем использование (per-user уникальность + лимит max_uses), потом начисляем.
 * Параллельные запросы не могут ни списать код дважды, ни превысить max_uses.
 */
export async function redeemGift(userId: string, code: string): Promise<{ type: 'days' | 'balance'; value: number }> {
  const promo = await findPromo(code);
  if (isDiscount(promo)) throw badRequest('Этот промокод применяется при оплате тарифа', 'promo_discount_only');
  return sql()
    .begin(async (tx) => {
      await claimUse(tx, promo.id, userId, null);
      if (promo.type === 'days') {
        await grantAccess(tx, userId, { days: promo.value });
        return { type: 'days' as const, value: promo.value };
      }
      const [u] = await tx`update users set balance = balance + ${promo.value} where id = ${userId} returning balance`;
      await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${userId}, 'promo', ${promo.value}, ${u!.balance}, ${'Промокод ' + promo.code})`;
      return { type: 'balance' as const, value: promo.value };
    })
    .catch(rwErrorToHttp);
}

/**
 * Атомарно занимает одно использование кода: (promo, user) уникально + used < max_uses.
 * Бросает 409, если код уже использован этим пользователем или исчерпан.
 */
export async function claimUse(tx: TxSql, promoId: string, userId: string, paymentId: string | null): Promise<void> {
  const ins = await tx`insert into promo_uses (promo_id, user_id, payment_id) values (${promoId}, ${userId}, ${paymentId}) on conflict do nothing returning 1`;
  if (!ins.length) throw conflict('Вы уже использовали этот промокод', 'promo_used');
  const upd = await tx`update promo_codes set used = used + 1 where id = ${promoId} and is_active and (max_uses is null or used < max_uses) returning 1`;
  if (!upd.length) throw badRequest('Промокод больше не действует', 'promo_exhausted');
}

/** Резерв под платёж при его создании: освобождаем прежние резервы этого пользователя под неоплаченные платежи с тем же кодом. */
export async function reserveForPayment(tx: TxSql, promoId: string, userId: string, paymentId: string): Promise<void> {
  const old = await tx`
    delete from promo_uses pu using payments p
    where pu.promo_id = ${promoId} and pu.user_id = ${userId} and p.id = pu.payment_id and p.status = 'pending' returning 1`;
  if (old.length) await tx`update promo_codes set used = greatest(0, used - ${old.length}) where id = ${promoId}`;
  await claimUse(tx, promoId, userId, paymentId);
}

/** Освобождает резерв, если платёж отменён/истёк/не создался. Идемпотентно. */
export async function releasePromoForPayment(paymentId: string, db: Sql | TxSql = sql()): Promise<void> {
  const r = await db`delete from promo_uses where payment_id = ${paymentId} returning promo_id`;
  for (const row of r) await db`update promo_codes set used = greatest(0, used - 1) where id = ${row.promo_id}`;
}

/** При выполнении платежа: резерв уже есть (создан при оформлении). Для старых платежей без резерва — занимаем мягко. */
export async function markUsed(tx: TxSql, promoId: string, userId: string, paymentId: string | null): Promise<void> {
  if (paymentId) {
    const [own] = await tx`select 1 from promo_uses where payment_id = ${paymentId}`;
    if (own) return;
  }
  const r = await tx`insert into promo_uses (promo_id, user_id, payment_id) values (${promoId}, ${userId}, ${paymentId}) on conflict do nothing returning 1`;
  // пользователь заплатил со скидкой — выполняем в любом случае, лимит здесь только учитываем
  if (r.length) await tx`update promo_codes set used = used + 1 where id = ${promoId}`;
}
