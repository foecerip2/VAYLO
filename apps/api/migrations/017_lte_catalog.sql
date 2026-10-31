-- Only explicitly LTE-named legacy general-traffic products are reclassified.
-- Preserve product IDs, prices, quantities and existing payment snapshots.
with converted as (
 update addon_products set kind='lte',duration_days=30,location_id=null
 where kind='traffic' and name ~* '\mLTE\M'
 returning id,name,qty,price
)
insert into audit_log(admin_email,action,entity,entity_id,data)
select 'system','addon.migrate-lte','addon',id::text,
 jsonb_build_object('previousKind','traffic','kind','lte','name',name,'qty',qty,'price',price,'durationDays',30)
from converted;
