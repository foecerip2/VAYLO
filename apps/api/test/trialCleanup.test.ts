import {buildApp} from '../src/app.js';
import {signAdminToken} from '../src/lib/jwt.js';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {sql,closeDb} from '../src/db/index.js';
import {migrate} from '../src/db/migrate.js';
import {previewTrialCleanup,deleteExpiredTrial,executeTrialCleanup,deleteExpiredTrialVerified,trialCleanupCandidates,trialCleanupRegistry,verifyTrialCleanup} from '../src/services/trialCleanup.js';
import {startTrial,rwUsernameFor} from '../src/services/subscriptions.js';
import {createPayment} from '../src/services/payments.js';
import {yookassa} from '../src/services/yookassa.js';
import {signUserToken} from '../src/lib/jwt.js';
import {upsertTelegramUser,toMe} from '../src/services/users.js';
import {remnawave,RemnawaveError} from '../src/services/remnawave.js';
import {clearSettingsCache} from '../src/services/settings.js';
let next=90000;
beforeAll(async()=>{await sql()`drop schema public cascade`;await sql()`create schema public`;await migrate();});
beforeEach(async()=>{vi.restoreAllMocks();await sql()`truncate users,admins,plans,settings,trial_cleanup_runs,trial_cleanup_tombstones cascade`;clearSettingsCache();});
afterAll(async()=>{await closeDb();for(const m of Object.values((globalThis as any).__mocks) as any[])m.server.close();});
async function candidate(age=4){const u=await upsertTelegramUser({id:next++,first_name:'Trial'});await sql()`update users set trial_used=true where id=${u.id}`;await sql()`insert into subscriptions(user_id,is_trial,expires_at,plan_name) values(${u.id},true,now()-make_interval(days=>${age}),'Trial')`;return u;}
it('uses trial expiry, strictly older than three days, and preview deletes nothing',async()=>{const old=await candidate();await candidate(2);const p=await previewTrialCleanup(null);expect(p.items.map(u=>u.id)).toEqual([old.id]);expect((await sql()`select count(*)::int as n from users`)[0]!.n).toBe(2);});
it('protects paid, pending, balance, admin, gifts and nontrial subscriptions',async()=>{
 const keep=[];for(let i=0;i<6;i++)keep.push(await candidate());
 await sql()`insert into payments(user_id,provider,purpose,amount,status) values(${keep[0]!.id},'balance','plan',100,'succeeded'),(${keep[1]!.id},'yookassa','plan',100,'pending')`;
 await sql()`update users set balance=10 where id=${keep[2]!.id}`;
 await sql()`insert into admins(email,password_hash,tg_id) values('trial@test','unused',${keep[3]!.tg_id})`;
 await sql()`update subscriptions set is_trial=false,plan_name='1 месяц' where user_id=${keep[4]!.id}`;
 await sql()`insert into payments(user_id,provider,purpose,amount,status,external_id) values(${keep[5]!.id},'yookassa','plan',100,'canceled','late-settlement')`;
 await sql()`update payments set paid_at=now() where user_id=${keep[5]!.id}`;
 expect((await previewTrialCleanup(null)).batchSize).toBe(0);
});
it('rechecks the selected account after a subscription changes',async()=>{const u=await candidate();const p=await previewTrialCleanup(null);await sql()`update subscriptions set is_trial=false,plan_name='Paid' where user_id=${u.id}`;const result=await executeTrialCleanup(p.id,null);expect(result.results[0]).toMatchObject({id:u.id,status:'skipped'});expect((await sql()`select id from users where id=${u.id}`)).toHaveLength(1);});
it('removes local account but remembers used trial on re-registration',async()=>{const u=await candidate();expect(await deleteExpiredTrial(u.id)).toBe('deleted');const fresh=await upsertTelegramUser({id:u.tg_id!});expect(fresh.id).not.toBe(u.id);expect(fresh.trial_used).toBe(true);expect(fresh.signup_bonus_done).toBe(true);});
it('keeps the local account on a Remnawave failure; a remote 404 allows retry',async()=>{
 const u=await candidate();const remote=await remoteFor(u);const del=vi.spyOn(remnawave,'deleteUser').mockRejectedValue(new Error('network'));
 await expect(deleteExpiredTrial(u.id)).rejects.toThrow();expect(await sql()`select id from users where id=${u.id}`).toHaveLength(1);
 (globalThis as any).__mocks.rw.state.users.delete(remote.id);del.mockRejectedValue(new RemnawaveError('gone',404));
 expect(await deleteExpiredTrial(u.id)).toBe('deleted');
});

it('a run cannot be executed twice and expired previews cannot delete',async()=>{await candidate();const p=await previewTrialCleanup(null);await sql()`update trial_cleanup_runs set expires_at=now()-interval '1 second' where id=${p.id}`;await expect(executeTrialCleanup(p.id,null)).rejects.toThrow();const fresh=await previewTrialCleanup(null);await executeTrialCleanup(fresh.id,null);await expect(executeTrialCleanup(fresh.id,null)).rejects.toThrow();});

it('preserves trial recipients of gifts and open support cases',async()=>{
 const recipient=await candidate();const supported=await candidate();const buyer=await upsertTelegramUser({id:next++});
 const [p]=await sql()`insert into payments(user_id,provider,purpose,amount,status) values(${buyer.id},'balance','plan',100,'succeeded') returning id`;
 await sql()`insert into gifts(payment_id,buyer_id,code_hash,code_encrypted,plan,redeemed_by,redeemed_at) values(${p!.id},${buyer.id},'test-hash','test-encrypted','{}',${recipient.id},now())`;
 await sql()`insert into support_tickets(user_id,kind,subject,mode,status) values(${supported.id},'ticket','Help','human','open')`;
 expect((await previewTrialCleanup(null)).batchSize).toBe(0);
});

it('cleanup endpoints require admin access and explicit confirmation',async()=>{
 const app=await buildApp({logger:false});
 try{
  const [admin]=await sql()`insert into admins(email,password_hash,role) values('cleanup-admin@test','unused','admin') returning id`;
  const [analyst]=await sql()`insert into admins(email,password_hash,role) values('cleanup-analyst@test','unused','analyst') returning id`;
  const adminHeaders={authorization:'Bearer '+await signAdminToken(admin!.id,'admin')};
  const analystHeaders={authorization:'Bearer '+await signAdminToken(analyst!.id,'analyst')};
  expect((await app.inject({method:'POST',url:'/api/v1/admin/trial-cleanup/preview'})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/v1/admin/trial-cleanup/preview',headers:analystHeaders})).statusCode).toBe(403);
  const response=await app.inject({method:'POST',url:'/api/v1/admin/trial-cleanup/preview',headers:adminHeaders});expect(response.statusCode).toBe(200);
  expect((await app.inject({method:'POST',url:'/api/v1/admin/trial-cleanup/'+response.json().id+'/run',headers:adminHeaders,payload:{}})).statusCode).toBe(400);
 }finally{await app.close();}
});

async function remoteFor(u:Awaited<ReturnType<typeof candidate>>,opts:{username?:string;daysAgo?:number}={}){
 const remote=await remnawave.createUser({username:opts.username??rwUsernameFor(u),expireAt:new Date(Date.now()-(opts.daysAgo??4)*86400_000),trafficLimitBytes:0,hwidDeviceLimit:1,telegramId:u.tg_id});
 await sql()`update users set rw_id=${remote.id},rw_username=${remote.username},rw_short_uuid=${remote.shortUuid} where id=${u.id}`;
 return remote;
}
it('shows missing trial_used and labelled legacy trials, with exact reasons for exclusions and paging',async()=>{
 const missing=await candidate();await sql()`update users set trial_used=false where id=${missing.id}`;
 const legacy=await candidate();await sql()`update subscriptions set is_trial=false where user_id=${legacy.id}`;
 const waiting=await candidate(2);const balance=await candidate();await sql()`update users set balance=100 where id=${balance.id}`;
 const missingSub=await candidate();await sql()`delete from subscriptions where user_id=${missingSub.id}`;
 const eligible=await trialCleanupCandidates({q:'',filter:'eligible',page:1,limit:1});expect(eligible.total).toBe(2);expect(eligible.stats).toMatchObject({total:5,eligible:2,excluded:3});
 const all=await trialCleanupCandidates({q:'',filter:'all',page:1,limit:100});
 expect(all.items.find(r=>r.id===missing.id)!.eligible).toBe(true);expect(all.items.find(r=>r.id===legacy.id)!.eligible).toBe(true);
 expect(all.items.find(r=>r.id===waiting.id)!.reasons[0].code).toBe('grace');expect(all.items.find(r=>r.id===balance.id)!.reasons[0].code).toBe('balance');expect(all.items.find(r=>r.id===missingSub.id)!.reasons[0].code).toBe('no_subscription');
 expect((await trialCleanupCandidates({q:String(balance.tg_id),filter:'excluded',page:1,limit:25})).total).toBe(1);
});
it('cancelled and expired external orders are candidates but require a confirmed cancellation at the provider',async()=>{
 const u=await candidate();await sql()`insert into payments(user_id,provider,purpose,amount,status,external_id) values(${u.id},'yookassa','plan',19900,'expired','cancelled-order')`;
 expect((await previewTrialCleanup(null)).items[0]).toMatchObject({id:u.id,provider_checks:1});
 const probe=vi.spyOn(yookassa,'getPayment').mockResolvedValue({id:'cancelled-order',status:'pending',amount:{value:'199.00',currency:'RUB'}});
 expect((await deleteExpiredTrialVerified(u.id)).status).toBe('skipped');expect(await sql()`select id from users where id=${u.id}`).toHaveLength(1);
 probe.mockRejectedValue(new Error('credentials secret'));const failed=await deleteExpiredTrialVerified(u.id);expect(failed).toMatchObject({status:'failed',stage:'payments'});expect(JSON.stringify(failed)).not.toContain('secret');
 probe.mockResolvedValue({id:'cancelled-order',status:'succeeded',amount:{value:'199.00',currency:'RUB'}});expect((await deleteExpiredTrialVerified(u.id)).status).toBe('skipped');
 probe.mockResolvedValue({id:'cancelled-order',status:'canceled',amount:{value:'199.00',currency:'RUB'}});
 expect(await deleteExpiredTrialVerified(u.id)).toMatchObject({status:'deleted',checks:{localDeleted:true,remnawaveDeleted:true,trialBlocked:true}});
});
it('looks up and verifies a remote profile even when the local Remnawave ID was lost',async()=>{
 const u=await candidate();const remote=await remoteFor(u);await sql()`update users set rw_id=null where id=${u.id}`;
 expect((await deleteExpiredTrialVerified(u.id)).status).toBe('deleted');await expect(remnawave.getUser(remote.id)).rejects.toMatchObject({status:404});
 const registry=await trialCleanupRegistry({q:String(u.tg_id),filter:'all',page:1,limit:25});expect(registry.items[0]).toMatchObject({rw_id:remote.id,trial_blocked:true,verification:{localDeleted:true,remnawaveDeleted:true,trialBlocked:true}});
});
it('does not trust DELETE success when the panel still contains the user',async()=>{
 const u=await candidate();await remoteFor(u);vi.spyOn(remnawave,'deleteUser').mockResolvedValue();
 expect(await deleteExpiredTrialVerified(u.id)).toMatchObject({status:'failed',stage:'remote_verification'});
 expect(await sql()`select id from users where id=${u.id}`).toHaveLength(1);expect(await sql()`select tg_id from trial_cleanup_tombstones where tg_id=${u.tg_id}`).toHaveLength(0);
});
it('does not delete a reused numeric ID belonging to a different panel profile',async()=>{
 const u=await candidate(),other=await candidate();const remote=await remoteFor(other);await sql()`update users set rw_id=null where id=${other.id}`;await sql()`update users set rw_id=${remote.id} where id=${u.id}`;
 const result=await deleteExpiredTrialVerified(u.id);expect(result).toMatchObject({status:'failed',stage:'identity'});expect((await remnawave.getUser(remote.id)).username).toBe(remote.username);
});
it('uses the correct username after panel restore without deleting the unrelated old ID',async()=>{
 const u=await candidate(),other=await candidate();const correct=await remoteFor(u),unrelated=await remoteFor(other);
 await sql()`update users set rw_id=null where id=${other.id}`;await sql()`update users set rw_id=${unrelated.id} where id=${u.id}`;
 expect((await deleteExpiredTrialVerified(u.id)).status).toBe('deleted');await expect(remnawave.getUser(correct.id)).rejects.toMatchObject({status:404});expect((await remnawave.getUser(unrelated.id)).username).toBe(unrelated.username);
});
it('protects a profile extended directly in Remnawave and refuses to infer absence from an unavailable panel',async()=>{
 const u=await candidate();await remoteFor(u,{daysAgo:-10});expect((await deleteExpiredTrialVerified(u.id)).status).toBe('skipped');
 vi.spyOn(remnawave,'getUserByUsername').mockResolvedValue(null);vi.spyOn(remnawave,'getUserByShortUuid').mockResolvedValue(null);vi.spyOn(remnawave,'getUser').mockRejectedValue(new RemnawaveError('gone',404));vi.spyOn(remnawave,'listNodes').mockRejectedValue(new Error('bad base URL'));
 expect((await deleteExpiredTrialVerified(u.id)).status).toBe('failed');expect(await sql()`select id from users where id=${u.id}`).toHaveLength(1);
});
it('denies repeated trials from old bot buttons and Mini App API even if a returning account flag was reset',async()=>{
 const u=await candidate();const old=await remoteFor(u);expect((await deleteExpiredTrialVerified(u.id)).status).toBe('deleted');
 const fresh=await upsertTelegramUser({id:u.tg_id!,username:'returned'});await sql()`update users set trial_used=false,signup_bonus_done=false where id=${fresh.id}`;
 const stale={...fresh,trial_used:false};expect((await toMe(stale)).trialAvailable).toBe(false);await expect(startTrial(fresh.id)).rejects.toMatchObject({code:'trial_used'});
 const app=await buildApp({logger:false});try{
  const headers={authorization:'Bearer '+await signUserToken(fresh.id)};
  const web=await app.inject({method:'POST',url:'/api/v1/subscription/trial',headers});expect(web.statusCode).toBe(409);expect(web.json().error.code).toBe('trial_used');
  const bot=await app.inject({method:'POST',url:'/api/v1/subscription/trial',headers:{'x-internal-key':process.env.INTERNAL_KEY!,'x-tg-user':Buffer.from(JSON.stringify({id:u.tg_id})).toString('base64')}});expect(bot.statusCode).toBe(409);
  const current=(await sql()`select trial_used,signup_bonus_done from users where id=${fresh.id}`)[0];expect(current).toMatchObject({trial_used:true,signup_bonus_done:true});
  expect(await sql()`select user_id from subscriptions where user_id=${fresh.id}`).toHaveLength(0);await expect(remnawave.getUser(old.id)).rejects.toMatchObject({status:404});
 }finally{await app.close();}
});
it('a returning blocked-trial customer can buy a paid plan; verification never deletes the new paid profile',async()=>{
 const u=await candidate();const old=await remoteFor(u);await deleteExpiredTrialVerified(u.id);
 const fresh=await upsertTelegramUser({id:u.tg_id!});await sql()`update users set balance=19900 where id=${fresh.id}`;
 const [plan]=await sql()`insert into plans(name,duration_days,price,traffic_limit_gb,device_limit) values('1 месяц',30,19900,0,3) returning id`;
 const purchase=await createPayment(fresh,{planId:plan.id,method:'balance'});expect(purchase.status).toBe('succeeded');
 const [sub]=await sql()`select * from subscriptions where user_id=${fresh.id}`;expect(sub.is_trial).toBe(false);expect(sub.expires_at.getTime()).toBeGreaterThan(Date.now());
 const check=await verifyTrialCleanup(u.tg_id!);expect(check).toMatchObject({localDeleted:true,remnawaveDeleted:true,trialBlocked:true,returned:true});
 expect((await remnawave.getUserByUsername(old.username))!.id).not.toBe(old.id);
 expect((await trialCleanupRegistry({q:'',filter:'returned',page:1,limit:25})).total).toBe(1);
});
it('keeps legacy tombstones effective without fabricating deletion evidence',async()=>{
 await sql()`insert into trial_cleanup_tombstones(tg_id) values(123456789)`;const r=await verifyTrialCleanup(123456789);expect(r).toMatchObject({trialBlocked:true,localDeleted:null,remnawaveDeleted:null});
 const u=await upsertTelegramUser({id:123456789});expect(u.trial_used).toBe(true);expect((await toMe(u)).trialAvailable).toBe(false);
});
it('cleanup diagnostics and registry are restricted to administrators and search scopes deletion previews',async()=>{
 const u=await candidate();await candidate();const app=await buildApp({logger:false});try{
 const [a]=await sql()`insert into admins(email,password_hash,role) values('verify-admin@test','unused','admin') returning id`;
 const [b]=await sql()`insert into admins(email,password_hash,role) values('verify-analyst@test','unused','analyst') returning id`;
 const headers={authorization:'Bearer '+await signAdminToken(a.id,'admin')},analyst={authorization:'Bearer '+await signAdminToken(b.id,'analyst')};
 for(const url of ['/api/v1/admin/trial-cleanup/candidates','/api/v1/admin/trial-cleanup/registry']){
  expect((await app.inject({method:'GET',url})).statusCode).toBe(401);expect((await app.inject({method:'GET',url,headers:analyst})).statusCode).toBe(403);expect((await app.inject({method:'GET',url,headers})).statusCode).toBe(200);
 }
 const p=await app.inject({method:'POST',url:'/api/v1/admin/trial-cleanup/preview',headers,payload:{q:String(u.tg_id)}});expect(p.statusCode).toBe(200);expect(p.json().items.map((v:any)=>v.id)).toEqual([u.id]);
 expect((await app.inject({method:'GET',url:'/api/v1/admin/trial-cleanup/candidates?page=0',headers})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/v1/admin/trial-cleanup/registry/123/verify',headers})).statusCode).toBe(404);
 }finally{await app.close();}
});

it('can locate a renamed profile by its subscription identity when both ID and stored username are missing',async()=>{
 const u=await candidate();const remote=await remoteFor(u,{username:'renamed_'+u.tg_id});await sql()`update users set rw_id=null,rw_username=null where id=${u.id}`;
 expect((await deleteExpiredTrialVerified(u.id)).status).toBe('deleted');await expect(remnawave.getUser(remote.id)).rejects.toMatchObject({status:404});
});
it('shows banned expired never-paid trials and keeps a profile with conflicting identity anchors',async()=>{
 const u=await candidate();await sql()`update users set status='banned' where id=${u.id}`;expect((await previewTrialCleanup(null)).items.map(r=>r.id)).toContain(u.id);
 const original=await remoteFor(u),other=await candidate(),wrong=await remoteFor(other);
 await sql()`update users set rw_short_uuid=${wrong.shortUuid} where id=${u.id}`;
 expect(await deleteExpiredTrialVerified(u.id)).toMatchObject({status:'failed',stage:'identity'});expect((await remnawave.getUser(original.id)).id).toBe(original.id);
});

it('refuses an invalid remote expiry or a Telegram owner mismatch before issuing DELETE',async()=>{
 const u=await candidate();const remote=await remoteFor(u);const panel=(globalThis as any).__mocks.rw.state.users.get(remote.id);
 panel.expireAt='invalid-date';expect(await deleteExpiredTrialVerified(u.id)).toMatchObject({status:'failed',stage:'identity'});
 panel.expireAt=new Date(Date.now()-4*86400_000).toISOString();panel.telegramId=999999999;
 expect(await deleteExpiredTrialVerified(u.id)).toMatchObject({status:'failed',stage:'identity'});expect(await sql()`select id from users where id=${u.id}`).toHaveLength(1);
});
it('old user JWTs stop working after deletion and an unsuccessful verification is never reported as confirmed',async()=>{
 const u=await candidate();await remoteFor(u);const token=await signUserToken(u.id);await deleteExpiredTrialVerified(u.id);
 const app=await buildApp({logger:false});try{expect((await app.inject({method:'GET',url:'/api/v1/me',headers:{authorization:'Bearer '+token}})).statusCode).toBe(401);}finally{await app.close();}
 vi.spyOn(remnawave,'listNodes').mockRejectedValue(new Error('wrong base URL'));
 expect(await verifyTrialCleanup(u.tg_id!)).toMatchObject({trialBlocked:true,remnawaveDeleted:null,remoteState:'unavailable'});
});
it('a legacy-only tombstone can reveal a remaining canonical profile without deleting it',async()=>{
 const tgId=987654321;await sql()`insert into trial_cleanup_tombstones(tg_id) values(${tgId})`;
 const remote=await remnawave.createUser({username:'tg_'+tgId,telegramId:tgId,expireAt:new Date(Date.now()-4*86400_000),trafficLimitBytes:0,hwidDeviceLimit:1});
 expect(await verifyTrialCleanup(tgId)).toMatchObject({trialBlocked:true,remnawaveDeleted:null,remoteState:'legacy_present'});
 expect((await remnawave.getUser(remote.id)).id).toBe(remote.id);
});

it('an unused support draft does not block cleanup preview, but a real conversation does',async()=>{
 const draft=await candidate();const real=await candidate();
 for(const u of [draft,real]){const [t]=await sql()`insert into support_tickets(user_id,kind,mode,subject) values(${u.id},'chat','human','Чат') returning id`;await sql()`insert into support_messages(ticket_id,author,body) values(${t.id},'system','Приветствие')`;if(u.id===real.id)await sql()`insert into support_messages(ticket_id,author,body) values(${t.id},'user','Нужна помощь')`;}
 const p=await previewTrialCleanup(null);expect(p.items.some(u=>u.id===draft.id)).toBe(true);expect(p.items.some(u=>u.id===real.id)).toBe(false);expect(await sql()`select id from users where id in(${draft.id},${real.id})`).toHaveLength(2);
});
