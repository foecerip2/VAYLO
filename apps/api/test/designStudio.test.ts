import {afterAll,beforeAll,beforeEach,it,expect} from 'vitest';
import {DESIGN_CONCEPTS,DESIGN_CONCEPT_IDS} from '@vpn/shared';
import {sql,closeDb} from '../src/db/index.js';
import {migrate} from '../src/db/migrate.js';
import {getSettings,setSettings,clearSettingsCache} from '../src/services/settings.js';
import {buildApp} from '../src/app.js';
import {signAdminToken} from '../src/lib/jwt.js';
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();});
beforeEach(async()=>{await sql()`truncate settings,admins cascade`;clearSettingsCache();});
afterAll(async()=>{await closeDb();for(const m of Object.values((globalThis as any).__mocks) as any[])m.server.close();});
it('legacy appearance settings remain usable and selected concepts preserve branding',async()=>{
 await setSettings('appearance',{accent:'#ab7733',banner_text:'Объявление',logo_url:'https://example.test/logo.png'});
 expect((await getSettings('appearance')).design_shortlist).toEqual([]);
 await setSettings('appearance',{design_shortlist:['arctic-glass','monolith']});clearSettingsCache();
 expect(await getSettings('appearance')).toMatchObject({accent:'#ab7733',banner_text:'Объявление',logo_url:'https://example.test/logo.png',design_shortlist:['arctic-glass','monolith']});
});
it('rejects unknown or duplicate concept IDs and supports clearing the saved selection',async()=>{
 await expect(setSettings('appearance',{design_shortlist:['unknown-design']})).rejects.toThrow();
 await expect(setSettings('appearance',{design_shortlist:['monolith','monolith']})).rejects.toThrow();
 await setSettings('appearance',{design_shortlist:[...DESIGN_CONCEPT_IDS]});expect((await getSettings('appearance')).design_shortlist).toHaveLength(6);
 await setSettings('appearance',{design_shortlist:[]});expect((await getSettings('appearance')).design_shortlist).toEqual([]);
 expect(new Set(DESIGN_CONCEPTS.map(d=>d.code)).size).toBe(6);
});
it('only owner can save a shortlist and concepts do not activate runtime themes',async()=>{
 const [owner]=await sql()`insert into admins(email,password_hash,role) values('design-owner@test','unused','owner') returning id`;
 const [admin]=await sql()`insert into admins(email,password_hash,role) values('design-admin@test','unused','admin') returning id`;
 const app=await buildApp({logger:false});try{
 const url='/api/v1/admin/settings/appearance',payload={design_shortlist:['noir-gold','arctic-glass']};
 expect((await app.inject({method:'PUT',url,payload})).statusCode).toBe(401);
 expect((await app.inject({method:'PUT',url,payload,headers:{authorization:'Bearer '+await signAdminToken(admin.id,'admin')}})).statusCode).toBe(403);
 const saved=await app.inject({method:'PUT',url,payload,headers:{authorization:'Bearer '+await signAdminToken(owner.id,'owner')}});expect(saved.statusCode).toBe(200);expect(saved.json().design_shortlist).toEqual(payload.design_shortlist);
 const read=await app.inject({method:'GET',url:'/api/v1/admin/settings',headers:{authorization:'Bearer '+await signAdminToken(admin.id,'admin')}});expect(read.statusCode).toBe(200);expect(read.json().settings.appearance.design_shortlist).toEqual(payload.design_shortlist);
 const config=await app.inject({method:'GET',url:'/api/v1/config'});expect(config.statusCode).toBe(200);expect(config.json().appearance).not.toHaveProperty('design_shortlist');expect(config.json().appearance.design).toBe('orbit-signature');
 const bad=await app.inject({method:'PUT',url,payload:{design_shortlist:['unpublished']},headers:{authorization:'Bearer '+await signAdminToken(owner.id,'owner')}});expect(bad.statusCode).toBe(400);
 }finally{await app.close();}
});

it('publishes only implemented A and C designs and preserves the selected design on partial updates', async () => {
 const [owner] = await sql()`insert into admins(email,password_hash,role) values('theme-owner@test','unused','owner') returning id`;
 const [admin] = await sql()`insert into admins(email,password_hash,role) values('theme-admin@test','unused','admin') returning id`;
 const app = await buildApp({logger:false});
 try {
  const url='/api/v1/admin/settings/appearance';
  const ownerHeaders={authorization:'Bearer '+await signAdminToken(owner.id,'owner')};
  expect((await getSettings('appearance')).miniapp_design).toBe('orbit-signature');
  expect((await app.inject({method:'PUT',url,payload:{miniapp_design:'arctic-glass'}})).statusCode).toBe(401);
  expect((await app.inject({method:'PUT',url,payload:{miniapp_design:'arctic-glass'},headers:{authorization:'Bearer '+await signAdminToken(admin.id,'admin')}})).statusCode).toBe(403);
  for(const design of ['arctic-glass','orbit-signature']) {
   const saved=await app.inject({method:'PUT',url,payload:{miniapp_design:design},headers:ownerHeaders});
   expect(saved.statusCode).toBe(200);expect(saved.json().miniapp_design).toBe(design);
   clearSettingsCache();
   const config=await app.inject({method:'GET',url:'/api/v1/config'});
   expect(config.statusCode).toBe(200);expect(config.json().appearance.design).toBe(design);
   expect(config.json().appearance).not.toHaveProperty('design_shortlist');
  }
  await setSettings('appearance',{miniapp_design:'arctic-glass'});
  await setSettings('appearance',{banner_text:'Новый баннер'});
  expect((await getSettings('appearance')).miniapp_design).toBe('arctic-glass');
  for(const bad of ['noir-gold','monolith','unknown','',null,{},true]) {
   expect((await app.inject({method:'PUT',url,payload:{miniapp_design:bad},headers:ownerHeaders})).statusCode).toBe(400);
   expect((await getSettings('appearance')).miniapp_design).toBe('arctic-glass');
  }
 } finally { await app.close(); }
});
