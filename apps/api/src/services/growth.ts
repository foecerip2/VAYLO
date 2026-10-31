import { sql } from '../db/index.js';
import { escapeHtml } from '../lib/errors.js';
import { dropCampaignCache } from './campaigns.js';
import { notifyUser, openAppButton } from './notify.js';
import { getSettings } from './settings.js';
import { isClosing } from './closure.js';

/**
 * Авто-скидки. Цены по-прежнему считает существующий механизм акций: здесь только поддерживаются две служебные акции
 * (скоро закончится / недавно закончилась) по настройкам. Код оплаты и подписок не затрагивается.
 */
export async function autodiscountSync(): Promise<number> {
  const c = await getSettings('autodiscount');
  const defs = [
    { key: 'expiring', title: `Скидка на продление ${c.expiring_pct}%`, audience: 'expiring_soon', pct: c.expiring_pct },
    { key: 'expired', title: `Вернитесь со скидкой ${c.expired_pct}%`, audience: 'recently_expired', pct: c.expired_pct },
  ];
  let changed = 0;
  for (const d of defs) {
    const active = c.enabled && d.pct > 0 && !(await isClosing());
    const r = await sql()`insert into campaigns (title, kind, value, audience, notify, is_active, starts_at, status, created_by, auto_key)
      values (${d.title}, 'plan_discount', ${Math.max(1, d.pct)}, ${d.audience}, false, ${active}, now(), 'running', 'auto', ${d.key})
      on conflict (auto_key) where auto_key is not null do update set title = excluded.title, value = excluded.value, is_active = excluded.is_active
        where campaigns.title is distinct from excluded.title or campaigns.value is distinct from excluded.value or campaigns.is_active is distinct from excluded.is_active
      returning id`;
    changed += r.length;
  }
  if (changed) dropCampaignCache();
  return changed;
}

/** Воронка в боте: короткие сообщения с кнопкой. Каждый шаг уходит человеку не более одного раза; заблокировавшим бота не пишем. */
export async function funnelTick(): Promise<number> {
  const f = await getSettings('funnel');
  if (!f.enabled || (await isClosing())) return 0;
  const ad = await getSettings('autodiscount');
  const brand = (await getSettings('general')).brand_name;
  let sent = 0;
  const send = async (rows: readonly Record<string, unknown>[], step: string, text: string, button: string) => {
    for (const r of rows) {
      const id = r.id as string;
      const ins = await sql()`insert into bot_funnel_sent (user_id, step) values (${id}, ${step}) on conflict do nothing returning user_id`;
      if (!ins.length) continue;
      if (await notifyUser(id, text, [openAppButton(button)])) sent++;
    }
  };
  const base = sql()`u.tg_id is not null and not u.bot_blocked and u.status = 'active'`;

  // 1) зарегистрировался, но не взял пробный период
  const nudge = await sql()`select u.id from users u where ${base} and not u.trial_used and not exists (select 1 from subscriptions s where s.user_id = u.id)
    and u.created_at < now() - make_interval(hours => ${f.start_nudge_hours}) and u.created_at > now() - interval '3 days'
    and not exists (select 1 from bot_funnel_sent b where b.user_id = u.id and b.step = 'start_nudge') limit 200`;
  await send(nudge, 'start_nudge', `👋 <b>Подключение занимает минуту</b>\nОткройте приложение ${escapeHtml(brand)} и нажмите «Подключить»: пробный период бесплатный.`, '🚀 Подключить');

  if (f.trial_tips) {
    const tips = await sql()`select u.id from users u join subscriptions s on s.user_id = u.id where ${base} and s.is_trial and s.expires_at > now()
      and s.started_at < now() - interval '20 hours' and not exists (select 1 from bot_funnel_sent b where b.user_id = u.id and b.step = 'trial_tips') limit 200`;
    await send(tips, 'trial_tips', '💡 <b>Если соединение нестабильно</b>\nСмените локацию в приложении или обновите подписку в клиенте. Не помогло: в «Помощи» есть кнопка «Не работает», она всё проверит.', '🛟 Помощь');
  }

  if (f.trial_ended_offer) {
    const ended = await sql()`select u.id from users u join subscriptions s on s.user_id = u.id where ${base} and s.is_trial and s.expires_at <= now() and s.expires_at > now() - interval '3 days'
      and not exists (select 1 from payments p where p.user_id = u.id and p.status = 'succeeded' and p.amount > 0)
      and not exists (select 1 from bot_funnel_sent b where b.user_id = u.id and b.step = 'trial_ended') limit 200`;
    const disc = ad.enabled && ad.expired_pct > 0 ? `\nДля вас действует скидка ${ad.expired_pct}%.` : '';
    await send(ended, 'trial_ended', `🔒 <b>Пробный период закончился</b>\nПродолжите пользоваться VPN: выберите тариф в приложении.${disc}`, '💳 Выбрать тариф');
  }
  return sent;
}
