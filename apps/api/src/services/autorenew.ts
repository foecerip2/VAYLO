import { sql } from '../db/index.js';
import { escapeHtml, isPermanentError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import type { UserRow } from '../db/types.js';
import { formatRub } from '@vpn/shared';
import { createPayment } from './payments.js';
import { notifyUser, openAppButton } from './notify.js';
import { isClosing } from './closure.js';
import { getSettings } from './settings.js';

/**
 * Автопродление с баланса: за ≤3 дня до окончания продлеваем текущий тариф, если на балансе хватает.
 * Пока подписка не продлена, пробуем при каждом запуске (пополнили баланс / панель ожила — продлится).
 * Пользователю об неудаче пишем один раз за период (метка notified.renew_notified, сбрасывается при продлении).
 */
export async function autoRenew(): Promise<number> {
  const cfg = await getSettings('addons');
  if (!cfg.auto_renew_enabled || (await isClosing())) return 0;
  const rows = await sql()<(UserRow & { plan_id: string; plan_name: string; expires_at: Date; price: number; renew_notified: boolean })[]>`
    select u.*, s.plan_id, s.plan_name, s.expires_at, p.price, coalesce((s.notified ->> 'renew_notified')::boolean, false) as renew_notified
    from users u join subscriptions s on s.user_id = u.id join plans p on p.id = s.plan_id and p.is_active
    where u.auto_renew and u.status = 'active' and not s.is_trial
      and s.expires_at > now() and s.expires_at <= now() + interval '3 days'
    order by s.expires_at limit 200`;
  let done = 0;
  for (const u of rows) {
    // цена с персональной скидкой — как её посчитает createPayment
    const price = u.price - Math.floor((u.price * (u.discount_pct ?? 0)) / 100);
    try {
      await createPayment(u, { planId: u.plan_id, method: 'balance' });
      await notifyUser(u.id, `🔄 <b>Подписка продлена автоматически</b>\nТариф «${escapeHtml(u.plan_name)}», списано ${formatRub(price)}.`, [openAppButton()]);
      done++;
    } catch (e) {
      const code = (e as { code?: string }).code;
      const need = code === 'insufficient_balance';
      const permanent = isPermanentError(e);
      log.warn('autorenew failed', { userId: u.id, code, err: (e as Error).message });
      // временный сбой (панель/сеть) — молча повторим при следующем запуске
      if (!need && !permanent) continue;
      if (u.renew_notified) continue;
      await sql()`update subscriptions set notified = notified || '{"renew_notified": true}'::jsonb where user_id = ${u.id}`;
      await notifyUser(u.id, need ? `⚠️ Не удалось продлить автоматически: на балансе не хватает средств (нужно ${formatRub(price)}). Пополните баланс — продление произойдёт автоматически.` : '⚠️ Автопродление не удалось. Продлите подписку вручную.', [openAppButton('💳 Пополнить')]);
    }
  }
  return done;
}
