import { formatRub, pluralDays, type ActiveCampaignDTO } from '@vpn/shared';
import { sql } from '../db/index.js';
import { badRequest, conflict, escapeHtml, notFound } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { SEGMENTS, autoDays, segmentWhere, type Segment } from './broadcast.js';
import { getSettings } from './settings.js';
import { notifyUser, openAppButton } from './notify.js';
import { rwErrorToHttp } from './remnawave.js';
import { grantAccess } from './subscriptions.js';

export const CAMPAIGN_KINDS = ['days', 'balance', 'plan_discount', 'topup_bonus'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];
export interface CampaignRow {
  id: string; title: string; kind: CampaignKind; value: number; audience: string; plan_ids: string[] | null; message: string; notify: boolean;
  is_active: boolean; starts_at: Date; ends_at: Date | null; status: 'draft' | 'running' | 'done'; total: number; granted: number; failed: number;
  started_at: Date | null; finished_at: Date | null; created_by: string | null; created_at: Date;
}
export const isGrantKind = (k: CampaignKind) => k === 'days' || k === 'balance';
export const validAudience = (a: string): a is Segment => a in SEGMENTS;

const where = (audience: string) => segmentWhere(validAudience(audience) ? audience : 'all');

/** Сколько человек получит компенсацию (активные, не заблокированные) */
export async function countAudience(audience: string): Promise<number> {
  const [r] = await sql()`select count(*)::int as n from users u where u.status = 'active' and ${where(audience)}`;
  return r!.n;
}

function defaultMessage(c: CampaignRow): string {
  const what = c.kind === 'days' ? `+${c.value} ${pluralDays(c.value)} к подписке` : `${formatRub(c.value)} на баланс`;
  return `🎁 <b>Подарок от VAYLO</b>\n\nМы начислили вам ${what}${c.title ? ` — ${escapeHtml(c.title)}` : ''}. Спасибо, что вы с нами! 💜`;
}

/** Выдача компенсации. Идемпотентна: уникальность (campaign_id, user_id) — повторный запуск дойдёт только до не получивших. */
export async function runGrant(campaignId: string): Promise<void> {
  const [c] = await sql()<CampaignRow[]>`select * from campaigns where id = ${campaignId}`;
  if (!c || !isGrantKind(c.kind)) return;
  const users = await sql()<{ id: string }[]>`
    select u.id from users u where u.status = 'active' and ${where(c.audience)}
      and not exists (select 1 from campaign_grants g where g.campaign_id = ${c.id} and g.user_id = u.id)`;
  for (const u of users) {
    try {
      const ok = await sql().begin(async (tx) => {
        const ins = await tx`insert into campaign_grants (campaign_id, user_id) values (${c.id}, ${u.id}) on conflict do nothing returning 1`;
        if (!ins.length) return false;
        if (c.kind === 'days') await grantAccess(tx, u.id, { days: c.value });
        else {
          const [b] = await tx`update users set balance = balance + ${c.value} where id = ${u.id} returning balance`;
          await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${u.id}, 'campaign', ${c.value}, ${b!.balance}, ${'Акция: ' + c.title})`;
        }
        return true;
      }).catch(rwErrorToHttp);
      if (ok) {
        await sql()`update campaigns set granted = granted + 1 where id = ${c.id}`;
        if (c.notify) { void notifyUser(u.id, c.message.trim() || defaultMessage(c), [openAppButton()]).catch(() => {}); await new Promise((r) => setTimeout(r, 45)); }
      }
    } catch (e) {
      await sql()`update campaigns set failed = failed + 1 where id = ${c.id}`;
      log.warn('campaign grant failed', { err: (e as Error).message, campaign: c.id, user: u.id });
    }
  }
  await sql()`update campaigns set status = 'done', finished_at = now() where id = ${c.id}`;
}

export async function startGrant(id: string): Promise<CampaignRow> {
  const [c] = await sql()<CampaignRow[]>`select * from campaigns where id = ${id}`;
  if (!c) throw notFound('Акция не найдена');
  if (!isGrantKind(c.kind)) throw badRequest('Эта акция применяется автоматически при оплате, выдавать её не нужно');
  if (c.status === 'running' && c.started_at && Date.now() - c.started_at.getTime() < 15 * 60_000) throw conflict('Выдача уже идёт');
  if (c.status === 'done') throw conflict('Компенсация уже выдана');
  const total = await countAudience(c.audience);
  const [u] = await sql()<CampaignRow[]>`update campaigns set status = 'running', total = ${total}, started_at = now(), failed = 0 where id = ${id} returning *`;
  void runGrant(id).catch((e) => log.error('campaign run failed', { err: String(e), campaign: id }));
  return u!;
}

/** После перезапуска сервера продолжаем незаконченные выдачи */
export async function resumeGrants(): Promise<void> {
  const rows = await sql()<{ id: string }[]>`select id from campaigns where status = 'running'`;
  for (const r of rows) void runGrant(r.id).catch(() => {});
}

// ---------- Скидки и бонусы (действуют автоматически, пока акция активна) ----------
let activeCache: { at: number; rows: CampaignRow[] } | null = null;
export function dropCampaignCache() { activeCache = null; }
async function activeAuto(): Promise<CampaignRow[]> {
  if (activeCache && Date.now() - activeCache.at < 15_000) return activeCache.rows;
  const rows = await sql()<CampaignRow[]>`
    select * from campaigns where is_active and kind in ('plan_discount','topup_bonus') and starts_at <= now() and (ends_at is null or ends_at > now())`;
  // окна авто-скидок для сегментов expiring_soon / recently_expired
  const a = await getSettings('autodiscount');
  autoDays.expiring = a.expiring_days; autoDays.expired = a.expired_days;
  activeCache = { at: Date.now(), rows };
  return rows;
}
async function inAudience(userId: string, audience: string): Promise<boolean> {
  if (audience === 'all') return true;
  const [r] = await sql()`select 1 from users u where u.id = ${userId} and ${where(audience)}`;
  return Boolean(r);
}

/** Лучшая подходящая скидка на тариф (в процентах) */
export async function planDiscountFor(userId: string, planId: string): Promise<{ pct: number; title: string; endsAt: Date | null } | null> {
  let best: { pct: number; title: string; endsAt: Date | null } | null = null;
  for (const c of (await activeAuto()).filter((x) => x.kind === 'plan_discount')) {
    if (c.plan_ids?.length && !c.plan_ids.includes(planId)) continue;
    if (best && best.pct >= c.value) continue;
    if (await inAudience(userId, c.audience)) best = { pct: Math.min(c.value, 100), title: c.title, endsAt: c.ends_at };
  }
  return best;
}
export async function topupBonusPct(userId: string): Promise<number> {
  let best = 0;
  for (const c of (await activeAuto()).filter((x) => x.kind === 'topup_bonus')) {
    if (c.value > best && (await inAudience(userId, c.audience))) best = c.value;
  }
  return best;
}

/** Акции, которые видит этот пользователь (для баннера в Mini App) */
export async function activeFor(userId: string): Promise<ActiveCampaignDTO[]> {
  const out: ActiveCampaignDTO[] = [];
  for (const c of await activeAuto()) if (await inAudience(userId, c.audience)) out.push({ id: c.id, title: c.title, kind: c.kind as ActiveCampaignDTO['kind'], value: c.value, endsAt: c.ends_at?.toISOString() ?? null, planIds: c.plan_ids });
  return out;
}
