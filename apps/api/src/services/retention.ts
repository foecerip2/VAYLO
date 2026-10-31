import { sql } from '../db/index.js';

/** Ежедневная чистка. Сырые замеры net_probes чистит netTick (14 дней). Агрегаты и денежные таблицы не трогаем. */
export async function retentionTick(): Promise<{ events: number; incidents: number }> {
  const e = await sql()`delete from product_events where occurred_at < now() - interval '400 days' returning 1`;
  const i = await sql()`delete from network_incidents where state = 'resolved' and ended_at < now() - interval '180 days' returning 1`;
  return { events: e.length, incidents: i.length };
}
