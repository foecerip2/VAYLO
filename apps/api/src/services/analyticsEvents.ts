import { config } from '../config.js';
import { sql } from '../db/index.js';

/** Клиентские события — только продуктовая воронка. Деньги берутся из payments, не отсюда. */
export const CLIENT_EVENTS = ['miniapp_open', 'connect_clicked', 'help_opened'] as const;
export const SERVER_EVENTS = ['bot_start', 'trial_started', ...CLIENT_EVENTS] as const;
const PROP_KEYS = ['screen', 'campaign', 'os'] as const;

export function cleanProps(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') for (const k of PROP_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && /^[\w .:-]{1,40}$/u.test(v)) out[k] = v;
  }
  return out;
}

export async function recordEvent(e: { eventId: string; name: (typeof SERVER_EVENTS)[number]; userId?: string | null; sessionId?: string; source?: string; campaign?: string; occurredAt?: Date; properties?: unknown }): Promise<boolean> {
  if (!config().PRODUCT_ANALYTICS_ENABLED) return false;
  const when = e.occurredAt && Math.abs(e.occurredAt.getTime() - Date.now()) < 86_400_000 ? e.occurredAt : new Date();
  const r = await sql()`insert into product_events (event_id, event_name, user_id, session_id, source, campaign_id, occurred_at, properties)
    values (${e.eventId.slice(0, 64)}, ${e.name}, ${e.userId ?? null}, ${e.sessionId?.slice(0, 40) ?? null}, ${e.source ?? 'miniapp'}, ${e.campaign?.slice(0, 40) ?? null}, ${when}, ${sql().json(cleanProps(e.properties))})
    on conflict (event_id) do nothing returning event_id`;
  return r.length > 0;
}
