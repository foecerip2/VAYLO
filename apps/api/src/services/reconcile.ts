import { sql } from '../db/index.js';
import type { PaymentRow } from '../db/types.js';
import { applyProviderStatus } from './payments.js';
import { mapRollypayStatus, rollypay } from './rollypay.js';
import { getSettings } from './settings.js';
import { yookassa } from './yookassa.js';

export interface ReconcileItem { externalId: string; orderId: string | null; amount: number; currency: string; at?: string }
export interface ReconcileResult {
  provider: 'yookassa' | 'rollypay';
  /** сколько успешных платежей и на какую сумму видит сам провайдер (в его валюте) */
  providerCount: number;
  providerTotal: number;
  providerCurrency: string;
  /** то же по нашей базе за тот же период (копейки) */
  localCount: number;
  localTotalKop: number;
  /** оплачены у провайдера, но у нас были не «оплачен» — исправлено сейчас */
  fixed: number;
  /** есть у провайдера, но не найдены у нас (не наш платёж или другой магазин) */
  unmatched: ReconcileItem[];
  /** у нас «оплачен», а у провайдера нет (ручное подтверждение/тест) */
  localOnly: { id: string; amountKop: number }[];
  error?: string;
}

interface Seen { externalId: string; orderId: string | null; amount: number; currency: string; test?: boolean }

async function match(provider: string, s: Seen): Promise<PaymentRow | null> {
  const [byExt] = await sql()<PaymentRow[]>`select * from payments where provider = ${provider} and external_id = ${s.externalId}`;
  if (byExt) return byExt;
  if (s.orderId && /^[0-9a-f-]{36}$/i.test(s.orderId)) {
    const [byId] = await sql()<PaymentRow[]>`select * from payments where id = ${s.orderId} and provider = ${provider}`;
    if (byId) {
      if (!byId.external_id) await sql()`update payments set external_id = ${s.externalId} where id = ${byId.id} and external_id is null`;
      return byId;
    }
  }
  return null;
}

async function run(provider: 'yookassa' | 'rollypay', since: Date): Promise<ReconcileResult> {
  const res: ReconcileResult = { provider, providerCount: 0, providerTotal: 0, providerCurrency: 'RUB', localCount: 0, localTotalKop: 0, fixed: 0, unmatched: [], localOnly: [] };
  let seen: Seen[];
  if (provider === 'yookassa') {
    const list = await yookassa.listSucceeded(since.toISOString());
    seen = list.map((p) => ({ externalId: p.id, orderId: p.metadata?.payment_id ?? null, amount: Number(p.amount?.value ?? 0), currency: p.amount?.currency ?? 'RUB' }));
  } else {
    const list = await rollypay.listPayments(since.toISOString());
    const testMode = (await getSettings('rollypay')).test_mode;
    seen = list.filter((p) => mapRollypayStatus(p.status) === 'succeeded' && (testMode || !p.test)).map((p) => ({ externalId: p.paymentId, orderId: p.orderId ?? null, amount: p.amount, currency: p.currency }));
  }
  const matchedIds = new Set<string>();
  for (const s of seen) {
    res.providerCount++;
    res.providerTotal += s.amount;
    res.providerCurrency = s.currency || res.providerCurrency;
    const p = await match(provider, s);
    if (!p) { res.unmatched.push({ externalId: s.externalId, orderId: s.orderId, amount: s.amount, currency: s.currency }); continue; }
    matchedIds.add(p.id);
    if (p.status !== 'succeeded' && p.status !== 'refunded') { await applyProviderStatus(p.id, 'succeeded'); res.fixed++; }
  }
  const local = await sql()<{ id: string; amount: string }[]>`
    select id, amount from payments where provider = ${provider} and status = 'succeeded' and paid_at >= ${since}`;
  res.localCount = local.length;
  res.localTotalKop = local.reduce((a, r) => a + Number(r.amount), 0);
  res.localOnly = local.filter((r) => !matchedIds.has(r.id)).map((r) => ({ id: r.id, amountKop: Number(r.amount) }));
  return res;
}

/** Сверка выручки с самими платёжными системами: подтягивает оплаченные, но не отмеченные платежи и показывает расхождения */
export async function reconcile(days = 30): Promise<ReconcileResult[]> {
  const since = new Date(Date.now() - Math.min(90, Math.max(1, days)) * 86_400_000);
  const out: ReconcileResult[] = [];
  const yk = await getSettings('yookassa');
  if (yk.shop_id && yk.secret_key) out.push(await run('yookassa', since).catch((e) => ({ provider: 'yookassa' as const, providerCount: 0, providerTotal: 0, providerCurrency: 'RUB', localCount: 0, localTotalKop: 0, fixed: 0, unmatched: [], localOnly: [], error: (e as any).detail ?? (e as Error).message })));
  const rp = await getSettings('rollypay');
  if (rp.api_key) out.push(await run('rollypay', since).catch((e) => ({ provider: 'rollypay' as const, providerCount: 0, providerTotal: 0, providerCurrency: 'RUB', localCount: 0, localTotalKop: 0, fixed: 0, unmatched: [], localOnly: [], error: (e as any).detail ?? (e as Error).message })));
  return out;
}
