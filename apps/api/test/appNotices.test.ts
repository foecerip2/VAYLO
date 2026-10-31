import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {sql,closeDb} from '../src/db/index.js';
import {migrate} from '../src/db/migrate.js';
import {setSettings,clearSettingsCache} from '../src/services/settings.js';
import {appNoticeDraft} from '../src/services/appNotices.js';
import {buildApp} from '../src/app.js';
import {signAdminToken} from '../src/lib/jwt.js';
const M=(globalThis as any).__mocks;
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();});
beforeEach(async()=>{await sql()`truncate settings,admins,broadcasts cascade`;clearSettingsCache();M.tg.state.messages.length=0;M.tg.state.blocked.clear();});
afterAll(async()=>{await closeDb();for(const m of Object.values(M) as any[])m.server.close();});
it('keeps iOS and Android statuses separate and escapes administrator notes',async()=>{
 await setSettings('client_apps',{entries:[{id:'happ',os:'ios',status:'removed',note:'RU <&>',recommended:false},{id:'happ',os:'android',status:'available',note:'',recommended:true},{id:'karing',os:'ios',status:'regional',note:'',recommended:true}]});
 const d=await appNoticeDraft({os:'ios',affected:['happ'],alternative:'karing'});expect(d.text).toContain('Недоступно в магазине');expect(d.text).toContain('RU &lt;&amp;&gt;');expect(d.text).toContain('зависит от региона');expect(d.buttonUrl).toContain('os=ios&client=karing');
 const android=await appNoticeDraft({os:'android',affected:['happ'],alternative:'happ'});expect(android.text).toContain('Доступно');expect(android.text).not.toContain('Недоступно в магазине');
 expect(await sql()`select * from broadcasts`).toHaveLength(0);expect(M.tg.state.messages).toHaveLength(0);
});
it('does not assert removal when status has not been verified',async()=>{const d=await appNoticeDraft({os:'ios',affected:['happ','incy'],alternative:'karing'});expect(d.text).toContain('Не проверено');expect(d.text).not.toContain('Недоступно в магазине');expect(d.text).toContain('наличие в магазине ещё не проверено');});
it('rejects recommending a removed app and duplicate settings',async()=>{
 await expect(setSettings('client_apps',{entries:[{id:'happ',os:'ios',status:'removed',recommended:true}]})).rejects.toThrow();
 await expect(setSettings('client_apps',{entries:[{id:'happ',os:'ios'},{id:'happ',os:'ios'}]})).rejects.toThrow();
 await setSettings('client_apps',{entries:[{id:'karing',os:'ios',status:'removed'}]});await expect(appNoticeDraft({os:'ios',affected:['happ'],alternative:'karing'})).rejects.toThrow();
 await expect(appNoticeDraft({os:'android',affected:['happ'],alternative:'streisand'})).rejects.toThrow();
});
it('publishes saved policies, protects draft creation and tests the actual button without broadcasting',async()=>{
 const [a]=await sql()`insert into admins(email,password_hash,role,tg_id) values('owner@notice.test','unused','owner',123456) returning id`;
 const [s]=await sql()`insert into admins(email,password_hash,role) values('support@notice.test','unused','support') returning id`;
 const owner={authorization:'Bearer '+await signAdminToken(a!.id,'owner')},support={authorization:'Bearer '+await signAdminToken(s!.id,'support')};
 const app=await buildApp({logger:false});try{
  expect((await app.inject({method:'POST',url:'/api/v1/admin/broadcasts/app-notice',headers:support,payload:{os:'ios',affected:['happ'],alternative:'karing'}})).statusCode).toBe(403);
  await setSettings('client_apps',{entries:[{id:'karing',os:'ios',status:'available',recommended:true}]});
  const cfg=(await app.inject({method:'GET',url:'/api/v1/config'})).json();expect(cfg.clientApps[0].id).toBe('karing');
  const draft=(await app.inject({method:'POST',url:'/api/v1/admin/broadcasts/app-notice',headers:owner,payload:{os:'ios',affected:['happ'],alternative:'karing'}})).json();
  const test=await app.inject({method:'POST',url:'/api/v1/admin/broadcasts/test',headers:owner,payload:draft});expect(test.statusCode).toBe(200);expect(M.tg.state.messages[0].chat_id).toBe(123456);expect(JSON.stringify(M.tg.state.messages[0].reply_markup)).toContain('client=karing');
  expect(await sql()`select * from broadcasts`).toHaveLength(0);
  expect((await app.inject({method:'POST',url:'/api/v1/admin/broadcasts/test',headers:owner,payload:{text:'x',buttonText:'x',buttonUrl:'javascript:alert(1)'}})).statusCode).toBe(400);
 }finally{await app.close();}
});
it('prepares one combined notice with independently selected recommendations for both platforms',async()=>{
 await expect(appNoticeDraft({os:'all',affected:['happ'],alternative:'karing'})).rejects.toThrow();
 await setSettings('client_apps',{entries:[{id:'happ',os:'ios',status:'removed'},{id:'karing',os:'ios',status:'available',recommended:true},{id:'happ',os:'android',status:'available',recommended:true},{id:'incy',os:'android',status:'regional',recommended:true}]});
 const d=await appNoticeDraft({os:'all',affected:['happ'],alternative:'karing'});expect(d.text).toContain('iPhone / iPad');expect(d.text).toContain('Android');expect(d.text).toContain('Karing: Доступно · рекомендуем');expect(d.text).toContain('Happ: Доступно · рекомендуем');expect(d.text.length).toBeLessThan(3500);expect(d.buttonUrl.endsWith('/connect')).toBe(true);
});
