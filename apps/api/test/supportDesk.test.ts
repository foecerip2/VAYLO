import { beforeAll,beforeEach,afterAll,it,expect } from 'vitest';
import sharp from 'sharp';
import {buildApp} from '../src/app.js';
import {sql,closeDb} from '../src/db/index.js';
import {migrate} from '../src/db/migrate.js';
import {clearSettingsCache} from '../src/services/settings.js';
import {upsertTelegramUser} from '../src/services/users.js';
import {signUserToken,signAdminToken} from '../src/lib/jwt.js';
import {buildDailyReport} from '../src/services/adminReports.js';
const mocks=(globalThis as any).__mocks;
let app:Awaited<ReturnType<typeof buildApp>>,client:string,staff:string,analyst:string,userId:string,staffId:string,photo:{image:string};
async function call(method:string,path:string,token=client,payload?:unknown){return app.inject({method:method as any,url:'/api/v1'+path,headers:token?{authorization:'Bearer '+token}:{},payload:payload as any});}
async function ticket(priority='urgent'){const r=await call('POST','/support/tickets',client,{subject:'Не подключается',body:'Нужна помощь с подключением',priority});expect(r.statusCode).toBe(200);return r.json().id as string;}
async function stats(){return (await call('GET','/admin/support/stats',staff)).json();}
async function rows(query=''){return(await call('GET','/admin/support/tickets'+query,staff)).json();}
async function thread(id:string){return(await call('GET','/support/tickets/'+id)).json();}
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();app=await buildApp({logger:false});const bytes=await sharp({create:{width:16,height:20,channels:3,background:'#5588cc'}}).png().toBuffer();photo={image:'data:image/png;base64,'+bytes.toString('base64')};});
beforeEach(async()=>{await sql()`truncate users,admins,settings,monitor_state cascade`;clearSettingsCache();mocks.tg.state.messages.length=0;mocks.tg.state.blocked.clear();const u=await upsertTelegramUser({id:48001,first_name:'Клиент'});userId=u.id;client=await signUserToken(u.id);const [a]=await sql()`insert into admins(email,password_hash,role,tg_id) values('support-desk@test','x','support',58001) returning id`;staffId=a.id;staff=await signAdminToken(a.id,'support');const [b]=await sql()`insert into admins(email,password_hash,role) values('desk-analyst@test','x','analyst') returning id`;analyst=await signAdminToken(b.id,'analyst');});
afterAll(async()=>{await app?.close();await closeDb();for(const m of Object.values(mocks) as any[])m.server.close();});
it('opening support twice creates one draft and empty chats do not inflate queue, counters or user history',async()=>{
 const opened=await Promise.all(Array.from({length:6},()=>call('POST','/support/chat')));expect(new Set(opened.map(r=>r.json().id)).size).toBe(1);const id=opened[0].json().id;
 const [count]=await sql()`select count(*)::int as n from support_tickets`;expect(count.n).toBe(1);
 expect(await rows()).toEqual([]);expect(await stats()).toMatchObject({open:0,unread:0,ai_active:0,empty_chats:1});expect((await call('GET','/support')).json().tickets).toEqual([]);
 expect((await buildDailyReport('2026-10-25','Europe/Moscow')).text).toContain('Открытых обращений: 0');
 expect((await thread(id)).messages).toHaveLength(1);expect((await rows('?content=empty'))[0].id).toBe(id);
 await call('POST',`/support/tickets/${id}/messages`,client,{text:'Как подключиться?'});expect((await rows())[0].id).toBe(id);expect(await stats()).toMatchObject({open:1,empty_chats:0});expect((await call('GET','/support')).json().tickets).toHaveLength(1);
 expect((await buildDailyReport('2026-10-25','Europe/Moscow')).text).toContain('Открытых обращений: 1');
});
it('legacy empty drafts are preserved separately and actual text or photo-only conversations remain visible',async()=>{
 const [empty]=await sql()`insert into support_tickets(user_id,kind,subject,mode) values(${userId},'chat','Черновик','human') returning id`;await sql()`insert into support_messages(ticket_id,author,body) values(${empty.id},'system','Приветствие')`;
 const id=(await call('POST','/support/tickets',client,{photos:[photo]})).json().id;
 expect((await rows()).map((r:any)=>r.id)).toEqual([id]);expect(await rows('?content=all')).toHaveLength(2);expect(await rows('?content=empty')).toHaveLength(1);expect(await stats()).toMatchObject({open:1,empty_chats:1});const [count]=await sql()`select count(*)::int as n from support_tickets`;expect(count.n).toBe(2);
});
it('support can lower priority with a reason; client sees a truthful system message, bot notice and audit attribution',async()=>{
 const id=await ticket();const r=await call('PATCH','/admin/support/tickets/'+id,staff,{priority:'normal',reason:'Проверили: проблема затрагивает одну локацию.'});expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({changed:true,notified:true});
 const t=await thread(id);expect(t.ticket.priority).toBe('normal');const notice=t.messages.find((m:any)=>m.author==='system'&&m.body.includes('Поддержка уточнила'));expect(notice.body).toContain('«Срочный» → «Обычный»');expect(notice.body).toContain('Причина: Проверили');expect(notice.body).not.toContain('система автоматически');const [saved]=await sql()`select admin_id from support_messages where id=${notice.id}`;expect(saved.admin_id).toBe(staffId);
 expect(mocks.tg.state.messages.some((m:any)=>m.chat_id===48001&&m.text.includes('Срочный')&&m.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('/support/'+id))).toBe(true);const [audit]=await sql()`select data from audit_log where action='support.update' and entity_id=${id}`;expect(audit.data.priority).toBe('normal');
});
it('identical concurrent updates produce a single change and a single client notification',async()=>{
 const id=await ticket();const changes=await Promise.all([call('PATCH','/admin/support/tickets/'+id,staff,{priority:'normal'}),call('PATCH','/admin/support/tickets/'+id,staff,{priority:'normal'})]);expect(changes.map(r=>r.statusCode)).toEqual([200,200]);expect(changes.filter(r=>r.json().changed)).toHaveLength(1);expect((await thread(id)).messages.filter((m:any)=>m.body.includes('Поддержка уточнила'))).toHaveLength(1);expect(mocks.tg.state.messages.filter((m:any)=>m.chat_id===48001)).toHaveLength(1);
});
it('workflow states are available in queue filters and user replies preserve work or reopen waiting/closed cases',async()=>{
 const id=await ticket();await call('PATCH','/admin/support/tickets/'+id,staff,{status:'in_progress'});expect((await rows('?status=in_progress'))[0].id).toBe(id);expect(await stats()).toMatchObject({in_progress:1});
 const during=await call('POST',`/support/tickets/${id}/messages`,client,{text:'Дополнительные сведения'});expect(during.json().thread.ticket.status).toBe('in_progress');
 await call('PATCH','/admin/support/tickets/'+id,staff,{status:'waiting_user',reason:'Нужен скриншот ошибки'});expect(await stats()).toMatchObject({waiting_user:1});expect((await thread(id)).messages.some((m:any)=>m.body.includes('Нужно уточнение'))).toBe(true);
 const answered=await call('POST',`/support/tickets/${id}/messages`,client,{photos:[photo]});expect(answered.json().thread.ticket.status).toBe('open');
 await call('PATCH','/admin/support/tickets/'+id,staff,{status:'closed'});expect((await rows('?status=closed'))[0].id).toBe(id);const reopened=await call('POST',`/support/tickets/${id}/messages`,client,{text:'Вопрос остался'});expect(reopened.json().thread.ticket.status).toBe('open');
});
it('anonymous clients, normal users and analysts cannot change priority or status',async()=>{
 const id=await ticket();for(const token of ['',client,analyst]){const r=await call('PATCH','/admin/support/tickets/'+id,token,{priority:'normal',status:'closed'});expect([401,403]).toContain(r.statusCode);}expect((await thread(id)).ticket).toMatchObject({priority:'urgent',status:'open'});expect(mocks.tg.state.messages.filter((m:any)=>m.chat_id===48001)).toHaveLength(0);
});
it('a Telegram-linked support account can exchange its user session and manage the same queue',async()=>{
 const u=await upsertTelegramUser({id:58001,first_name:'Оператор'});const session=await signUserToken(u.id);const exchanged=await call('POST','/auth/admin-tg',session,{});expect(exchanged.statusCode).toBe(200);const id=await ticket();const r=await call('PATCH','/admin/support/tickets/'+id,exchanged.json().accessToken,{status:'in_progress'});expect(r.statusCode).toBe(200);expect((await call('GET','/admin/support/tickets?status=in_progress',exchanged.json().accessToken)).json()[0].id).toBe(id);
});
it('invalid workflow inputs do not change history; changing only AI mode does not send a priority notice',async()=>{
 const id=await ticket();const initial=(await thread(id)).messages.length;for(const payload of [{status:'made-up'},{reason:'x'.repeat(301),priority:'normal'},{priority:'critical'}])expect((await call('PATCH','/admin/support/tickets/'+id,staff,payload)).statusCode).toBe(400);
 const mode=await call('PATCH','/admin/support/tickets/'+id,staff,{aiOff:true});expect(mode.statusCode).toBe(200);expect(mode.json().notified).toBeUndefined();expect((await thread(id)).messages.length).toBe(initial);
});
it('a blocked bot does not lose the status update or its in-app explanation',async()=>{
 const id=await ticket();mocks.tg.state.blocked.add(48001);const r=await call('PATCH','/admin/support/tickets/'+id,staff,{priority:'normal',status:'in_progress',reason:'Уточнили характер проблемы'});expect(r.statusCode).toBe(200);expect(r.json().notified).toBe(false);const t=await thread(id);expect(t.ticket).toMatchObject({priority:'normal',status:'in_progress'});expect(t.messages.filter((m:any)=>m.body.includes('Уточнили характер проблемы'))).toHaveLength(1);
});
it('staff archive hides a ticket from both queues and reports, retaining customer history, photos and state',async()=>{
 const id=(await call('POST','/support/tickets',client,{subject:'Фото ошибки',body:'Не открывается сайт',priority:'urgent',photos:[photo]})).json().id;
 const before=await thread(id);const stored=before.messages.find((m:any)=>m.attachments.length)?.attachments[0];
 const r=await call('POST',`/admin/support/tickets/${id}/archive`,staff,{});expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({archived:true,changed:true});
 expect(await rows()).toEqual([]);expect(await rows('?archive=all')).toHaveLength(1);expect((await rows('?archive=archived'))[0]).toMatchObject({id,priority:'urgent',status:'open'});
 expect(await stats()).toMatchObject({open:0,urgent:0,unread:0,archived:1});expect((await buildDailyReport('2026-10-25','Europe/Moscow')).text).toContain('Открытых обращений: 0');
 expect((await call('GET','/support')).json().tickets[0].id).toBe(id);expect(await thread(id)).toEqual(before);
 expect((await call('GET','/support/attachments/'+stored.id)).statusCode).toBe(200);
 const [saved]=await sql()`select admin_archived_by from support_tickets where id=${id}`;expect(saved.admin_archived_by).toBe(staffId);
 expect(mocks.tg.state.messages.filter((m:any)=>m.chat_id===48001)).toHaveLength(0);
});
it('archive and restore are idempotent and only changed operations create audit records',async()=>{
 const id=await ticket();const url=`/admin/support/tickets/${id}`;
 const results=await Promise.all([call('POST',url+'/archive',staff,{}),call('POST',url+'/archive',staff,{})]);expect(results.filter(r=>r.json().changed)).toHaveLength(1);
 expect((await call('POST',url+'/restore',staff,{})).json()).toMatchObject({archived:false,changed:true});expect((await call('POST',url+'/restore',staff,{})).json().changed).toBe(false);
 expect((await rows())[0].id).toBe(id);expect(await rows('?archive=archived')).toEqual([]);
 const audits=await sql()`select action from audit_log where entity_id=${id} and action in ('support.archive','support.restore')`;expect(audits).toHaveLength(2);
});
it('a new client message or photo restores an archived conversation automatically',async()=>{
 const id=(await call('POST','/support/chat')).json().id;await call('POST',`/support/tickets/${id}/messages`,client,{text:'Нужна помощь'});for(const body of [{text:'Уточняю проблему'},{photos:[photo]}]){
  await call('POST',`/admin/support/tickets/${id}/archive`,staff,{});
  const r=await call('POST',`/support/tickets/${id}/messages`,client,body);expect(r.statusCode).toBe(200);
  expect((await rows())[0]).toMatchObject({id,archivedAt:null,unread:true});expect(await stats()).toMatchObject({open:1,archived:0});
 }
 const [t]=await sql()`select admin_archived_at,admin_archived_by from support_tickets where id=${id}`;expect(t).toMatchObject({admin_archived_at:null,admin_archived_by:null});
});
it('staff reply restores an archived conversation and archive permissions match support roles',async()=>{
 const id=await ticket();const url=`/admin/support/tickets/${id}`;
 for(const token of ['',client,analyst])for(const action of ['archive','restore'])expect([401,403]).toContain((await call('POST',url+'/'+action,token,{})).statusCode);
 await call('POST',url+'/archive',staff,{});expect((await call('POST',url+'/reply',staff,{text:'Ответ оператора'})).statusCode).toBe(200);
 expect((await rows())[0]).toMatchObject({id,archivedAt:null,status:'answered'});
 expect((await call('GET','/admin/support/tickets?archive=invalid',staff)).statusCode).toBe(400);
 expect((await call('POST','/admin/support/tickets/00000000-0000-4000-8000-000000000001/archive',staff,{})).statusCode).toBe(404);
});
