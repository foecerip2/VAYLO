import { lteEnabled } from './lte.js';
import type { PlanDTO } from '@vpn/shared';
import { sql } from '../db/index.js';
import type { PlanRow } from '../db/types.js';
import { notFound } from '../lib/errors.js';

export function toPlanDTO(p: PlanRow): PlanDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    durationDays: p.duration_days,
    trafficLimitGb: lteEnabled()?0:p.traffic_limit_gb,
    deviceLimit: p.device_limit,
    price: p.price,
    oldPrice: p.old_price,
    badge: p.badge,
    sort: p.sort,
    isActive: p.is_active,
  };
}

export async function listPlans(onlyActive = true): Promise<PlanRow[]> {
  return sql()<PlanRow[]>`select * from plans where ${onlyActive ? sql()`is_active` : sql()`true`} order by sort, price`;
}

export async function getPlan(id: string, requireActive = true): Promise<PlanRow> {
  const [p] = await sql()<PlanRow[]>`select * from plans where id = ${id}`;
  if (!p || (requireActive && !p.is_active)) throw notFound('Тариф не найден');
  return p;
}

/** Стартовые тарифы — создаются один раз при первом запуске (если таблица пуста) */
export async function seedDefaultPlans(): Promise<number> {
  const [{ n }] = await sql()`select count(*)::int as n from plans`;
  if (n > 0) return 0;
  const defaults = [
    { name: '1 месяц', days: 30, price: 19900, old: null, badge: null, sort: 1, desc: 'Для знакомства с сервисом' },
    { name: '3 месяца', days: 90, price: 49900, old: 59700, badge: 'Популярный', sort: 2, desc: 'Выгода 15%' },
    { name: '6 месяцев', days: 180, price: 89900, old: 119400, badge: '−25%', sort: 3, desc: 'Выгода 25%' },
    { name: '12 месяцев', days: 360, price: 149900, old: 238800, badge: 'Лучшая цена', sort: 4, desc: 'Выгода 40%' },
  ];
  for (const d of defaults) {
    await sql()`insert into plans (name, description, duration_days, traffic_limit_gb, device_limit, price, old_price, badge, sort)
      values (${d.name}, ${d.desc}, ${d.days}, 0, 3, ${d.price}, ${d.old}, ${d.badge}, ${d.sort})`;
  }
  return defaults.length;
}
