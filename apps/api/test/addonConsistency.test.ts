import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {sql,closeDb} from '../src/db/index.js';
import {migrate} from '../src/db/migrate.js';
import {buildApp} from '../src/app.js';
import {signAdminToken} from '../src/lib/jwt.js';
import {upsertTelegramUser} from '../src/services/users.js';
import {addonCatalog,assertCanBuyAddon,applyAddon,getAddon} from '../src/services/addons.js';
import {clearSettingsCache} from '../src/services/settings.js';
let n=93000;
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();});
beforeEach(async()=>{await sql()`truncate users,admins,settings,locations,addon_products cascade`;clearSettingsCache();});
afterAll(async()=>{await closeDb();for(const m of Object.values((globalThis as any).__mocks) as any[])m.server.close();});
async function fixture(devices=0,traffic=0){const u=await upsertTelegramUser({id:n++});await sql()`insert into subscriptions(user_id,expires_at,device_limit,traffic_limit_bytes) values(${u.id},now()+interval '20 days',${devices},${traffic})`;const [d]=await sql()`insert into addon_products(kind,name,qty,price) values('devices','Extra device',1,5000) returning id`;return {u,d:await getAddon(d!.id)};}
it('exposes the same device restriction in catalog and checkout',async()=>{const {u,d}=await fixture();const cat=await addonCatalog(u);expect(cat.products[0]!.available).toBe(false);expect(cat.products[0]!.unavailableReason).toContain('не ограничено');await expect(assertCanBuyAddon(u.id,d)).rejects.toThrow('не ограничено');});
it('does not silently issue an already paid device after the plan becomes unlimited',async()=>{const {u}=await fixture();await expect(sql().begin(tx=>applyAddon(tx,u.id,{kind:'devices',qty:1}))).rejects.toThrow('не ограничено');expect((await sql()`select extra_devices from subscriptions where user_id=${u.id}`)[0]!.extra_devices).toBe(0);});
it('allows devices on a limited device plan and blocks expired subscription consistently',async()=>{const {u,d}=await fixture(3);expect((await addonCatalog(u)).products[0]!.available).toBe(true);await assertCanBuyAddon(u.id,d);await sql()`update subscriptions set expires_at=now()-interval '1 hour' where user_id=${u.id}`;expect((await addonCatalog(u)).products[0]!.available).toBe(false);await expect(assertCanBuyAddon(u.id,d)).rejects.toThrow('продлите');});
it('marks a timed location unavailable when already owned permanently',async()=>{const {u}=await fixture(3);const [loc]=await sql()`insert into locations(name,squad_uuid) values('Test','11111111-1111-4111-8111-111111111111') returning id`;await sql()`insert into addon_products(kind,name,qty,price,location_id,duration_days) values('location','Location',1,5000,${loc!.id},30)`;await sql()`insert into user_locations(user_id,location_id,expires_at) values(${u.id},${loc!.id},'9999-12-31')`;const p=(await addonCatalog(u)).products.find(p=>p.kind==='location')!;expect(p.available).toBe(false);expect(p.unavailableReason).toContain('бессрочно');});
it('admin validates unsupported durations, protects issued locations, and filters order fulfillment',async()=>{const {u,d}=await fixture(3);const [a]=await sql()`insert into admins(email,password_hash,role) values('addon@test','unused','owner') returning id`;const headers={authorization:'Bearer '+await signAdminToken(a!.id,'owner')};const app=await buildApp({logger:false});try{
 expect((await app.inject({method:'POST',url:'/api/v1/admin/addons',headers,payload:{kind:'traffic',name:'30 days',qty:10,price:5000,durationDays:30}})).statusCode).toBe(400);
 const [loc]=await sql()`insert into locations(name,squad_uuid) values('Test','11111111-1111-4111-8111-111111111111') returning id`;await sql()`insert into user_locations(user_id,location_id,expires_at) values(${u.id},${loc!.id},now()+interval '1 day')`;
 expect((await app.inject({method:'DELETE',url:'/api/v1/admin/locations/'+loc!.id,headers})).statusCode).toBe(409);
 await sql()`insert into payments(user_id,provider,purpose,amount,status,payload,fulfilled_at) values(${u.id},'balance','addon',5000,'succeeded',${sql().json({addon:{id:d.id,kind:'devices',qty:1}})},now()),(${u.id},'balance','addon',5000,'succeeded',${sql().json({addon:{id:d.id,kind:'devices',qty:1}})},null)`;
 const issued=await app.inject({method:'GET',url:'/api/v1/admin/addon-orders?state=issued',headers});expect(issued.statusCode).toBe(200);expect(issued.json().total).toBe(1);
 expect((await app.inject({method:'GET',url:'/api/v1/admin/addon-orders?state=unfulfilled',headers})).json().total).toBe(1);
 expect((await app.inject({method:'GET',url:'/api/v1/admin/addons',headers})).json()[0].sold).toBe(1);
 expect((await app.inject({method:'GET',url:'/api/v1/admin/addon-orders'})).statusCode).toBe(401);
 }finally{await app.close();}});
