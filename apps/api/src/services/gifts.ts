import { createHash, randomBytes } from 'node:crypto';
import { sql, type TxSql } from '../db/index.js';
import type { PaymentRow, SubscriptionRow, UserRow } from '../db/types.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { assertNotMaintenance, grantAccess } from './subscriptions.js';

interface GiftRow {
  id: string; payment_id: string; buyer_id: string; code_hash: string; code_encrypted: string;
  plan: { name: string; days: number; trafficGb: number; devices: number };
  recipient_name: string; sender_name: string; message: string; theme: 'orbit' | 'aurora' | 'pearl'; version: number;
  redeemed_by: string | null; redeemed_at: Date | null; revoked_at: Date | null; created_at: Date;
  redeemed_expires_at: Date | null; redeemed_plan_name: string | null; redeemed_keeps_current_plan: boolean;
}
export interface GiftCardInput { recipientName?: string; senderName?: string; message?: string; theme?: GiftRow['theme']; expectedVersion: number }
const normalize = (code: string) => code.trim().toUpperCase();
const digest = (code: string) => createHash('sha256').update(normalize(code)).digest('hex');
const newCode = () => 'VAYLO-' + randomBytes(12).toString('hex').toUpperCase();
const state = (g: Pick<GiftRow, 'revoked_at' | 'redeemed_at'>) => g.revoked_at ? 'revoked' as const : g.redeemed_at ? 'redeemed' as const : 'ready' as const;
const card = (g: GiftRow) => ({ recipientName: g.recipient_name, senderName: g.sender_name, message: g.message, theme: g.theme });
const details = (g: GiftRow) => ({ id: g.id, planName: g.plan.name, days: g.plan.days, trafficLimitGb: g.plan.trafficGb, deviceLimit: g.plan.devices, ...card(g) });
const senderDTO = (g: GiftRow) => ({ ...details(g), code: state(g) === 'ready' ? decrypt(g.code_encrypted) : null, state: state(g), createdAt: g.created_at.toISOString(), redeemedAt: g.redeemed_at?.toISOString() ?? null, version: g.version });

function validateCode(code: string) {
  if (!/^VAYLO-[A-F0-9]{24}$/.test(normalize(code))) throw badRequest('Проверьте код подарка');
}
function requireReady(g: GiftRow) {
  if (g.revoked_at) throw conflict('Подарок отозван');
  if (g.redeemed_at) throw conflict('Этот подарок уже активирован');
}
function requireVersion(g: GiftRow, expectedVersion: number) {
  if (g.version !== expectedVersion) throw conflict('Подарок уже изменён. Обновите список и попробуйте снова.', 'gift_changed');
}

/** The gift and payment fulfillment are committed together. */
export async function issueGift(tx: TxSql, payment: PaymentRow): Promise<void> {
  const code = newCode();
  const plan = payment.payload.plan;
  if (!plan?.days) throw badRequest('В подарке нет данных тарифа');
  await tx`insert into gifts (payment_id, buyer_id, code_hash, code_encrypted, plan)
    values (${payment.id}, ${payment.user_id}, ${digest(code)}, ${encrypt(code)}, ${tx.json(plan)})
    on conflict (payment_id) do nothing`;
}

export async function listGifts(user: UserRow) {
  // No arbitrary 100-row cutoff: older paid unused codes must remain accessible.
  const rows = await sql()<GiftRow[]>`select * from gifts where buyer_id = ${user.id} order by created_at desc, id`;
  return rows.map(senderDTO);
}

export async function receivedGifts(user: UserRow) {
  const rows = await sql()<GiftRow[]>`select * from gifts where redeemed_by = ${user.id} order by redeemed_at desc, id`;
  return rows.map(g => ({ ...details(g), redeemedAt: g.redeemed_at!.toISOString(), state: state(g), expiresAt: g.redeemed_expires_at?.toISOString() ?? null, keepsCurrentPlan: g.redeemed_keeps_current_plan }));
}

export async function updateGiftCard(user: UserRow, id: string, input: GiftCardInput) {
  return sql().begin(async tx => {
    const [g] = await tx<GiftRow[]>`select * from gifts where id = ${id} and buyer_id = ${user.id} for update`;
    if (!g) throw notFound('Подарок не найден');
    requireReady(g); requireVersion(g, input.expectedVersion);
    const [updated] = await tx<GiftRow[]>`update gifts set recipient_name = ${input.recipientName ?? g.recipient_name}, sender_name = ${input.senderName ?? g.sender_name}, message = ${input.message ?? g.message}, theme = ${input.theme ?? g.theme}, version = version + 1 where id = ${id} returning *`;
    return senderDTO(updated!);
  });
}

export async function rotateGift(user: UserRow, id: string, expectedVersion: number) {
  return sql().begin(async tx => {
    const [g] = await tx<GiftRow[]>`select * from gifts where id = ${id} and buyer_id = ${user.id} for update`;
    if (!g) throw notFound('Подарок не найден');
    requireReady(g); requireVersion(g, expectedVersion);
    const code = newCode();
    const [updated] = await tx<GiftRow[]>`update gifts set code_hash = ${digest(code)}, code_encrypted = ${encrypt(code)}, version = version + 1 where id = ${id} returning *`;
    return senderDTO(updated!);
  });
}

export async function previewGift(user: UserRow, code: string) {
  validateCode(code);
  const [g] = await sql()<GiftRow[]>`select * from gifts where code_hash = ${digest(code)}`;
  if (!g || g.revoked_at) throw badRequest('Подарок не найден или отозван');
  if (g.redeemed_at && g.redeemed_by !== user.id) throw conflict('Этот подарок уже активирован');
  const [sub] = await sql()<SubscriptionRow[]>`select * from subscriptions where user_id = ${user.id}`;
  const active = !!sub && sub.expires_at.getTime() > Date.now();
  const keepsCurrentPlan = active && !sub.is_trial;
  return { ...details(g), activeSubscription: active, keepsCurrentPlan, currentPlanName: active ? sub!.plan_name : null, currentExpiresAt: active ? sub!.expires_at.toISOString() : null,
    resultExpiresAt: g.redeemed_at ? g.redeemed_expires_at?.toISOString() ?? sub?.expires_at.toISOString() ?? null : new Date((active ? sub!.expires_at.getTime() : Date.now()) + g.plan.days * 86400_000).toISOString(),
    alreadyRedeemed: !!g.redeemed_at };
}

export async function redeemGift(user: UserRow, code: string) {
  validateCode(code);
  return sql().begin(async tx => {
    const [g] = await tx<GiftRow[]>`select * from gifts where code_hash = ${digest(code)} for update`;
    if (!g || g.revoked_at) throw badRequest('Подарок не найден или отозван');
    if (g.redeemed_at) {
      if (g.redeemed_by !== user.id) throw conflict('Этот подарок уже активирован');
      // A lost success response must not add days again or report a false error.
      const [sub] = await tx<SubscriptionRow[]>`select * from subscriptions where user_id = ${user.id}`;
      return { ok: true, planName: g.redeemed_plan_name ?? g.plan.name, expiresAt: g.redeemed_expires_at?.toISOString() ?? sub?.expires_at.toISOString() ?? null, keepsCurrentPlan: g.redeemed_keeps_current_plan };
    }
    await assertNotMaintenance();
    // Same ordering as grantAccess: inspect the current subscription under the user's lock.
    await tx`select id from users where id = ${user.id} for update`;
    const [sub] = await tx<SubscriptionRow[]>`select * from subscriptions where user_id = ${user.id}`;
    const keepsCurrentPlan = !!sub && !sub.is_trial && sub.expires_at.getTime() > Date.now();
    const [payment] = await tx<PaymentRow[]>`select * from payments where id = ${g.payment_id}`;
    const result = await grantAccess(tx, user.id, keepsCurrentPlan
      ? { days: g.plan.days, isTrial: false }
      : { days: g.plan.days, trafficLimitBytes: g.plan.trafficGb * 1024 ** 3, deviceLimit: g.plan.devices, planName: g.plan.name, planId: payment?.plan_id ?? null, isTrial: false });
    if (!keepsCurrentPlan) await tx`update subscriptions set plan_id = ${payment?.plan_id ?? null} where user_id = ${user.id}`;
    const planName = keepsCurrentPlan ? sub!.plan_name ?? g.plan.name : g.plan.name;
    await tx`update gifts set redeemed_by = ${user.id}, redeemed_at = now(), redeemed_expires_at = ${result.expiresAt}, redeemed_plan_name = ${planName}, redeemed_keeps_current_plan = ${keepsCurrentPlan}, version = version + 1 where id = ${g.id}`;
    return { ok: true, planName, expiresAt: result.expiresAt.toISOString(), keepsCurrentPlan };
  });
}

export async function adminGifts(input: { state: 'all' | 'ready' | 'redeemed' | 'revoked'; q: string; page: number }) {
  const db = sql(); const query = '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%';
  const filter = db`((${input.state} = 'all') or (${input.state} = 'ready' and g.redeemed_at is null and g.revoked_at is null) or (${input.state} = 'redeemed' and g.redeemed_at is not null and g.revoked_at is null) or (${input.state} = 'revoked' and g.revoked_at is not null))
    and (${input.q} = '' or b.first_name ilike ${query} or b.username ilike ${query} or b.tg_id::text ilike ${query} or r.first_name ilike ${query} or r.username ilike ${query} or r.tg_id::text ilike ${query} or g.payment_id::text ilike ${query} or g.id::text ilike ${query})`;
  const [count] = await db`select count(*)::int as total from gifts g join users b on b.id = g.buyer_id left join users r on r.id = g.redeemed_by where ${filter}`;
  const rows = await db`select g.id, g.payment_id, g.plan, g.created_at, g.redeemed_at, g.revoked_at,
    b.id as buyer_id, b.first_name as buyer_name, b.tg_id as buyer_tg,
    r.id as recipient_id, r.first_name as recipient_name, r.tg_id as recipient_tg
    from gifts g join users b on b.id = g.buyer_id left join users r on r.id = g.redeemed_by
    where ${filter} order by g.created_at desc, g.id limit 25 offset ${(input.page - 1) * 25}`;
  return { items: rows.map(g => ({ id: g.id, paymentId: g.payment_id, planName: g.plan.name, days: g.plan.days, state: state(g as GiftRow), createdAt: g.created_at.toISOString(), redeemedAt: g.redeemed_at?.toISOString() ?? null,
    buyer: { id: g.buyer_id, name: g.buyer_name, tgId: g.buyer_tg }, recipient: g.recipient_id ? { id: g.recipient_id, name: g.recipient_name, tgId: g.recipient_tg } : null })), total: count!.total, page: input.page, pageSize: 25 };
}

export async function revokeGift(id: string) {
  return sql().begin(async tx => {
    const [g] = await tx<GiftRow[]>`select * from gifts where id = ${id} for update`;
    if (!g) throw notFound('Подарок не найден');
    requireReady(g);
    await tx`update gifts set revoked_at = now(), version = version + 1 where id = ${id}`;
    return { ok: true };
  });
}
