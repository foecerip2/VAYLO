import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { sql, closeDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { clearSettingsCache, setSettings } from '../src/services/settings.js';
import { signAdminToken, signUserToken } from '../src/lib/jwt.js';
import { upsertTelegramUser } from '../src/services/users.js';
import { SUPPORT_PHOTO_BODY_LIMIT } from '../src/services/supportAttachments.js';
const mocks = (globalThis as any).__mocks;
let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string, token: string, other: string, admin: string, analyst: string;
let png: Buffer, jpeg: Buffer;
const photo = (data=png, mime='png', name='Скриншот.png') => ({image:`data:image/${mime};base64,${data.toString('base64')}`,name});
async function call(method: string, path: string, t=token, payload?: unknown) {
 return app.inject({method:method as any,url:'/api/v1'+path,headers:t?{authorization:'Bearer '+t}:{},payload:payload as any});
}
async function ticket(photos: any[]=[],body='Не подключается VPN') {
 const r=await call('POST','/support/tickets',token,{subject:'Ошибка подключения',body,photos});expect(r.statusCode).toBe(200);return r.json().id as string;
}
async function thread(id:string){const r=await call('GET','/support/tickets/'+id);expect(r.statusCode).toBe(200);return r.json();}
async function count(table:'support_attachments'|'support_messages'|'support_tickets'){const [n]=await sql()`select count(*)::int as n from ${sql()(table)}`;return n.n as number;}
beforeAll(async()=>{
 await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();app=await buildApp({logger:false});
 png=await sharp({create:{width:240,height:360,channels:3,background:'#5688ab'}}).png().toBuffer();
 jpeg=await sharp({create:{width:320,height:180,channels:3,background:'#ccaa99'}}).withMetadata({orientation:6}).jpeg().toBuffer();
});
beforeEach(async()=>{
 await sql()`truncate users,settings,admins,monitor_state cascade`;clearSettingsCache();mocks.tg.state.messages.length=0;mocks.tg.state.blocked.clear();mocks.tg.state.down=false;
 const u=await upsertTelegramUser({id:4701,first_name:'Фото'});userId=u.id;token=await signUserToken(u.id);
 const o=await upsertTelegramUser({id:4702,first_name:'Другой'});other=await signUserToken(o.id);
 const [a]=await sql()`insert into admins(email,password_hash,role,tg_id) values('photos@test','unused','support',5701) returning id`;admin=await signAdminToken(a.id,'support');
 const [b]=await sql()`insert into admins(email,password_hash,role) values('analyst@test','unused','analyst') returning id`;analyst=await signAdminToken(b.id,'analyst');
});
afterAll(async()=>{await app?.close();await closeDb();for(const m of Object.values(mocks) as any[])m.server.close();});
it('creates a ticket with private photos, normalizes JPEG/PNG and removes metadata',async()=>{
 const id=await ticket([photo(),photo(jpeg,'jpeg','../../private<script>.jpg')]);const t=await thread(id);const msg=t.messages.find((m:any)=>m.author==='user');expect(msg.attachments).toHaveLength(2);
 expect(JSON.stringify(t)).not.toContain('base64,');expect(msg.attachments[1].name).not.toMatch(/[<>/]/);
 for(const p of msg.attachments){const r=await call('GET','/support/attachments/'+p.id);expect(r.statusCode).toBe(200);expect(r.headers['content-type']).toBe('image/jpeg');expect(r.headers['cache-control']).toBe('private, no-store');expect(r.headers['x-content-type-options']).toBe('nosniff');const meta=await sharp(r.rawPayload).metadata();expect(meta.exif).toBeUndefined();expect(meta.format).toBe('jpeg');}
 const [stored]=await sql()`select data from support_attachments where id=${msg.attachments[1].id}`;const meta=await sharp(stored.data).metadata();expect([meta.width,meta.height]).toEqual([180,320]);
 const a=await call('GET','/admin/support/tickets/'+id,admin);expect(a.json().messages.find((m:any)=>m.id===msg.id).attachments).toHaveLength(2);
});
it('denies anonymous, another user, user tokens on admin routes, and analyst access',async()=>{
 const id=await ticket([photo()]);const p=(await thread(id)).messages.find((m:any)=>m.author==='user').attachments[0].id;
 expect((await call('GET','/support/attachments/'+p,'')).statusCode).toBe(401);
 expect((await call('GET','/support/attachments/'+p,other)).statusCode).toBe(404);
 expect((await call('GET','/admin/support/attachments/'+p,token)).statusCode).toBe(401);
 expect((await call('GET','/admin/support/attachments/'+p,analyst)).statusCode).toBe(403);
 expect((await call('GET','/admin/support/attachments/'+p,admin)).statusCode).toBe(200);
 expect((await call('POST',`/support/tickets/${id}/messages`,other,{photos:[photo()]})).statusCode).toBe(404);
 expect(await count('support_attachments')).toBe(1);
});
it('supports photo-only tickets and replies, reopens a closed ticket and notifies the client',async()=>{
 const id=await ticket([photo()],'');await call('PATCH','/admin/support/tickets/'+id,admin,{status:'closed'});
 const r=await call('POST',`/support/tickets/${id}/messages`,token,{photos:[photo()]});expect(r.statusCode).toBe(200);expect(r.json().thread.ticket.status).toBe('open');
 const reply=await call('POST',`/admin/support/tickets/${id}/reply`,admin,{photos:[photo()],close:true});expect(reply.statusCode).toBe(200);expect(reply.json().notified).toBe(true);
 const t=await thread(id);expect(t.ticket.status).toBe('closed');expect(t.messages.find((m:any)=>m.author==='admin').attachments).toHaveLength(1);expect(mocks.tg.state.messages.some((m:any)=>m.chat_id===4701&&m.text.includes('Прикреплено фото: 1')&&m.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('/support/'+id))).toBe(true);
});
it('escalates photos in AI chat atomically even when automatic text escalation is disabled',async()=>{
 await setSettings('support',{ai_enabled:true,ai_base_url:'http://127.0.0.1:9/v1',ai_model:'not-called',ai_key:'secret',auto_escalate:false});
 const opened=await call('POST','/support/chat');const id=opened.json().id;
 const r=await call('POST',`/support/tickets/${id}/messages`,token,{text:'Вот ошибка',photos:[photo()]});expect(r.statusCode).toBe(200);expect(r.json().thread.ticket).toMatchObject({mode:'human',escalated:true});expect(r.json().thread.messages.some((m:any)=>m.author==='ai')).toBe(false);expect(r.json().thread.messages.some((m:any)=>m.author==='system'&&m.body.includes('Фото передано оператору'))).toBe(true);const [usage]=await sql()`select count(*)::int as n from support_usage`;expect(usage.n).toBe(0);
});
it('rejects invalid content, incorrect MIME, truncated image and excess attachments without partial writes',async()=>{
 for(const photos of [[photo(Buffer.from('<svg onload="evil()"/>'),'png')],[photo(png,'jpeg')],[photo(png.subarray(0,40))],[{image:'data:image/png;base64,not-base64!'}],Array(4).fill(photo())]){
  const r=await call('POST','/support/tickets',token,{body:'Проверка фото',photos});expect(r.statusCode).toBe(400);expect(await count('support_tickets')).toBe(0);expect(await count('support_messages')).toBe(0);expect(await count('support_attachments')).toBe(0);
 }
 const id=await ticket();await call('PATCH','/admin/support/tickets/'+id,admin,{status:'closed'});const before=await count('support_messages');
 const broken=[photo(),photo(Buffer.from('not-an-image'))];
 expect((await call('POST',`/support/tickets/${id}/messages`,token,{text:'Прикладываю скрин',photos:broken})).statusCode).toBe(400);
 expect((await call('POST',`/admin/support/tickets/${id}/reply`,admin,{text:'Ответ',photos:broken})).statusCode).toBe(400);
 expect((await thread(id)).ticket.status).toBe('closed');expect(await count('support_messages')).toBe(before);expect(await count('support_attachments')).toBe(0);
});
it('rejects images above pixel, byte and request limits and rejects an empty message',async()=>{
 const large=await sharp({create:{width:6000,height:4100,channels:3,background:'#fff'}}).png().toBuffer();
 expect((await call('POST','/support/tickets',token,{photos:[photo(large)]})).statusCode).toBe(400);
 expect((await call('POST','/support/tickets',token,{photos:[photo(Buffer.alloc(2*1024*1024+1))]})).statusCode).toBe(400);
 expect((await call('POST','/support/tickets',token,{body:'x'.repeat(SUPPORT_PHOTO_BODY_LIMIT)})).statusCode).toBe(413);
 const id=await ticket();expect((await call('POST',`/support/tickets/${id}/messages`,token,{})).statusCode).toBe(400);expect((await call('POST',`/admin/support/tickets/${id}/reply`,admin,{})).statusCode).toBe(400);
});
it('photo upload respects disabled support and a muted user, while existing history stays readable',async()=>{
 const id=await ticket([photo()]);await setSettings('support',{enabled:false});expect((await call('POST',`/support/tickets/${id}/messages`,token,{photos:[photo()]})).statusCode).toBe(409);
 expect((await thread(id)).messages.find((m:any)=>m.author==='user').attachments).toHaveLength(1);
 await setSettings('support',{enabled:true});await sql()`update users set support_muted_until=now()+interval '10 minutes' where id=${userId}`;
 expect((await call('POST',`/support/tickets/${id}/messages`,token,{photos:[photo()]})).statusCode).toBe(429);expect(await count('support_attachments')).toBe(1);
});
it('30-photo ticket limit is correct under parallel uploads and rejection rolls the message back',async()=>{
 const id=await ticket();const [m]=await sql()`select id from support_messages where ticket_id=${id} and author='user'`;const bytes=await sharp(png).jpeg().toBuffer();
 for(let i=0;i<10;i++){const [next]=await sql()`insert into support_messages(ticket_id,author,body) values(${id},'user','старые фото') returning id`;for(let j=0;j<(i===9?2:3);j++)await sql()`insert into support_attachments(message_id,name,mime,data,size,width,height,position) values(${next.id},'photo.jpg','image/jpeg',${bytes},${bytes.length},240,360,${j})`;}
 const before=await count('support_messages');const r=await Promise.all([call('POST',`/support/tickets/${id}/messages`,token,{photos:[photo()]}),call('POST',`/support/tickets/${id}/messages`,token,{photos:[photo()]})]);expect(r.map(x=>x.statusCode).sort()).toEqual([200,409]);expect(await count('support_attachments')).toBe(30);expect(await count('support_messages')).toBe(before+1);
});
it('deleting a user removes support photos and invalidates old attachment IDs',async()=>{
 const id=await ticket([photo()]);const p=(await thread(id)).messages.find((m:any)=>m.author==='user').attachments[0].id;await sql()`delete from users where id=${userId}`;expect(await count('support_attachments')).toBe(0);expect((await call('GET','/admin/support/attachments/'+p,admin)).statusCode).toBe(404);
});
it('text-only conversations stay compatible and a failed bot delivery does not lose a photo reply',async()=>{
 const id=await ticket();expect((await thread(id)).messages[0].attachments).toEqual([]);mocks.tg.state.blocked.add(4701);
 const reply=await call('POST',`/admin/support/tickets/${id}/reply`,admin,{text:'Посмотрите инструкцию',photos:[photo()]});expect(reply.statusCode).toBe(200);expect(reply.json().notified).toBe(false);expect((await thread(id)).messages.find((m:any)=>m.author==='admin').attachments).toHaveLength(1);
});

it('keeps a dense camera image below the storage limit after normalization and supports WebP input',async()=>{
 const dense=await sharp(randomBytes(2048*2048*3),{raw:{width:2048,height:2048,channels:3}}).jpeg({quality:55}).toBuffer();expect(dense.length).toBeLessThan(2*1024*1024);
 const webp=await sharp(png).webp().toBuffer();const id=await ticket([photo(dense,'jpeg'),photo(webp,'webp')]);const t=await thread(id);const photos=t.messages.find((m:any)=>m.author==='user').attachments;expect(photos).toHaveLength(2);expect(photos.every((p:any)=>p.mime==='image/jpeg'&&p.size<=2*1024*1024)).toBe(true);
});
