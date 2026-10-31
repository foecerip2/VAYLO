import { beforeAll,beforeEach,afterAll,it,expect,vi } from 'vitest';
import { sql,closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { setSettings,clearSettingsCache,getSettings } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { createPayment,applyProviderStatus } from '../src/services/payments.js';
import { paymentNotificationTick,paymentNotificationStatus,paymentNoticeRecipients } from '../src/services/paymentNotifications.js';
import { buildApp } from '../src/app.js';
import { signAdminToken,signUserToken } from '../src/lib/jwt.js';
import * as telegram from '../src/lib/telegram.js';

const M=(globalThis as any).__mocks;
let serial=71000;
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();});
beforeEach(async()=>{
  vi.restoreAllMocks();
  await sql()`truncate users,admins,plans,settings cascade`;clearSettingsCache();
  M.tg.state.messages.length=0;M.tg.state.blocked.clear();M.tg.state.down=false;
  M.rw.state.users.clear();M.rw.state.fail=false;
});
afterAll(async()=>{await closeDb();for(const m of Object.values(M) as any[])m.server.close();});

async function admin(tgId:number|null=900001,role='owner'){
  const [a]=await sql()`insert into admins(email,password_hash,role,tg_id) values(${serial+++'@notice.test'},'unused',${role},${tgId}) returning id`;
  return a!;
}
async function customer(){return upsertTelegramUser({id:serial++,first_name:'Сергей <&>',username:'client_test'});}
async function plan(){const [p]=await sql()`insert into plans(name,duration_days,device_limit,price) values('1 месяц',30,3,19900) returning id`;return String(p!.id);}
async function paid(provider='platega',purpose='plan',payload:Record<string,unknown>={},status='succeeded',amount=19900){
  const u=await customer();
  const [p]=await sql()`insert into payments(user_id,provider,method,purpose,plan_name,amount,status,paid_at,fulfilled_at,payload)
    values(${u.id},${provider},'sbp',${purpose},${purpose==='addon'?'LTE 10 ГБ':'1 месяц'},${amount},${status},${status==='succeeded'?new Date():null},${status==='succeeded'?new Date():null},${sql().json(payload as any)}) returning id`;
  return String(p!.id);
}
const notices=()=>M.tg.state.messages.filter((m:any)=>m.chat_id===900001);
async function waitForNotice(){await vi.waitFor(()=>expect(notices()).toHaveLength(1),{timeout:3000});}

it('queues only confirmed positive payments, not pending, canceled, promo or zero-price orders',async()=>{
  await admin();await paid('platega','plan',{},'pending');await paid('yookassa','plan',{},'canceled');await paid('promo','plan',{},'succeeded',0);await paid('balance','plan',{},'succeeded',0);
  expect((await paymentNotificationTick()).sent).toBe(0);expect(await sql()`select * from admin_payment_events`).toHaveLength(0);
  const id=await paid();expect(await sql()`select * from admin_payment_events where payment_id=${id}`).toHaveLength(1);
  expect((await paymentNotificationTick()).sent).toBe(1);
  expect(notices()[0].text).toContain('Получена оплата');expect(notices()[0].text).toContain('199');
  expect(notices()[0].text).toContain('Сергей &lt;&amp;&gt;');expect(notices()[0].text).toContain('СБП');
  expect(notices()[0].text).not.toContain('Сергей <&>');expect(notices()[0].text).toContain('Подписка активирована');
});

it('persists the event in the same transaction and rolls it back with a failed purchase',async()=>{
  await admin();const u=await customer();
  await expect(sql().begin(async tx=>{await tx`insert into payments(user_id,provider,purpose,amount,status) values(${u.id},'balance','plan',19900,'succeeded')`;throw new Error('rollback');})).rejects.toThrow('rollback');
  expect(await sql()`select * from admin_payment_events`).toHaveLength(0);
});

it('sends separately for each financial recipient, deduplicates shared chat and concurrent workers',async()=>{
  await admin();await admin(900002,'admin');await admin(900003,'support');await admin(900004,'analyst');
  await setSettings('admin_notifications',{extra_chat_id:'900001'});const id=await paid();
  await Promise.all([paymentNotificationTick(),paymentNotificationTick(),paymentNotificationTick(id)]);
  expect(M.tg.state.messages.map((m:any)=>m.chat_id).sort()).toEqual([900001,900002]);
  await sql()`update payments set status='succeeded' where id=${id}`;
  expect((await paymentNotificationTick()).sent).toBe(0);
  expect(await sql()`select * from admin_payment_events`).toHaveLength(1);
});

it('retries only the failed recipient after cooldown and preserves delivered receipts',async()=>{
  await admin();await admin(900002,'admin');await paid();
  const send=vi.spyOn(telegram,'sendTelegramMessage').mockImplementation(async id=>id===900001?{ok:true}:{ok:false,blocked:false,error:'temporary outage'});
  expect((await paymentNotificationTick()).sent).toBe(1);expect(send).toHaveBeenCalledTimes(2);
  expect((await paymentNotificationTick()).sent).toBe(0);expect(send).toHaveBeenCalledTimes(2);
  await sql()`update admin_payment_deliveries set next_attempt_at=now()-interval '1 second' where sent_at is null`;
  send.mockResolvedValue({ok:true});expect((await paymentNotificationTick()).sent).toBe(1);
  expect(send.mock.calls.at(-1)![0]).toBe(900002);
  expect((await paymentNotificationStatus()).pending).toBe(0);
});

it('retains blocked delivery for later retry and does not leak it after the admin role is revoked',async()=>{
  const a=await admin();await paid();M.tg.state.blocked.add(900001);
  expect((await paymentNotificationTick()).sent).toBe(0);
  const [d]=await sql()`select attempts,last_error,next_attempt_at from admin_payment_deliveries`;
  expect(d!.attempts).toBe(1);expect(d!.last_error).toContain('Forbidden');expect(d!.next_attempt_at.getTime()).toBeGreaterThan(Date.now()+50*60_000);
  await sql()`update admins set role='support' where id=${a.id}`;M.tg.state.blocked.clear();
  await sql()`update admin_payment_deliveries set next_attempt_at=now()-interval '1 second'`;
  expect((await paymentNotificationTick()).sent).toBe(0);expect(notices()).toHaveLength(0);
});

it('waits for a configured recipient, then recovers the saved event after restart',async()=>{
  const id=await paid();expect((await paymentNotificationTick()).sent).toBe(0);
  expect((await paymentNotificationStatus()).waiting).toBe(1);clearSettingsCache();await admin();
  expect((await paymentNotificationTick()).sent).toBe(1);expect(notices()[0].text).toContain(id);
});

it('refreshes issuance status before retry instead of sending a stale pending message',async()=>{
  await admin();const id=await paid();await sql()`update payments set fulfilled_at=null where id=${id}`;
  const send=vi.spyOn(telegram,'sendTelegramMessage').mockResolvedValue({ok:false,blocked:false,error:'temporary outage'});
  await paymentNotificationTick();expect(send.mock.calls[0]![1]).toContain('Выдача покупки ожидается');
  await sql()`update payments set fulfilled_at=now() where id=${id}`;
  await sql()`update admin_payment_deliveries set next_attempt_at=now()-interval '1 second'`;
  send.mockResolvedValue({ok:true});await paymentNotificationTick();
  expect(send.mock.calls.at(-1)![1]).toContain('Подписка активирована');expect(send.mock.calls.at(-1)![1]).not.toContain('Выдача покупки ожидается');
});

it('does not depend on monitoring or the daily report switch; disabled payment notices are skipped',async()=>{
  await admin();await setSettings('monitoring',{alerts:false});await setSettings('admin_notifications',{daily_enabled:false,payments_enabled:false});
  const id=await paid();await paymentNotificationTick();
  expect((await sql()`select skip_reason from admin_payment_events where payment_id=${id}`)[0]!.skip_reason).toBe('disabled');
  await setSettings('admin_notifications',{payments_enabled:true});expect((await paymentNotificationTick()).sent).toBe(0);
  await paid();expect((await paymentNotificationTick()).sent).toBe(1);
});

it('labels balance purchases as internal spending and allows disabling them separately',async()=>{
  await admin();await paid('balance');await paymentNotificationTick();
  expect(notices()[0].text).toContain('Покупка с баланса');expect(notices()[0].text).toContain('не новое поступление');
  await setSettings('admin_notifications',{balance_purchases_enabled:false});await paid('balance');await paid('yookassa');
  expect((await paymentNotificationTick()).sent).toBe(1);expect(notices()).toHaveLength(2);
});

it('distinguishes LTE/device top-ups, gifts and balance funding without disclosing gift codes',async()=>{
  await admin();await paid('platega','addon',{addon:{kind:'lte',qty:10}});await paid('yookassa','plan',{gift:true});await paid('rollypay','topup');
  expect((await paymentNotificationTick()).sent).toBe(3);
  const texts=notices().map((m:any)=>m.text).join('\n');expect(texts).toContain('LTE 10 ГБ');expect(texts).toContain('Докупка применена');expect(texts).toContain('Подарочная подписка');expect(texts).toContain('Подарок создан');expect(texts).toContain('Пополнение баланса');expect(texts).toContain('Деньги зачислены');
});

it('shows pending issuance, permanent failure and a refund honestly',async()=>{
  await admin();const id=await paid();await sql()`update payments set fulfilled_at=null where id=${id}`;await paymentNotificationTick();
  expect(notices()[0].text).toContain('Выдача покупки ожидается');
  const fail=await paid();await sql()`update payments set fulfilled_at=null,fulfill_failed_at=now(),refunded_to_balance=true where id=${fail}`;await paymentNotificationTick();
  expect(notices()[1].text).toContain('Сумма возвращена на баланс');
  const refund=await paid();await sql()`update payments set status='refunded' where id=${refund}`;await paymentNotificationTick();
  expect(notices()[2].text).toContain('платёж уже возвращён');
});

it.each(['yookassa','platega:sbp','rollypay:any'])('notifies after real confirmation through %s, not payment creation',async method=>{
  await admin();const u=await customer();const planId=await plan();
  await setSettings('yookassa',{enabled:true,shop_id:M.yk.shopId,secret_key:M.yk.secret});
  await setSettings('platega',{enabled:true,merchant_id:M.pl.merchant,secret:M.pl.secret,methods:['sbp']});
  await setSettings('rollypay',{enabled:true,api_key:M.rp.apiKey,signing_secret:'test-signing-secret',methods:['any']});
  const payment=await createPayment(u,{planId,method});expect(notices()).toHaveLength(0);
  await Promise.all([applyProviderStatus(payment.id,'succeeded'),applyProviderStatus(payment.id,'succeeded')]);
  await waitForNotice();await paymentNotificationTick();expect(notices()).toHaveLength(1);
});

it('immediately notifies for an actual balance purchase only after its transaction commits',async()=>{
  await admin();const u=await customer();const planId=await plan();await sql()`update users set balance=30000 where id=${u.id}`;
  await createPayment({...u,balance:30000},{planId,method:'balance'});await waitForNotice();
  expect(notices()[0].text).toContain('Покупка с баланса');
  expect((await sql()`select balance from users where id=${u.id}`)[0]!.balance).toBe(10100);
});

it('still informs the admin if Remnawave issuance fails after a confirmed payment',async()=>{
  await admin();const u=await customer();const planId=await plan();
  await setSettings('yookassa',{enabled:true,shop_id:M.yk.shopId,secret_key:M.yk.secret});
  const p=await createPayment(u,{planId,method:'yookassa'});M.rw.state.fail=true;
  await applyProviderStatus(p.id,'succeeded');await waitForNotice();expect(notices()[0].text).toContain('Выдача покупки ожидается');
});

it('protects status and test endpoints, and sends a labeled test only to the requesting admin',async()=>{
  const a=await admin(),support=await admin(900002,'support'),missing=await admin(null,'admin'),u=await customer();
  const app=await buildApp({logger:false});
  try{
    const ownerHeaders={authorization:'Bearer '+await signAdminToken(a.id,'owner')};
    for(const token of [await signUserToken(u.id),await signAdminToken(support.id,'support')]){
      const r=await app.inject({method:'GET',url:'/api/v1/admin/notifications/payments',headers:{authorization:'Bearer '+token}});expect([401,403]).toContain(r.statusCode);
    }
    const status=await app.inject({method:'GET',url:'/api/v1/admin/notifications/payments',headers:ownerHeaders});expect(status.statusCode).toBe(200);expect(status.json().telegramLinked).toBe(true);expect(notices()).toHaveLength(0);
    const noId=await app.inject({method:'POST',url:'/api/v1/admin/notifications/payments/test',headers:{authorization:'Bearer '+await signAdminToken(missing.id,'admin')},payload:{}});expect(noId.statusCode).toBe(400);
    const r=await app.inject({method:'POST',url:'/api/v1/admin/notifications/payments/test',headers:ownerHeaders,payload:{}});expect(r.json()).toEqual({ok:true});expect(notices()).toHaveLength(1);expect(notices()[0].text).toContain('реальной оплаты нет');
    expect(await sql()`select * from payments`).toHaveLength(0);expect(await sql()`select * from admin_payment_events`).toHaveLength(0);
    M.tg.state.blocked.add(900001);const blocked=await app.inject({method:'POST',url:'/api/v1/admin/notifications/payments/test',headers:ownerHeaders,payload:{}});expect(blocked.json()).toEqual({ok:false});
  }finally{await app.close();}
});

it('defaults to enabled for existing settings and allows a deduplicated negative group chat',async()=>{
  expect((await getSettings('admin_notifications')).payments_enabled).toBe(true);
  await admin();await setSettings('admin_notifications',{extra_chat_id:'-1001234567890'});
  expect(await paymentNoticeRecipients('-1001234567890')).toEqual([900001,-1001234567890]);
  await expect(setSettings('admin_notifications',{payments_enabled:'yes'})).rejects.toThrow();
});
