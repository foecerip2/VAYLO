import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { notFound } from '../lib/errors.js';
import { lteEnabled,lteQuota,ltePackageHistory } from './lte.js';
import { rwUsernameFor } from './subscriptions.js';

export async function adminUserLte(userId:string,page=1){
 const db=sql();const [user]=await db<UserRow[]>`select * from users where id=${userId}`;
 if(!user)throw notFound('Пользователь не найден');
 const purchases=db`select p.id::text as id,'purchase'::text as source,p.plan_name as name,p.payload->'addon'->'qty' as qty,
 p.amount,p.status,p.created_at,p.paid_at,p.fulfilled_at,p.fulfill_failed_at,null::text as reason,null::text as actor
 from payments p where p.user_id=${userId} and p.purpose='addon' and p.payload->'addon'->>'kind'='lte'`;
 const manual=db`select distinct on(a.entity_id) a.entity_id as id,'manual'::text as source,'Ручная выдача LTE'::text as name,a.data->'qty' as qty,
 null::bigint as amount,'succeeded'::text as status,a.created_at,a.created_at as paid_at,a.created_at as fulfilled_at,null::timestamptz as fulfill_failed_at,a.data->>'reason' as reason,a.admin_email as actor
 from audit_log a where a.action='lte.manual-grant' and ${user.tg_id}::bigint is not null and a.data->>'tgId'=${String(user.tg_id??'')}
 order by a.entity_id,a.created_at desc,a.id desc`;
 const history=db`(${purchases}) union all (${manual})`;
 const [count]=await db`select count(*)::int as total from (${history}) h`;
 const items=await db`select * from (${history}) h order by created_at desc,id desc limit 10 offset ${(page-1)*10}`;
 const orders={items,total:Number(count!.total),page,limit:10};
 if(!lteEnabled())return {state:'disabled' as const,quota:null,packages:null,orders,checkedAt:null};
 try{
  const q=await lteQuota(user.rw_id,user.rw_username??rwUsernameFor(user));
  if(!q)return {state:'unlinked' as const,quota:null,packages:null,orders,checkedAt:new Date().toISOString()};
  const packages=await ltePackageHistory(q.rwId,page);
  return {state:'ready' as const,quota:{usedBytes:q.usedBytes,baseBytes:q.baseBytes,extraBytes:q.extraBytes,limitBytes:q.limitBytes,remainingBytes:q.remainingBytes,nextExpiry:q.nextExpiry,optedOut:q.optedOut,inSquad:q.inSquad,remoteStatus:q.status},packages,orders,checkedAt:new Date().toISOString()};
 }catch{
  return {state:'unavailable' as const,quota:null,packages:null,orders,checkedAt:null};
 }
}
