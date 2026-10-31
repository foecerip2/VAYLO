import { adminUserLte } from '../src/services/adminUserLte.js';
import { lteActivity, lteActivityHistory, type LteActivityQuery } from '../src/services/lteActivity.js';
import * as lteService from '../src/services/lte.js';
import {buildApp} from '../src/app.js';
import {signAdminToken,signUserToken} from '../src/lib/jwt.js';
import { addonCatalog,getAddon } from '../src/services/addons.js';
import {readFileSync} from 'node:fs';
import { squadsFor } from '../src/services/subscriptions.js';
import { remnawave } from '../src/services/remnawave.js';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
import {config,resetConfigForTests} from '../src/config.js';
import {sql,closeDb} from '../src/db/index.js';
import {migrate} from '../src/db/migrate.js';
import {lteQuota,grantLte,syncLteMember,closeLte} from '../src/services/lte.js';
import {saveAvatar,avatarData} from '../src/services/avatars.js';
import {upsertTelegramUser} from '../src/services/users.js';
const GB=1024**3;let rw:ReturnType<typeof postgres>;
beforeAll(async()=>{
 const base=new URL(process.env.DATABASE_URL!);const admin=postgres(base.toString());const [exists]=await admin`select 1 from pg_database where datname='vaylo_lte_unit'`;if(!exists)await admin.unsafe('create database vaylo_lte_unit');await admin.end();
 base.pathname='/vaylo_lte_unit';process.env.LTE_DATABASE_URL=base.toString();resetConfigForTests();rw=postgres(base.toString());
 await rw.unsafe(`drop schema public cascade;create schema public;
 create table users(id bigint primary key,username text,status text);
 create table internal_squads(uuid uuid primary key,name text);
 create table internal_squad_members(internal_squad_uuid uuid,user_id bigint,primary key(internal_squad_uuid,user_id));
 create table nodes_user_usage_history(user_id bigint,node_id int,total_bytes bigint,created_at timestamptz default greatest(now(),'2026-10-26'::timestamptz),updated_at timestamp default (now() at time zone 'UTC'));
 create table vaylo_lte_extra(user_id bigint,bytes bigint,granted_on date default current_date);
 create table vaylo_lte_optout(user_id bigint primary key);
 create table vaylo_lte_orders(payment_id uuid primary key,user_id bigint,bytes bigint,granted_on date);`);
 await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();
});
beforeEach(async()=>{vi.restoreAllMocks();await rw`truncate users,internal_squads,internal_squad_members,nodes_user_usage_history,vaylo_lte_extra,vaylo_lte_optout,vaylo_lte_orders`;await rw`insert into users values(1,'tg_1','ACTIVE')`;await rw`insert into internal_squads values('11111111-1111-4111-8111-111111111111','LTE')`;});
afterAll(async()=>{await closeLte();await rw.end();await closeDb();delete process.env.LTE_DATABASE_URL;delete process.env.LTE_ACTIVITY_START_DATE;resetConfigForTests();for(const m of Object.values((globalThis as any).__mocks) as any[])m.server.close();});
it('counts only LTE node traffic in the rolling window, not other nodes or old history',async()=>{await rw`insert into nodes_user_usage_history(user_id,node_id,total_bytes,created_at) values(1,2,${GB},greatest(now(),'2026-10-26'::timestamptz)),(1,3,${20*GB},greatest(now(),'2026-10-26'::timestamptz)),(1,2,${30*GB},now()-interval '40 days')`;const q=await lteQuota(1);expect(q!.remainingBytes).toBe(4*GB);expect(q!.limitBytes).toBe(5*GB);});
it('grants LTE once per payment, restores group and does not touch total traffic',async()=>{await rw`insert into nodes_user_usage_history(user_id,node_id,total_bytes) values(1,2,${6*GB})`;await syncLteMember(1);expect(await rw`select * from internal_squad_members`).toHaveLength(0);const id=randomUUID();await grantLte(id,1,2);await grantLte(id,1,2);expect((await lteQuota(1))!.remainingBytes).toBe(GB);expect(await rw`select * from vaylo_lte_extra`).toHaveLength(1);expect(await rw`select * from internal_squad_members`).toHaveLength(1);});
it('drops expired topups and removes the LTE group again',async()=>{await rw`insert into nodes_user_usage_history(user_id,node_id,total_bytes) values(1,2,${6*GB})`;await grantLte(randomUUID(),1,10);await rw`update vaylo_lte_extra set granted_on=current_date-30`;await syncLteMember(1);expect((await lteQuota(1))!.extraBytes).toBe(0);expect(await rw`select * from internal_squad_members`).toHaveLength(0);});
it('does not restore opted-out users and refuses their purchases',async()=>{await syncLteMember(1);await rw`insert into vaylo_lte_optout values(1)`;await syncLteMember(1);expect(await rw`select * from internal_squad_members`).toHaveLength(0);await expect(grantLte(randomUUID(),1,5)).rejects.toThrow('отключён');expect(await rw`select * from vaylo_lte_extra`).toHaveLength(0);});
it('removes LTE for inactive users independently of remaining traffic',async()=>{await syncLteMember(1);await rw`update users set status='DISABLED'`;await syncLteMember(1);expect(await rw`select * from internal_squad_members`).toHaveLength(0);});
it('finds a profile by username before its remote ID was linked locally',async()=>{expect((await lteQuota(null,'tg_1'))!.rwId).toBe(1);expect(await lteQuota(null,'missing')).toBeNull();});
it('validates avatar formats and rotates the media token on replacement',async()=>{const u=await upsertTelegramUser({id:555000});await expect(saveAvatar(u.id,'data:image/svg+xml;base64,PHN2Zz4=')).rejects.toThrow();const png=Buffer.from('89504e470d0a1a0a0000000049454e44','hex');await saveAvatar(u.id,'data:image/png;base64,'+png.toString('base64'));const old=await avatarData(u.id);await saveAvatar(u.id,'data:image/png;base64,'+png.toString('base64'));expect(await avatarData(u.id)).not.toBe(old);await expect(saveAvatar(u.id,'data:image/png;base64,'+Buffer.alloc(600000).toString('base64'))).rejects.toThrow();});

it('does not restore exhausted LTE while building squads for subscription renewal',async()=>{
 const u=await upsertTelegramUser({id:555111});await sql()`update users set rw_id=1,rw_username='tg_1' where id=${u.id}`;
 vi.spyOn(remnawave,'getSquadUuid').mockResolvedValue('22222222-2222-4222-8222-222222222222');
 await rw`insert into nodes_user_usage_history(user_id,node_id,total_bytes) values(1,2,${6*GB})`;
 const groups=await squadsFor(sql(),u.id);expect(groups).toEqual(['22222222-2222-4222-8222-222222222222']);
 await grantLte(randomUUID(),1,2);expect(await squadsFor(sql(),u.id)).toContain('11111111-1111-4111-8111-111111111111');
});

it('LTE catalog hides legacy traffic/location products and blocks their old checkout links',async()=>{
 const u=await upsertTelegramUser({id:555112});await sql()`insert into subscriptions(user_id,expires_at,device_limit) values(${u.id},now()+interval '10 days',3)`;
 const [loc]=await sql()`insert into locations(name,squad_uuid) values('Legacy','33333333-3333-4333-8333-333333333333') returning id`;
 const rows=await sql()`insert into addon_products(kind,name,qty,price,location_id) values('traffic','Legacy traffic',10,5000,null),('location','Legacy location',10,5000,${loc!.id}),('devices','Device',1,5000,null),('lte','LTE',10,5000,null) returning id,kind`;
 const catalog=await addonCatalog(u);expect(catalog.products.map(p=>p.kind).sort()).toEqual(['devices','lte']);
 for(const a of rows.filter(r=>['traffic','location'].includes(r.kind)))await expect(getAddon(a.id)).rejects.toThrow('снят с продажи');
});
it('migrates an explicitly LTE-named traffic product without changing its price, ID, quantity or pending order snapshot',async()=>{
 const u=await upsertTelegramUser({id:555113});const [product]=await sql()`insert into addon_products(kind,name,qty,price) values('traffic','LTE 🇷🇺 | БС',100,5000) returning id`;
 const [other]=await sql()`insert into addon_products(kind,name,qty,price) values('traffic','General traffic',20,9900) returning id`;
 const [pay]=await sql()`insert into payments(user_id,provider,purpose,status,amount,payload) values(${u.id},'yookassa','addon','pending',5000,${sql().json({addon:{id:product!.id,kind:'traffic',qty:100}})}) returning id`;
 const migration=readFileSync(new URL('../migrations/017_lte_catalog.sql',import.meta.url),'utf8');await sql().unsafe(migration);await sql().unsafe(migration);
 const [changed]=await sql()`select * from addon_products where id=${product!.id}`;expect(changed).toMatchObject({kind:'lte',qty:100,price:5000,duration_days:30});
 expect((await sql()`select kind from addon_products where id=${other!.id}`)[0]!.kind).toBe('traffic');
 expect((await sql()`select payload from payments where id=${pay!.id}`)[0]!.payload.addon.kind).toBe('traffic');
 expect(await sql()`select id from audit_log where entity_id=${product!.id} and action='addon.migrate-lte'`).toHaveLength(1);
});

it('admin user LTE combines scoped orders, deduplicated manual grants and real counter packages',async()=>{
 const u=await upsertTelegramUser({id:555120});await sql()`update users set rw_id=null where rw_id=1`;await sql()`update users set rw_id=1 where id=${u.id}`;
 await rw`insert into nodes_user_usage_history(user_id,node_id,total_bytes) values(1,2,${2*GB})`;
 await rw`insert into vaylo_lte_extra(user_id,bytes,granted_on) values(1,${GB},current_date),(1,${2*GB},current_date),(1,${5*GB},current_date-40)`;
 await syncLteMember(1);
 await sql()`insert into payments(user_id,provider,purpose,amount,status,payload) values(${u.id},'balance','addon',5000,'succeeded',${sql().json({addon:{kind:'lte',qty:10}})}),(${u.id},'balance','addon',9999,'succeeded',${sql().json({addon:{kind:'traffic',qty:100}})})`;
 const manualId=randomUUID();for(let i=0;i<2;i++)await sql()`insert into audit_log(admin_email,action,entity_id,data) values('staff@test','lte.manual-grant',${manualId},${sql().json({tgId:555120,qty:3,reason:'Compensation'})})`;
 const d=await adminUserLte(u.id);expect(d.state).toBe('ready');expect(d.quota).toMatchObject({usedBytes:2*GB,limitBytes:8*GB,extraBytes:3*GB,remainingBytes:6*GB,inSquad:true});
 expect(d.orders.total).toBe(2);expect(d.orders.items.filter(r=>r.source==='manual')).toHaveLength(1);expect(d.orders.items.find(r=>r.source==='purchase')!.fulfilled_at).toBeNull();
 expect(d.packages!.total).toBe(2);expect(d.packages!.items[0]).toMatchObject({bytes:3*GB,grants:2,active:true});expect(d.packages!.items[1]!.active).toBe(false);
});
it('user LTE history is paginated and survives a counter outage without fabricated zeroes',async()=>{
 const u=await upsertTelegramUser({id:555121});for(let i=0;i<21;i++)await sql()`insert into payments(user_id,provider,purpose,amount,status,payload) values(${u.id},'balance','addon',5000,'succeeded',${sql().json({addon:{kind:'lte',qty:1}})})`;
 vi.spyOn(lteService,'lteQuota').mockRejectedValue(new Error('secret host and password must not leak'));
 const d=await adminUserLte(u.id,3);expect(d.state).toBe('unavailable');expect(d.quota).toBeNull();expect(d.orders.total).toBe(21);expect(d.orders.items).toHaveLength(1);expect(JSON.stringify(d)).not.toContain('secret host');
});
it('user LTE endpoint requires admin access and does not expose another customer history',async()=>{
 const u=await upsertTelegramUser({id:555122}),other=await upsertTelegramUser({id:555123});await sql()`insert into payments(user_id,provider,purpose,amount,status,payload) values(${other.id},'balance','addon',5000,'succeeded',${sql().json({addon:{kind:'lte',qty:77}})})`;
 const [admin]=await sql()`insert into admins(email,password_hash,role) values('user-lte@test','unused','analyst') returning id`;
 const app=await buildApp({logger:false});try{
 const url='/api/v1/admin/users/'+u.id+'/lte';expect((await app.inject({method:'GET',url})).statusCode).toBe(401);
 expect((await app.inject({method:'GET',url,headers:{authorization:'Bearer '+await signUserToken(u.id)}})).statusCode).toBe(401);
 const headers={authorization:'Bearer '+await signAdminToken(admin!.id,'analyst')};const response=await app.inject({method:'GET',url,headers});expect(response.statusCode).toBe(200);expect(response.json().orders.total).toBe(0);
 expect((await app.inject({method:'GET',url:url+'?page=0',headers})).statusCode).toBe(400);
 expect((await app.inject({method:'GET',url:'/api/v1/admin/users/'+randomUUID()+'/lte',headers})).statusCode).toBe(404);
 }finally{await app.close();}
});

const activityQuery: LteActivityQuery = { days: 7, page: 1, limit: 25, q: '', mode: 'history' };
async function activityFixture() {
 process.env.LTE_ACTIVITY_START_DATE='2026-09-01';resetConfigForTests();
 await sql()`update users set rw_id=null where rw_id in(1,2,3)`;
 const local=await upsertTelegramUser({id:555201,first_name:'Мария',username:'maria_lte'});
 await sql()`update users set rw_id=1 where id=${local.id}`;
 await rw`insert into users values(2,'remote_only','ACTIVE'),(3,'group_only','ACTIVE')`;
 await rw`insert into internal_squad_members values('11111111-1111-4111-8111-111111111111',3)`;
 // The first user has recent traffic even without LTE membership. The second only used LTE in the past.
 await rw`insert into nodes_user_usage_history(user_id,node_id,total_bytes,created_at,updated_at) values
 (1,2,${GB},current_date,now() at time zone 'UTC'-interval '45 seconds'),
 (1,2,${2*GB},current_date-1,now() at time zone 'UTC'-interval '1 day'),
 (1,3,${50*GB},current_date,now() at time zone 'UTC'),
 (2,2,${3*GB},current_date-2,now() at time zone 'UTC'-interval '2 days'),
 (3,2,0,current_date,now() at time zone 'UTC')`;
 return local;
}
it('LTE activity isolates the LTE node, distinguishes recent traffic from access, and maps local or external users',async()=>{
 const local=await activityFixture();const d=await lteActivity(activityQuery);
 expect(d.state).toBe('ready');expect(d.precision).toBe('updated-at');expect(d.stats).toEqual({activeUsers:1,periodUsers:2,periodBytes:6*GB});expect(d.total).toBe(2);
 expect(d.items[0]).toMatchObject({rwId:1,localUserId:local.id,name:'Мария',tgId:555201,active:true,inSquad:false,periodBytes:3*GB,daysUsed:2});
 expect(d.items[1]).toMatchObject({rwId:2,localUserId:null,active:false,periodBytes:3*GB});
 const live=await lteActivity({...activityQuery,mode:'active'});expect(live.items.map(u=>u.rwId)).toEqual([1]);expect(live.activeWindowSeconds).toBe(300);
});
it('LTE search supports local name, Telegram ID, UUID, escaped literal username and remote ID; pages retain totals',async()=>{
 const local=await activityFixture();
 for(const q of ['Мария','555201',local.id,'@maria_lte','1']){const d=await lteActivity({...activityQuery,q});expect(d.total).toBe(1);expect(d.items[0].localUserId).toBe(local.id);}
 const remote=await lteActivity({...activityQuery,q:'remote_only'});expect(remote.items.map(v=>v.rwId)).toEqual([2]);
 expect((await lteActivity({...activityQuery,q:'remote%'})).total).toBe(0);
 const page=await lteActivity({...activityQuery,limit:1,page:2});expect(page.total).toBe(2);expect(page.items.map(v=>v.rwId)).toEqual([2]);expect(page.stats!.periodUsers).toBe(2);
 const empty=await lteActivity({...activityQuery,page:50});expect(empty.total).toBe(2);expect(empty.items).toEqual([]);
});
it('LTE history exposes real daily sums and last update, rather than invented session start times',async()=>{
 await activityFixture();const d=await lteActivityHistory(1,{days:7,page:1,limit:1});expect(d.state).toBe('ready');expect(d.total).toBe(2);expect(d.items).toHaveLength(1);expect(d.items[0].bytes).toBe(GB);expect(d.items[0].lastSeenAt).not.toBeNull();expect(d.user!.periodBytes).toBe(3*GB);
 const next=await lteActivityHistory(1,{days:7,page:2,limit:1});expect(next.items[0].bytes).toBe(2*GB);
 expect((await lteActivityHistory(999999,{days:7,page:1,limit:25})).items).toEqual([]);
});
it('LTE history respects its start date and selected period, excluding pre-LTE and future activity',async()=>{
 await activityFixture();const [date]=await rw`select current_date::text as day`;
 process.env.LTE_ACTIVITY_START_DATE=date.day;resetConfigForTests();
 await rw`insert into nodes_user_usage_history(user_id,node_id,total_bytes,created_at,updated_at) values(2,2,${9*GB},current_date+1,now() at time zone 'UTC')`;
 const d=await lteActivity({...activityQuery,days:90});expect(d.from).toBe(date.day);expect(d.stats).toEqual({activeUsers:1,periodUsers:1,periodBytes:GB});
 process.env.LTE_ACTIVITY_START_DATE='2026-09-01';resetConfigForTests();
 const today=await lteActivity({...activityQuery,days:1});expect(today.stats!.periodBytes).toBe(GB);
});
it('unknown timestamps never become online users; unavailable sources never become zero activity',async()=>{
 await activityFixture();await rw`alter table nodes_user_usage_history drop column updated_at`;
 try{
  const d=await lteActivity(activityQuery);expect(d.state).toBe('ready');expect(d.precision).toBe('day');expect(d.stats!.activeUsers).toBeNull();expect(d.items.every(u=>u.active===null&&u.lastSeenAt===null)).toBe(true);
  expect((await lteActivity({...activityQuery,mode:'active'})).total).toBe(0);
 }finally{await rw`alter table nodes_user_usage_history add column updated_at timestamp default (now() at time zone 'UTC')`;}
 vi.spyOn(lteService,'lteDb').mockImplementation(()=>{throw new Error('postgres://secret-user:secret-password@secret-host');});
 const bad=await lteActivity(activityQuery);expect(bad.state).toBe('unavailable');expect(bad.stats).toBeNull();expect(bad.checkedAt).toBeNull();expect(JSON.stringify(bad)).not.toContain('secret');
 const history=await lteActivityHistory(1,{days:7,page:1,limit:25});expect(history.state).toBe('unavailable');expect(history.user).toBeNull();
});
it('disabled LTE is explicit and a future clock timestamp does not count as recent activity',async()=>{
 await activityFixture();await rw`update nodes_user_usage_history set updated_at=(now() at time zone 'UTC')+interval '1 hour' where user_id=1 and node_id=2`;
 expect((await lteActivity({...activityQuery,mode:'active'})).total).toBe(0);
 const old=process.env.LTE_DATABASE_URL;process.env.LTE_DATABASE_URL='';resetConfigForTests();
 try{const d=await lteActivity(activityQuery);expect(d.state).toBe('disabled');expect(d.stats).toBeNull();}finally{process.env.LTE_DATABASE_URL=old;resetConfigForTests();}
});
it('LTE activity endpoints require admin access and validate IDs, period, pagination, search and mode',async()=>{
 await activityFixture();const local=await upsertTelegramUser({id:555202});
 const [admin]=await sql()`insert into admins(email,password_hash,role) values('lte-activity@test','unused','analyst') returning id`;
 const app=await buildApp({logger:false});try{
 for(const url of ['/api/v1/admin/lte-activity','/api/v1/admin/lte-activity/1']){
  expect((await app.inject({method:'GET',url})).statusCode).toBe(401);
  expect((await app.inject({method:'GET',url,headers:{authorization:'Bearer '+await signUserToken(local.id)}})).statusCode).toBe(401);
 }
 const headers={authorization:'Bearer '+await signAdminToken(admin!.id,'analyst')};
 const d=await app.inject({method:'GET',url:'/api/v1/admin/lte-activity?mode=history',headers});expect(d.statusCode).toBe(200);expect(d.json().stats.periodUsers).toBe(2);
 const detail=await app.inject({method:'GET',url:'/api/v1/admin/lte-activity/1',headers});expect(detail.statusCode).toBe(200);expect(detail.json().total).toBe(2);
 for(const suffix of ['?days=0','?days=91','?page=0','?limit=101','?mode=all','?q='+'a'.repeat(101),'/abc','/0'])expect((await app.inject({method:'GET',url:'/api/v1/admin/lte-activity'+suffix,headers})).statusCode).toBe(400);
 }finally{await app.close();}
});
