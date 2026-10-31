import { beforeAll,beforeEach,afterAll,it,expect,vi } from 'vitest';
import { sql,closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { buildDailyReport,dailyReportTick,localReportClock } from '../src/services/adminReports.js';
import { recordBotActivity } from '../src/services/botActivity.js';
import { setSettings,clearSettingsCache } from '../src/services/settings.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { buildApp } from '../src/app.js';
import { signAdminToken,signUserToken } from '../src/lib/jwt.js';
import * as telegram from '../src/lib/telegram.js';

const now = new Date('2026-10-25T07:00:00Z');
let uid=92000;
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();});
beforeEach(async()=>{vi.restoreAllMocks();await sql()`truncate users,admins,settings,bot_activity_updates,trial_activations,admin_daily_reports cascade`;clearSettingsCache();});
afterAll(async()=>{await closeDb();for(const m of Object.values((globalThis as any).__mocks) as any[])m.server.close();});
async function admin(tgId=123456){const [a]=await sql()`insert into admins(email,password_hash,role,tg_id) values(${tgId+'@report.test'},'unused','owner',${tgId}) returning id`;return a!;}
it('uses the local calendar, including date changes and DST',()=>{
 expect(localReportClock(new Date('2026-01-01T22:30:00Z'),'Europe/Moscow')).toEqual({day:'2026-01-01',time:'01:30'});
 expect(localReportClock(new Date('2026-10-25T02:30:00Z'),'Europe/Berlin')).toEqual({day:'2026-10-24',time:'03:30'});
});
it('deduplicates concurrent Telegram update delivery without storing messages',async()=>{
 const u=await upsertTelegramUser({id:uid++});
 await Promise.all([recordBotActivity(u.id,17,'start'),recordBotActivity(u.id,17,'start')]);
 expect(await sql()`select * from bot_activity_events`).toHaveLength(1);
});
it('counts exact timezone boundaries and unique bot visitors, excluding balance from revenue',async()=>{
 const a=await upsertTelegramUser({id:uid++}),b=await upsertTelegramUser({id:uid++});
 for(let i=1;i<=4;i++)await recordBotActivity(i===3?b.id:a.id,i,'menu');
 await sql()`update bot_activity_events set created_at=case update_id when 1 then '2026-10-23T21:00:00Z'::timestamptz when 2 then '2026-10-24T20:59:59Z'::timestamptz when 3 then '2026-10-24T21:00:00Z'::timestamptz else '2026-10-23T20:59:59Z'::timestamptz end`;
 await sql()`insert into payments(user_id,provider,purpose,amount,status,paid_at) values(${a.id},'balance','plan',100000,'succeeded','2026-10-24T10:00:00Z'),(${a.id},'yookassa','plan',19900,'succeeded','2026-10-24T10:00:00Z'),(${a.id},'yookassa','plan',50000,'succeeded','2026-10-24T21:00:00Z')`;
 const report=await buildDailyReport('2026-10-24','Europe/Moscow');
 expect(report.text).toContain('Активных в боте: 1');expect(report.text).toContain('Действий в боте: 2');expect(report.text).toContain('Выручка: 199,00 ₽');expect(report.text).toContain('Платежей: 1');
});
it('uses a 25-hour DST day rather than the last 24 hours',async()=>{
 const u=await upsertTelegramUser({id:uid++});await recordBotActivity(u.id,1,'start');await recordBotActivity(u.id,2,'menu');
 await sql()`update bot_activity_events set created_at=case update_id when 1 then '2026-10-24T22:00:00Z'::timestamptz else '2026-10-25T22:59:59Z'::timestamptz end`;
 expect((await buildDailyReport('2026-10-25','Europe/Berlin')).text).toContain('Действий в боте: 2');
});
it('does not send before schedule or when disabled; ignores monitoring alert switch',async()=>{
 await admin();const send=vi.spyOn(telegram,'sendTelegramMessage').mockResolvedValue({ok:true});
 await setSettings('monitoring',{alerts:false});
 expect((await dailyReportTick(new Date('2026-10-25T05:59:00Z'))).sent).toBe(0);
 await setSettings('admin_notifications',{daily_enabled:false});expect((await dailyReportTick(now)).sent).toBe(0);
 await setSettings('admin_notifications',{daily_enabled:true});expect((await dailyReportTick(now)).sent).toBe(1);expect(send).toHaveBeenCalledTimes(1);
});
it('deduplicates recipients, concurrent workers, and restarts using persisted deliveries',async()=>{
 await admin();await setSettings('admin_notifications',{extra_chat_id:'123456'});
 const send=vi.spyOn(telegram,'sendTelegramMessage').mockResolvedValue({ok:true});
 const result=await Promise.all([dailyReportTick(now),dailyReportTick(now)]);
 expect(result.reduce((a,b)=>a+b.sent,0)).toBe(1);expect(send).toHaveBeenCalledTimes(1);
 expect((await dailyReportTick(now)).sent).toBe(0);
});
it('retries failed recipient only, with cooldown, and keeps the saved report',async()=>{
 await admin();await admin(123457);const send=vi.spyOn(telegram,'sendTelegramMessage').mockImplementation(async id=>id===123456?{ok:true}:{ok:false,blocked:false,error:'retry'});
 expect((await dailyReportTick(now)).sent).toBe(1);expect((await dailyReportTick(now)).sent).toBe(0);expect(send).toHaveBeenCalledTimes(2);
 await sql()`update admin_report_deliveries set attempted_at=now()-interval '6 minutes' where sent_at is null`;
 await setSettings('general',{brand_name:'Changed brand'});send.mockResolvedValue({ok:true});
 expect((await dailyReportTick(now)).sent).toBe(1);expect(send.mock.calls.at(-1)![1]).not.toContain('Changed brand');
});
it('validates timezone, time and chat; escapes HTML in report brand',async()=>{
 await expect(setSettings('admin_notifications',{timezone:'bad/zone'})).rejects.toThrow();
 await expect(setSettings('admin_notifications',{daily_time:'25:00'})).rejects.toThrow();
 await expect(setSettings('admin_notifications',{extra_chat_id:'@username'})).rejects.toThrow();
 await setSettings('general',{brand_name:'<test>&'});expect((await buildDailyReport('2026-10-24','UTC')).text).toContain('&lt;test&gt;&amp;');
});
it('keeps anonymous activity counts after trial cleanup removes the account',async()=>{
 const u=await upsertTelegramUser({id:uid++});await recordBotActivity(u.id,55,'start');await sql()`delete from users where id=${u.id}`;
 expect(await sql()`select * from bot_activity_events`).toHaveLength(1);
});
it('protects telemetry with internal key, preserves referrals, and restricts admin preview',async()=>{
 const app=await buildApp({logger:false});
 try{
  const a=await admin();const referrer=await upsertTelegramUser({id:uid++});const tgId=uid++;
  const path='/api/v1/internal/bot-activity',payload={updateId:77,category:'start'};
  expect((await app.inject({method:'POST',url:path,payload})).statusCode).toBe(401);
  const headers={'x-internal-key':process.env.INTERNAL_KEY!,'x-tg-user':Buffer.from(JSON.stringify({id:tgId})).toString('base64'),'x-ref-code':referrer.referral_code};
  expect((await app.inject({method:'POST',url:path,headers,payload})).statusCode).toBe(200);
  expect((await sql()`select referrer_id from users where tg_id=${tgId}`)[0]!.referrer_id).toBe(referrer.id);
  const userToken=await signUserToken(referrer.id);
  expect((await app.inject({method:'GET',url:'/api/v1/admin/notifications/preview',headers:{authorization:'Bearer '+userToken}})).statusCode).toBe(401);
  const auth={authorization:'Bearer '+await signAdminToken(a.id,'owner')};
  const send=vi.spyOn(telegram,'sendTelegramMessage').mockResolvedValue({ok:true});
  expect((await app.inject({method:'GET',url:'/api/v1/admin/notifications/preview',headers:auth})).statusCode).toBe(200);expect(send).not.toHaveBeenCalled();
  expect((await app.inject({method:'POST',url:'/api/v1/admin/notifications/test',headers:auth,payload:{}})).json()).toEqual({ok:true});expect(send.mock.calls[0]![0]).toBe(123456);
  expect(await sql()`select * from admin_report_deliveries`).toHaveLength(0);
 }finally{await app.close();}
});
