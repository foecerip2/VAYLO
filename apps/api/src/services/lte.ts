import postgres from 'postgres';
import { config } from '../config.js';
import { conflict } from '../lib/errors.js';
let pool:ReturnType<typeof postgres>|null=null;
export const lteEnabled=()=>Boolean(config().LTE_DATABASE_URL);
export function lteDb(){
 if(!lteEnabled())throw conflict('Учёт LTE ещё не подключён','lte_unavailable');
 return pool??=postgres(config().LTE_DATABASE_URL,{max:5,connect_timeout:5,idle_timeout:10,connection:{statement_timeout:10000},onnotice:()=>{}});
}
export async function closeLte(){await pool?.end({timeout:2});pool=null;}
export async function lteQuota(rwId:number|null,username?:string|null){
 const db=lteDb();
 const [r]=await db`select u.id,u.status,
 (select uuid::text from internal_squads where name='LTE' order by uuid limit 1) as squad,
 coalesce((select sum(h.total_bytes) from nodes_user_usage_history h where h.node_id=${config().LTE_NODE_ID} and h.user_id=u.id and h.created_at>=greatest(date '2026-10-26',current_date-29)),0)::text as used,
 coalesce((select sum(x.bytes) from vaylo_lte_extra x where x.user_id=u.id and x.granted_on>=current_date-29),0)::text as extra,
 (select min(x.granted_on::date+30)::text from vaylo_lte_extra x where x.user_id=u.id and x.granted_on>=current_date-29) as next_expiry,
 exists(select 1 from vaylo_lte_optout o where o.user_id=u.id) as opted_out
,exists(select 1 from internal_squad_members m where m.internal_squad_uuid=(select uuid from internal_squads where name='LTE' order by uuid limit 1) and m.user_id=u.id) as in_squad
 from users u where (${rwId}::bigint is not null and u.id=${rwId}) or (${rwId}::bigint is null and u.username=${username??''}) limit 1`;
 if(!r)return null;
 if(!r.squad)throw conflict('Группа LTE не найдена в Remnawave','lte_unavailable');
 const used=Number(r.used),extra=Number(r.extra),limit=5*1024**3+extra;
 return {rwId:Number(r.id),squad:String(r.squad),usedBytes:used,baseBytes:5*1024**3,extraBytes:extra,limitBytes:limit,remainingBytes:Math.max(0,limit-used),optedOut:Boolean(r.opted_out),inSquad:Boolean(r.in_squad),status:String(r.status),nextExpiry:r.next_expiry as string|null};
}
/** Payment UUID makes the external grant retry-safe even if the local transaction rolls back. */
export async function grantLte(paymentId:string,rwId:number,qty:number){
 const db=lteDb();
 await db.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(49261,${rwId}::int)`;
  const [user]=await tx`select status from users where id=${rwId}`;
  if(!user)throw conflict('Профиль Remnawave не найден','lte_unavailable');
  if((await tx`select 1 from vaylo_lte_optout where user_id=${rwId}`).length)throw conflict('Доступ LTE отключён для пользователя','lte_optout');
  const [existing]=await tx`select user_id,bytes from vaylo_lte_orders where payment_id=${paymentId}`;
  if(existing&&(Number(existing.user_id)!==rwId||Number(existing.bytes)!==qty*1024**3))throw conflict('Ключ выдачи уже использован для другого пакета');
  const inserted=await tx`insert into vaylo_lte_orders(payment_id,user_id,bytes,granted_on) values(${paymentId},${rwId},${qty*1024**3},current_date) on conflict(payment_id) do nothing returning payment_id`;
  if(inserted.length)await tx`insert into vaylo_lte_extra(user_id,bytes,granted_on) values(${rwId},${qty*1024**3},current_date)`;
 });
 await syncLteMember(rwId);
}
export async function syncLteMember(rwId:number){
 const q=await lteQuota(rwId);if(!q)return;
 const db=lteDb();
 if(q.status==='ACTIVE'&&!q.optedOut&&q.remainingBytes>0)await db`insert into internal_squad_members(internal_squad_uuid,user_id) values(${q.squad},${rwId}) on conflict do nothing`;
 else await db`delete from internal_squad_members where internal_squad_uuid=${q.squad} and user_id=${rwId}`;
}
/** Same rolling window as lte-quota.sh; also removes explicitly opted-out members. */
export async function syncLteAll(){
 if(!lteEnabled())return;
 const db=lteDb();
 const [squad]=await db`select uuid from internal_squads where name='LTE' order by uuid limit 1`;
 if(!squad)throw Error('LTE squad missing');
 const rows=await db`select id from users order by id`;
 for(const u of rows)await syncLteMember(Number(u.id));
}

/** Aggregate by grant day: the original external script has no guaranteed row IDs. */
export async function ltePackageHistory(rwId:number,page=1){
 const db=lteDb();
 const [count]=await db`select count(*)::int as total from (select granted_on::date from vaylo_lte_extra where user_id=${rwId} group by granted_on::date) d`;
 const rows=await db`select granted_on::date::text as day,sum(bytes)::text as bytes,count(*)::int as grants,
 (granted_on::date+30)::text as expires_on,granted_on::date>=current_date-29 as active
 from vaylo_lte_extra where user_id=${rwId} group by granted_on::date order by granted_on::date desc limit 10 offset ${(page-1)*10}`;
 return {items:rows.map(r=>({day:String(r.day),bytes:Number(r.bytes),grants:Number(r.grants),expiresOn:String(r.expires_on),active:Boolean(r.active)})),total:Number(count!.total),page,limit:10};
}
