import { SUPPORT_HAS_ACTIVITY_SQL } from './supportVisibility.js';
import { sql, type TxSql } from '../db/index.js';
import type { UserRow, PaymentRow } from '../db/types.js';
import { conflict, notFound } from '../lib/errors.js';
import { remnawave, RemnawaveError, type RwUser } from './remnawave.js';
import { rwUsernameFor } from './subscriptions.js';
import { yookassa } from './yookassa.js';
import { platega, mapPlategaStatus } from './platega.js';
import { rollypay, mapRollypayStatus } from './rollypay.js';

export const CLEANUP_REASONS: Record<string,string> = {
 no_telegram:'Нет Telegram ID — нельзя сохранить запрет повторного триала',
 no_subscription:'Нет локальной подписки — дата окончания триала неизвестна',
 not_trial:'Текущая подписка не пробная; тип доступа требует проверки',
 grace:'После окончания пробного доступа ещё не прошло 72 часа',
 balance:'На основном или реферальном балансе есть средства',
 admin:'Аккаунт администратора',
 payment:'Есть оплата, возврат или незавершённый платёж',
 gift:'Есть купленный или активированный подарок',
 referral:'Есть реферальные начисления',
 withdrawal:'Есть заявка на вывод',
 support:'Есть незакрытое обращение в поддержку',
};
const like = (value:string) => '%' + value.replace(/[\\%_]/g,'\\$&') + '%';
/** One source of truth for preview and the final locked recheck. Missing trial_used alone is not disqualifying. */
function assessment() {
 const db=sql();
 return db`select u.*,s.expires_at,s.is_trial,
  (s.is_trial or (s.plan_id is null and s.plan_name ~* '(пробн|тест|trial)' and
    (u.trial_used or exists(select 1 from trial_activations ta where ta.user_id=u.id)))) as trial_evidence,
  array_remove(array[
   case when u.tg_id is null then 'no_telegram' end,
   case when s.user_id is null then 'no_subscription' end,
   case when s.user_id is not null and not coalesce(s.is_trial or
    (s.plan_id is null and s.plan_name ~* '(пробн|тест|trial)' and (u.trial_used or exists(select 1 from trial_activations ta where ta.user_id=u.id))),false) then 'not_trial' end,
   case when s.expires_at>=now()-interval '3 days' then 'grace' end,
   case when u.balance<>0 or u.ref_balance<>0 then 'balance' end,
   case when exists(select 1 from admins a where a.tg_id=u.tg_id) then 'admin' end,
   case when exists(select 1 from payments p where p.user_id=u.id and
    (p.status in ('pending','succeeded','refunded') or p.paid_at is not null or p.fulfilled_at is not null)) then 'payment' end,
   case when exists(select 1 from gifts g where g.buyer_id=u.id or g.redeemed_by=u.id) then 'gift' end,
   case when exists(select 1 from referral_rewards r where r.referrer_id=u.id or r.referee_id=u.id) then 'referral' end,
   case when exists(select 1 from withdrawals w where w.user_id=u.id) then 'withdrawal' end,
   case when exists(select 1 from support_tickets t where t.user_id=u.id and t.status<>'closed' and ${db.unsafe(SUPPORT_HAS_ACTIVITY_SQL)}) then 'support' end
  ],null) as reasons,
  (select count(*)::int from payments p where p.user_id=u.id and p.external_id is not null and p.status in ('canceled','expired')) as provider_checks
 from users u left join subscriptions s on s.user_id=u.id
 where u.trial_used or s.is_trial or exists(select 1 from trial_activations ta where ta.user_id=u.id)
  or (s.plan_id is null and s.plan_name ~* '(пробн|тест|trial)')`;
}
export interface CleanupQuery { q:string; filter:'eligible'|'excluded'|'all'; page:number; limit:number }
export async function trialCleanupCandidates(query:CleanupQuery) {
 const db=sql(),search=query.q.trim().replace(/^@/,'');
 const scope=db`select * from (${assessment()}) a where ${search?db`(first_name ilike ${like(search)} or username ilike ${like(search)} or tg_id::text=${search} or id::text=${search})`:db`true`}`;
 const [stats]=await db`select count(*)::int as total,count(*) filter(where cardinality(reasons)=0)::int as eligible,
  count(*) filter(where cardinality(reasons)>0)::int as excluded from (${scope}) a`;
 const filter=query.filter==='eligible'?db`cardinality(reasons)=0`:query.filter==='excluded'?db`cardinality(reasons)>0`:db`true`;
 const [count]=await db`select count(*)::int as total from (${scope}) a where ${filter}`;
 const rows=await db<{id:string;tg_id:number|null;first_name:string|null;username:string|null;expires_at:Date|null;eligible_after:Date|null;reasons:string[];provider_checks:number;rw_id:number|null;rw_username:string|null}[]>`select id,tg_id,first_name,username,expires_at,expires_at+interval '3 days' as eligible_after,
  reasons,provider_checks,rw_id,rw_username from (${scope}) a where ${filter}
  order by expires_at nulls last,id limit ${query.limit} offset ${(query.page-1)*query.limit}`;
 return {stats,total:Number(count.total),page:query.page,limit:query.limit,items:rows.map(r=>({...r,eligible:r.reasons.length===0,
  reasons:r.reasons.map((code:string)=>({code,label:CLEANUP_REASONS[code]??code}))}))};
}
export async function previewTrialCleanup(adminId:string|null,search='') {
 const db=sql();
 const found=await trialCleanupCandidates({q:search,filter:'eligible',page:1,limit:100});
 const ids=found.items.map(u=>u.id);
 const [plan]=await db`insert into trial_cleanup_runs(admin_id,user_ids) values(${adminId},${db.json(ids)}) returning id,expires_at`;
 return {id:plan.id as string,expiresAt:plan.expires_at,total:found.total,batchSize:ids.length,items:found.items};
}
export async function getTrialCleanupRun(id:string,adminId:string|null) {
 const [run]=await sql()`select id,state,results,created_at,expires_at,finished_at from trial_cleanup_runs where id=${id} and admin_id is not distinct from ${adminId}`;
 if(!run)throw notFound('Предпросмотр не найден');
 return run;
}
class CleanupFailure extends Error {
 constructor(public stage:string,public safeMessage:string){super(safeMessage);}
}
class CleanupSkip extends Error {}
async function verifyUnpaid(tx:TxSql,userId:string) {
 const payments=await tx<PaymentRow[]>`select * from payments where user_id=${userId} order by id for update`;
 for(const p of payments) {
  if(['pending','succeeded','refunded'].includes(p.status)||p.paid_at||p.fulfilled_at)
   throw new CleanupSkip('Состояние платежа изменилось после предпросмотра. Пользователь сохранён.');
  if(!p.external_id)continue;
  let status:string;
  try{
   if(p.provider==='yookassa')status=(await yookassa.getPayment(p.external_id)).status;
   else if(p.provider==='platega')status=mapPlategaStatus((await platega.getTransaction(p.external_id)).status);
   else if(p.provider==='rollypay')status=mapRollypayStatus((await rollypay.getPayment(p.external_id)).status);
   else throw new Error('unsupported provider');
  }catch{throw new CleanupFailure('payments','Не удалось проверить отменённый платёж у провайдера. Пользователь не удалён.');}
  if(status!=='canceled')throw new CleanupSkip(status==='succeeded'||status==='refunded'
   ?'Провайдер сообщает об оплате или возврате. Пользователь сохранён; сверьте платёж.'
   :'Платёж у провайдера ещё не закрыт. Пользователь сохранён.');
 }
}
async function readRemote(id:number):Promise<RwUser|null> {
 try{return await remnawave.getUser(id);}catch(e){if(e instanceof RemnawaveError&&e.status===404)return null;throw e;}
}
async function resolveRemote(u:UserRow) {
 if(!await remnawave.isConfigured())throw new CleanupFailure('remnawave','Remnawave не настроена: удаление в панели проверить нельзя.');
 const name=u.rw_username??rwUsernameFor(u);
 const named=await remnawave.getUserByUsername(name);
 const short=u.rw_short_uuid?await remnawave.getUserByShortUuid(u.rw_short_uuid):null;
 const stored=u.rw_id!=null?await readRemote(u.rw_id):null;
 if(short&&named&&short.id!==named.id)throw new CleanupFailure('identity','Имя и идентификатор подписки указывают на разные профили. Удаление остановлено.');
 if(short)return {user:short,name:short.username};
 // A restored panel may have reused an old numeric ID. Never delete the unrelated profile.
 if(named)return {user:named,name};
 if(stored){
  const same=stored.username===name||(u.rw_short_uuid&&stored.shortUuid===u.rw_short_uuid)
   ||(u.tg_id!=null&&stored.telegramId!=null&&String(stored.telegramId)===String(u.tg_id));
  if(!same)throw new CleanupFailure('identity','Сохранённый ID Remnawave относится к другому профилю. Удаление остановлено.');
  return {user:stored,name:stored.username};
 }
 // A wrong base URL returning 404 everywhere is not evidence that the user was deleted.
 await remnawave.listNodes();
 return {user:null,name};
}
async function assertRemoteAbsent(remote:{user:RwUser|null;name:string}) {
 if(remote.user&&await readRemote(remote.user.id))throw new CleanupFailure('remote_verification','Панель ответила на удаление, но профиль ещё существует. Локальная запись сохранена.');
 if(await remnawave.getUserByUsername(remote.name))throw new CleanupFailure('remote_verification','Профиль всё ещё находится в Remnawave по имени. Локальная запись сохранена.');
}
export type CleanupResult = {id:string;status:'deleted'|'skipped'|'failed';tgId?:number;stage?:string;reason?:string;error?:string;checks?:{localDeleted:boolean;remnawaveDeleted:boolean;trialBlocked:boolean};verifiedAt?:string}
export async function deleteExpiredTrialVerified(id:string):Promise<CleanupResult> {
 try{
  const deleted=await sql().begin(async tx=>{
   const [u]=await tx<UserRow[]>`select * from users where id=${id} for update`;
   if(!u)return null;
   // Access grants update the user first; purchases need a foreign-key lock on that row.
   await tx`select user_id from subscriptions where user_id=${id} for update`;
   const [check]=await tx`select reasons from (${assessment()}) a where id=${id}`;
   if(!check||check.reasons.length)throw new CleanupSkip(check?.reasons.map((c:string)=>CLEANUP_REASONS[c]??c).join('; ')||'Аккаунт больше не является пробным.');
   await verifyUnpaid(tx,id);
   let remote:Awaited<ReturnType<typeof resolveRemote>>;
   try{
    remote=await resolveRemote(u);
    if(remote.user&&(await tx`select id from users where rw_id=${remote.user.id} and id<>${id}`).length)
     throw new CleanupFailure('identity','Профиль Remnawave связан с другим локальным аккаунтом. Удаление остановлено.');
    if(remote.user&&!Number.isFinite(new Date(remote.user.expireAt).getTime()))
     throw new CleanupFailure('identity','Не удалось определить срок доступа в Remnawave. Пользователь сохранён.');
    if(remote.user&&remote.user.telegramId!=null&&String(remote.user.telegramId)!==String(u.tg_id))
     throw new CleanupFailure('identity','Telegram ID профиля Remnawave отличается от локального. Удаление остановлено.');
    if(remote.user&&new Date(remote.user.expireAt).getTime()>=Date.now()-3*86400_000)
     throw new CleanupSkip('В Remnawave срок доступа ещё активен или закончился менее 72 часов назад. Пользователь сохранён.');
    if(remote.user){try{await remnawave.deleteUser(remote.user.id);}catch(e){if(!(e instanceof RemnawaveError&&e.status===404))throw e;}}
    await assertRemoteAbsent(remote);
   }catch(e){if(e instanceof CleanupFailure||e instanceof CleanupSkip)throw e;throw new CleanupFailure('remnawave','Не удалось подтвердить удаление в Remnawave. Локальная запись сохранена.');}
   await tx`insert into trial_cleanup_tombstones(tg_id,source_user_id,rw_id,rw_username,rw_uuid,deletion_verified_at)
    values(${u.tg_id},${id},${remote.user?.id??u.rw_id},${remote.name},${typeof remote.user?.uuid==='string'?remote.user.uuid:null},now())
    on conflict(tg_id) do update set source_user_id=excluded.source_user_id,rw_id=excluded.rw_id,
     rw_username=excluded.rw_username,rw_uuid=excluded.rw_uuid,cleaned_at=now(),deletion_verified_at=now(),verification=null,last_verified_at=null`;
   await tx`delete from users where id=${id}`;
   return {tgId:Number(u.tg_id)};
  });
  if(!deleted)return {id,status:'skipped',reason:'Локальная запись уже отсутствует.'};
  const [proof]=await sql()`select not exists(select 1 from users where id=${id}) as local_deleted,
   exists(select 1 from trial_cleanup_tombstones where tg_id=${deleted.tgId}) as trial_blocked`;
  const checks={localDeleted:Boolean(proof.local_deleted),remnawaveDeleted:true,trialBlocked:Boolean(proof.trial_blocked)};
  if(!checks.localDeleted||!checks.trialBlocked)throw new CleanupFailure('local_verification','Проверка локального удаления или запрета триала не пройдена.');
  const verifiedAt=new Date().toISOString();
  await sql()`update trial_cleanup_tombstones set last_verified_at=now(),verification=${sql().json(checks)} where tg_id=${deleted.tgId}`;
  return {id,status:'deleted',...deleted,checks,verifiedAt};
 }catch(e){
  if(e instanceof CleanupSkip)return {id,status:'skipped',reason:e.message};
  return {id,status:'failed',stage:e instanceof CleanupFailure?e.stage:'local_verification',
   error:e instanceof CleanupFailure?e.safeMessage:'Не удалось подтвердить результат удаления. Проверьте реестр и повторите проверку.'};
 }
}
/** Compatibility for the CLI and callers interested only in the outcome. */
export async function deleteExpiredTrial(id:string) {
 const r=await deleteExpiredTrialVerified(id);if(r.status==='failed')throw new CleanupFailure(r.stage!,r.error!);return r.status;
}
export async function executeTrialCleanup(id:string,adminId:string|null) {
 const db=sql();
 const [run]=await db`update trial_cleanup_runs set state='running' where id=${id} and admin_id is not distinct from ${adminId} and state='ready' and expires_at>now() returning user_ids`;
 if(!run)throw conflict('Предпросмотр устарел или уже запущен. Обновите результат.');
 const results:CleanupResult[]=[];
 try{
  for(const userId of run.user_ids as string[]){results.push(await deleteExpiredTrialVerified(userId));await db`update trial_cleanup_runs set results=${db.json(results)} where id=${id}`;}
  await db`update trial_cleanup_runs set state='done',finished_at=now() where id=${id}`;
 }catch(e){await db`update trial_cleanup_runs set state='failed',finished_at=now() where id=${id}`;throw e;}
 return getTrialCleanupRun(id,adminId);
}

export async function trialCleanupRegistry(q:{q:string;filter:'all'|'returned'|'unverified';page:number;limit:number}) {
 const db=sql(),search=q.q.trim();
 const where=db`${search?db`(t.tg_id::text=${search} or t.source_user_id::text=${search} or t.rw_username ilike ${like(search)})`:db`true`}
  and ${q.filter==='returned'?db`u.id is not null and u.id is distinct from t.source_user_id`:q.filter==='unverified'?db`(t.last_verified_at is null or not coalesce((t.verification->>'localDeleted')::boolean,false) or not coalesce((t.verification->>'remnawaveDeleted')::boolean,false))`:db`true`}`;
 const [count]=await db`select count(*)::int as total from trial_cleanup_tombstones t left join users u on u.tg_id=t.tg_id where ${where}`;
 const items=await db`select t.tg_id,t.cleaned_at,t.source_user_id,t.rw_id,t.rw_username,t.deletion_verified_at,t.last_verified_at,t.verification,
  u.id as current_user_id,u.first_name,u.username, true as trial_blocked from trial_cleanup_tombstones t left join users u on u.tg_id=t.tg_id
  where ${where} order by t.cleaned_at desc,t.tg_id limit ${q.limit} offset ${(q.page-1)*q.limit}`;
 return {total:Number(count.total),items,page:q.page,limit:q.limit};
}
export async function verifyTrialCleanup(tgId:number) {
 const db=sql();const [t]=await db`select * from trial_cleanup_tombstones where tg_id=${tgId}`;
 if(!t)throw notFound('Telegram ID отсутствует в реестре использованных триалов');
 const [local]=await db`select id,rw_id from users where tg_id=${tgId}`;
 const [old]=t.source_user_id?await db`select id from users where id=${t.source_user_id}`:[];
 let remoteDeleted:boolean|null=null,remoteState='unknown';
 try{
  if(!await remnawave.isConfigured())throw Error('not configured');
  if(t.rw_id!=null||t.rw_username){
   const a=t.rw_id!=null?await readRemote(Number(t.rw_id)):null;
   const b=t.rw_username?await remnawave.getUserByUsername(t.rw_username):null;
   if(!a&&!b)await remnawave.listNodes();
   const matchesOld=(r:RwUser|null)=>!!r&&(!t.rw_uuid||r.uuid===t.rw_uuid);
   remoteDeleted=!matchesOld(a)&&!matchesOld(b);
   remoteState=remoteDeleted?'absent':local&&local.id!==t.source_user_id&&(a?.id===local.rw_id||b?.id===local.rw_id)?'returned':'present';
   // Older panels may omit UUID. A re-created profile is not proof that the original deletion failed.
   if(remoteState==='returned'&&!t.rw_uuid)remoteDeleted=null;
  }else{
   // Old releases retained only the Telegram ID. A canonical-name lookup can reveal an orphan,
   // but cannot prove absence of a profile renamed in the panel.
   const candidate=await remnawave.getUserByUsername('tg_'+tgId);
   if(!candidate)await remnawave.listNodes();
   remoteState=candidate?(local?.rw_id===candidate.id?'returned':'legacy_present'):'legacy_unknown';
  }
 }catch{remoteState='unavailable';}
 const checks={localDeleted:t.source_user_id?!old:null,remnawaveDeleted:remoteDeleted,trialBlocked:true,
  returned:!!local&&local.id!==t.source_user_id,remoteState};
 await db`update trial_cleanup_tombstones set last_verified_at=now(),verification=${db.json(checks)} where tg_id=${tgId}`;
 return {...checks,checkedAt:new Date().toISOString()};
}
