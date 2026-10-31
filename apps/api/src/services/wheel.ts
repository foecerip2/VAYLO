import { randomInt } from 'node:crypto';
import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { conflict } from '../lib/errors.js';
import { getSettings } from './settings.js';
import { grantAccess } from './subscriptions.js';
import { assertSalesOpen } from './closure.js';

export interface WheelPrizeDTO { id: string; label: string; type: 'days' | 'balance'; value: number }
export interface WheelDTO {
  enabled: boolean;
  canSpin: boolean;
  /** ISO-время, когда колесо снова доступно (полночь по Москве), если сегодня уже крутили */
  nextSpinAt: string | null;
  prizes: WheelPrizeDTO[];
  last: (WheelPrizeDTO & { at: string }) | null;
}

async function today(): Promise<{ day: string; next: string }> {
  const [r] = await sql()`
    select to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD') as d,
           (date_trunc('day', now() at time zone 'Europe/Moscow') + interval '1 day') at time zone 'Europe/Moscow' as n`;
  return { day: r!.d as string, next: (r!.n as Date).toISOString() };
}

const pub = (p: { id: string; label: string; type: 'days' | 'balance'; value: number }): WheelPrizeDTO => ({ id: p.id, label: p.label, type: p.type, value: p.value });

export async function getWheel(user: UserRow): Promise<WheelDTO> {
  const cfg = await getSettings('wheel');
  if (!cfg.enabled) return { enabled: false, canSpin: false, nextSpinAt: null, prizes: [], last: null };
  const { day, next } = await today();
  const [spun] = await sql()`select 1 from wheel_spins where user_id = ${user.id} and day = ${day}`;
  const [last] = await sql()`select prize_id, prize_label, prize_type, prize_value, created_at from wheel_spins where user_id = ${user.id} order by created_at desc limit 1`;
  return {
    enabled: true,
    canSpin: !spun,
    nextSpinAt: spun ? next : null,
    prizes: cfg.prizes.map(pub),
    last: last ? { id: last.prize_id, label: last.prize_label, type: last.prize_type, value: Number(last.prize_value), at: (last.created_at as Date).toISOString() } : null,
  };
}

/** Взвешенный выбор приза: криптостойкий генератор, итог определяет только сервер. */
export function pickPrize<T extends { weight: number }>(prizes: T[], rnd: (max: number) => number = (m) => randomInt(m)): { index: number; prize: T } {
  const total = prizes.reduce((a, p) => a + p.weight, 0);
  let r = rnd(total);
  for (let i = 0; i < prizes.length; i++) {
    if (r < prizes[i]!.weight) return { index: i, prize: prizes[i]! };
    r -= prizes[i]!.weight;
  }
  return { index: prizes.length - 1, prize: prizes[prizes.length - 1]! };
}

export async function spinWheel(user: UserRow): Promise<{ prizeIndex: number; prize: WheelPrizeDTO; nextSpinAt: string }> {
  const cfg = await getSettings('wheel');
  if (!cfg.enabled) throw conflict('Колесо удачи отключено', 'wheel_disabled');
  await assertSalesOpen();
  const { day, next } = await today();
  const { index, prize } = pickPrize(cfg.prizes);
  return sql().begin(async (tx) => {
    await tx`select 1 from users where id = ${user.id} for update`;
    const ins = await tx`
      insert into wheel_spins (user_id, day, prize_id, prize_label, prize_type, prize_value)
      values (${user.id}, ${day}, ${prize.id}, ${prize.label}, ${prize.type}, ${prize.value})
      on conflict do nothing returning 1`;
    if (!ins.length) throw conflict('Сегодня вы уже крутили колесо — приходите завтра', 'wheel_already_spun');
    if (prize.type === 'days') {
      await grantAccess(tx, user.id, { days: prize.value });
    } else {
      const [b] = await tx`update users set balance = balance + ${prize.value} where id = ${user.id} returning balance`;
      await tx`insert into transactions (user_id, type, amount, balance_after, note) values (${user.id}, 'wheel', ${prize.value}, ${b!.balance}, ${'Колесо удачи'})`;
    }
    return { prizeIndex: index, prize: pub(prize), nextSpinAt: next };
  });
}
