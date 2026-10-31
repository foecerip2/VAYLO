import { sql } from '../db/index.js';
import { config } from '../config.js';
import { escapeHtml } from '../lib/errors.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { getSettings } from './settings.js';
import { SUPPORT_HAS_ACTIVITY_SQL } from './supportVisibility.js';

export function localReportClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return { day: yesterday.toISOString().slice(0, 10), time: `${part('hour')}:${part('minute')}` };
}

/** Closed calendar day in the selected timezone. No rolling 24-hour windows. */
export async function buildDailyReport(day: string, timezone: string) {
  const db = sql();
  const [bounds] = await db`select (${day}::date::timestamp at time zone ${timezone}) as start,
    ((${day}::date + 1)::timestamp at time zone ${timezone}) as finish`;
  const start = bounds!.start as Date, finish = bounds!.finish as Date;
  const [users] = await db`select count(*)::int as total,
    count(*) filter(where created_at >= ${start} and created_at < ${finish})::int as new_users,
    count(*) filter(where bot_blocked)::int as blocked from users`;
  const [activity] = await db`select count(*)::int as actions, count(distinct user_id)::int as active from bot_activity_events where created_at >= ${start} and created_at < ${finish}`;
  const categories = await db`select category,count(*)::int as n from bot_activity_events where created_at >= ${start} and created_at < ${finish} group by category`;
  const [payments] = await db`select count(*)::int as count, coalesce(sum(amount),0)::bigint as revenue,
    count(distinct user_id)::int as buyers from payments where status='succeeded'
    and provider in ('yookassa','platega','rollypay') and paid_at >= ${start} and paid_at < ${finish}`;
  const [subs] = await db`select count(*) filter(where expires_at>now() and not is_trial)::int as paid,
    count(*) filter(where expires_at>now() and is_trial)::int as trials,
    
    count(*) filter(where expires_at>now() and expires_at<=now()+interval '1 day')::int as expiring from subscriptions`;
  const [trials] = await db`select count(*)::int as n from trial_activations where created_at>=${start} and created_at<${finish}`;
  const [gifts] = await db`select count(*) filter(where created_at>=${start} and created_at<${finish})::int as created,
    count(*) filter(where redeemed_at>=${start} and redeemed_at<${finish})::int as redeemed from gifts`;
  const [issues] = await db`select
    (select count(*)::int from payments where status='succeeded' and fulfilled_at is null) as unfulfilled,
    (select count(*)::int from support_tickets t where t.status<>'closed' and t.admin_archived_at is null and ${db.unsafe(SUPPORT_HAS_ACTIVITY_SQL)}) as support`;
  const labels: Record<string,string> = {start:'Запуски /start',menu:'Меню',subscription:'Подключение и подписка',payments:'Тарифы и оплата',gifts:'Подарки',support:'Помощь',referrals:'Рефералы',rewards:'Бонусы и задания',other:'Другие действия'};
  const { brand_name: brand } = await getSettings('general');
  const money = (Number(payments!.revenue) / 100).toLocaleString('ru-RU', {minimumFractionDigits:2,maximumFractionDigits:2});
  const text = `📊 <b>${escapeHtml(brand)} · ежедневный отчёт</b>\n${day.split('-').reverse().join('.')} · ${escapeHtml(timezone)}\n\n` +
    `<b>👥 Пользователи за день</b>\nНовых: ${users!.new_users}\nАктивных в боте: ${activity!.active}\nДействий в боте: ${activity!.actions}\n` +
    categories.sort((a,b)=>String(a.category).localeCompare(String(b.category))).map(c=>`• ${labels[String(c.category)] ?? 'Другие'}: ${c.n}`).join('\n') +
    `\n\n<b>💳 Оплаты за день</b>\nВыручка: ${money} ₽\nПлатежей: ${payments!.count} · плательщиков: ${payments!.buyers}\n` +
    `Внешние платёжные системы; без оплат с баланса и бонусов.\n\n` +
    `<b>🎁 Подарки за день</b>\nКуплено: ${gifts!.created} · активировано: ${gifts!.redeemed}\nНовых пробных подписок: ${trials!.n}\n\n` +
    `<b>📍 Сейчас, на момент формирования</b>\nВсего пользователей: ${users!.total}\nПлатных подписок: ${subs!.paid} · пробных: ${subs!.trials}\nИстекают в ближайшие сутки: ${subs!.expiring}\nЗаблокировали бота: ${users!.blocked}\nОткрытых обращений: ${issues!.support}\nОплачено без выдачи доступа: ${issues!.unfulfilled}\n\n` +
    `Действия — команды, сообщения и нажатия в личном чате, не VPN-трафик. Учёт начинается после обновления.`;
  return { day, timezone, text };
}

export async function dailyReportRecipients(extra: string) {
  const rows = await sql()`select tg_id from admins where tg_id is not null`;
  return [...new Set([...rows.map(r => Number(r.tg_id)), ...(extra ? [Number(extra)] : [])])];
}

/** Snapshot + per-recipient delivery state survive worker restarts and settings changes. */
export async function dailyReportTick(now = new Date()) {
  const cfg = await getSettings('admin_notifications');
  if (!cfg.daily_enabled) return { sent: 0 };
  const clock = localReportClock(now, cfg.timezone);
  if (clock.time < cfg.daily_time) return { sent: 0 };
  const ids = await dailyReportRecipients(cfg.extra_chat_id);
  if (!ids.length) return { sent: 0 };
  // Competing workers reuse one report snapshot. Telegram sends have their own row locks below.
  const existing = await sql()`select text from admin_daily_reports where day=${clock.day} and timezone=${cfg.timezone}`;
  if (!existing.length) {
    const report = await buildDailyReport(clock.day,cfg.timezone);
    await sql()`insert into admin_daily_reports(day,timezone,text) values(${clock.day},${cfg.timezone},${report.text}) on conflict do nothing`;
  }
  let sent = 0;
  for (const chatId of ids) {
    await sql().begin(async db => {
      await db`insert into admin_report_deliveries(day,timezone,chat_id) values(${clock.day},${cfg.timezone},${chatId}) on conflict do nothing`;
      const [delivery] = await db`select * from admin_report_deliveries where day=${clock.day} and timezone=${cfg.timezone} and chat_id=${chatId} for update`;
      if (delivery!.sent_at || (delivery!.attempted_at && new Date(delivery!.attempted_at).getTime() > Date.now()-5*60_000)) return;
      const [report] = await db`select text from admin_daily_reports where day=${clock.day} and timezone=${cfg.timezone}`;
      const result = await sendTelegramMessage(chatId, report!.text, [[{text:'Открыть админку', url:config().ADMIN_URL}]]);
      await db`update admin_report_deliveries set attempted_at=now(),attempts=attempts+1,sent_at=${result.ok ? new Date() : null}
        where day=${clock.day} and timezone=${cfg.timezone} and chat_id=${chatId}`;
      if (result.ok) sent++;
    });
  }
  return { sent };
}
