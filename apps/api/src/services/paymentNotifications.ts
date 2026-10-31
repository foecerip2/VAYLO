import { PLATEGA_METHODS, ROLLYPAY_METHODS, formatRub } from '@vpn/shared';
import { config } from '../config.js';
import { sql, type TxSql } from '../db/index.js';
import type { PaymentRow } from '../db/types.js';
import { escapeHtml } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { getSettings } from './settings.js';

type NoticePayment = Pick<PaymentRow, 'id'|'provider'|'method'|'purpose'|'plan_name'|'amount'|'payload'|'status'|'fulfilled_at'|'fulfill_failed_at'|'refunded_to_balance'|'paid_at'>;
type Buyer = { tg_id:number|null; first_name:string|null; username:string|null };

export function paymentNoticeText(p:NoticePayment, user:Buyer, timezone:string) {
  const balance=p.provider==='balance';
  const name=escapeHtml((user.first_name||'Пользователь').slice(0,120));
  const who=user.tg_id?`<a href="tg://user?id=${user.tg_id}">${name}</a>`:name;
  const username=user.username?` (@${escapeHtml(user.username.slice(0,64))})`:'';
  const product=p.payload?.gift?'Подарочная подписка':p.purpose==='plan'?'Подписка':p.purpose==='addon'?'Докупка':'Пополнение баланса';
  const method=p.provider==='yookassa'?'ЮKassa':p.provider==='platega'?'Platega':p.provider==='rollypay'?'RollyPay':balance?'Баланс':escapeHtml(p.provider);
  const methodTitle=p.provider==='platega'?PLATEGA_METHODS[p.method as keyof typeof PLATEGA_METHODS]?.title:p.provider==='rollypay'?ROLLYPAY_METHODS[p.method as keyof typeof ROLLYPAY_METHODS]?.title:null;
  let state:string;
  if(p.status==='refunded')state='↩️ К моменту уведомления платёж уже возвращён.';
  else if(p.fulfill_failed_at)state=p.refunded_to_balance?'⚠️ Покупка не выдана. Сумма возвращена на баланс клиента.':'⚠️ Покупка не выдана — требуется проверка.';
  else if(!p.fulfilled_at)state='⏳ Оплата подтверждена. Выдача покупки ожидается.';
  else state=p.payload?.gift?'✅ Подарок создан.':p.purpose==='plan'?'✅ Подписка активирована / продлена.':p.purpose==='addon'?'✅ Докупка применена.':'✅ Деньги зачислены на баланс.';
  const paid=p.paid_at?new Date(p.paid_at).toLocaleString('ru-RU',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  return `${balance?'💰 <b>Покупка с баланса</b>':'💳 <b>Получена оплата</b>'}\n\nКлиент: ${who}${username}${user.tg_id?`\nTelegram ID: <code>${user.tg_id}</code>`:''}\n${product}${p.plan_name?`: «${escapeHtml(p.plan_name.slice(0,200))}»`:''}\n${balance?'Списано':'Сумма'}: <b>${formatRub(p.amount)}</b>\nСпособ: ${method}${methodTitle?' · '+escapeHtml(methodTitle):''}\n\n${state}${balance?'\nОплата внутренним балансом, не новое поступление денег.':''}${paid?`\n${paid} · ${escapeHtml(timezone)}`:''}\nПлатёж: <code>${p.id}</code>`;
}

/** Financial notifications are delivered to owners/admins, plus the configured shared chat. */
export async function paymentNoticeRecipients(extra:string) {
  const rows=await sql()`select tg_id from admins where role in ('owner','admin') and tg_id is not null`;
  return [...new Set([...rows.map(r=>Number(r.tg_id)),...(extra?[Number(extra)]:[])])];
}

async function currentNoticeText(db:TxSql, paymentId:string, timezone:string) {
  const [p]=await db<PaymentRow[]>`select * from payments where id=${paymentId}`;
  if(!p)return;
  const [u]=await db<Buyer[]>`select tg_id,first_name,username from users where id=${p.user_id}`;
  return paymentNoticeText(p,u??{tg_id:null,first_name:null,username:null},timezone);
}

async function prepare(db:TxSql, paymentId:string, ids:number[]) {
  for(const chatId of ids)await db`insert into admin_payment_deliveries(payment_id,chat_id) values(${paymentId},${chatId}) on conflict do nothing`;
  await db`update admin_payment_events set prepared_at=now() where payment_id=${paymentId}`;
}

/** Durable queue + row locks avoid duplicate webhook delivery and allow API/worker concurrency.
 * Telegram has no send idempotency key: an accepted message followed by a lost response may be retried.
 */
export async function paymentNotificationTick(paymentId?:string) {
  const cfg=await getSettings('admin_notifications');
  const ids=await paymentNoticeRecipients(cfg.extra_chat_id);
  const events=await sql()`select e.payment_id,p.provider from admin_payment_events e join payments p on p.id=e.payment_id
    where e.prepared_at is null and e.skipped_at is null ${paymentId?sql()`and e.payment_id=${paymentId}`:sql()``}
    order by e.created_at limit 30`;
  for(const e of events)await sql().begin(async db=>{
    const [row]=await db`select payment_id from admin_payment_events where payment_id=${e.payment_id}
      and prepared_at is null and skipped_at is null for update skip locked`;
    if(!row)return;
    if(!cfg.payments_enabled||(e.provider==='balance'&&!cfg.balance_purchases_enabled)){
      await db`update admin_payment_events set skipped_at=now(),skip_reason='disabled' where payment_id=${e.payment_id}`;return;
    }
    if(ids.length)await prepare(db,String(e.payment_id),ids);
  });
  if(!cfg.payments_enabled||!ids.length)return {sent:0};
  const pending=await sql()`select d.payment_id,d.chat_id from admin_payment_deliveries d join payments p on p.id=d.payment_id
    where d.sent_at is null and d.next_attempt_at<=now() and d.chat_id in ${sql()(ids)}
    and (${cfg.balance_purchases_enabled} or p.provider<>'balance') ${paymentId?sql()`and d.payment_id=${paymentId}`:sql()``}
    order by d.next_attempt_at limit 20`;
  let sent=0;const started=Date.now();
  for(const d of pending){
    if(Date.now()-started>20_000)break;
    await sql().begin(async db=>{
      const [delivery]=await db`select d.attempts from admin_payment_deliveries d
        where d.payment_id=${d.payment_id} and d.chat_id=${d.chat_id} and d.sent_at is null and d.next_attempt_at<=now()
        for update of d skip locked`;
      if(!delivery)return;
      const text=await currentNoticeText(db,String(d.payment_id),cfg.timezone);
      if(!text)return;
      const result=await sendTelegramMessage(Number(d.chat_id),text,[[{text:'💳 Платежи в админке',url:config().ADMIN_URL.replace(/\/$/,'')+'/payments'}]]);
      const retryMinutes=Math.min(60,2**Math.min(6,Number(delivery.attempts)));
      await db`update admin_payment_deliveries set attempted_at=now(),attempts=attempts+1,
        sent_at=${result.ok?new Date():null},last_error=${result.ok?null:result.error.slice(0,300)},
        next_attempt_at=now()+make_interval(mins=>${result.ok?0:result.blocked?60:retryMinutes})
        where payment_id=${d.payment_id} and chat_id=${d.chat_id}`;
      if(result.ok)sent++;
    });
  }
  return {sent};
}

/** Fast path after a committed payment; the scheduled worker recovers crashes and network failures. */
export function dispatchPaymentNotice(paymentId:string) {
  void paymentNotificationTick(paymentId).catch(e=>log.error('payment notification failed',{paymentId,err:(e as Error).message}));
}

export function paymentNoticeExample(timezone:string) {
  return paymentNoticeText({id:'00000000-0000-4000-8000-000000000000',provider:'platega',method:'sbp',purpose:'plan',plan_name:'1 месяц',amount:19900,payload:{},status:'succeeded',fulfilled_at:new Date(),fulfill_failed_at:null,refunded_to_balance:false,paid_at:new Date()}, {tg_id:null,first_name:'Пример клиента',username:null},timezone);
}

export async function paymentNotificationStatus() {
  const cfg=await getSettings('admin_notifications');
  const [counts]=await sql()`select count(*) filter(where sent_at is null)::int as pending,
    count(*) filter(where sent_at is null and attempts>0)::int as failed,
    count(*) filter(where sent_at is not null)::int as sent,max(sent_at) as last_sent_at from admin_payment_deliveries`;
  const [waiting]=await sql()`select count(*)::int as n from admin_payment_events where prepared_at is null and skipped_at is null`;
  return {recipients:(await paymentNoticeRecipients(cfg.extra_chat_id)).length,pending:Number(counts!.pending),failed:Number(counts!.failed),sent:Number(counts!.sent),waiting:Number(waiting!.n),lastSentAt:counts!.last_sent_at,example:paymentNoticeExample(cfg.timezone)};
}
