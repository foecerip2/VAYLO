import { lteEnabled,lteQuota,grantLte,lteDb } from './lte.js';
import { sql, type TxSql } from '../db/index.js';
import type { SubscriptionRow, UserRow } from '../db/types.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { remnawave, rwErrorToHttp } from './remnawave.js';
import { FOREVER, squadsFor } from './subscriptions.js';
import { getSettings } from './settings.js';

const GB = 1024 ** 3;

export interface AddonRow {
  id: string;
  kind: 'devices' | 'traffic' | 'location' | 'lte';
  name: string;
  description: string;
  price: number;
  qty: number;
  location_id: string | null;
  duration_days: number | null;
  is_active: boolean;
  sort: number;
}
export interface LocationRow {
  id: string;
  name: string;
  country_code: string | null;
  description: string;
  squad_uuid: string;
  is_active: boolean;
  sort: number;
}

export function addonUnavailable(a: Pick<AddonRow,'kind'|'duration_days'|'location_id'>, sub: SubscriptionRow | undefined, permanentLocations: string[] = []): string | null {
  if (!sub || sub.expires_at.getTime() <= Date.now()) return 'Сначала оформите или продлите подписку';
  if(a.kind==='traffic'&&lteEnabled())return 'Общий VPN-трафик безлимитный. Для белых списков выберите пакет LTE';
  if(a.kind==='lte'&&!lteEnabled())return 'Учёт LTE ещё не подключён';
  if (a.kind === 'traffic' && Number(sub.traffic_limit_bytes) === 0) return 'На безлимитном тарифе докупка общего трафика не нужна';
  if (a.kind === 'devices' && sub.device_limit === 0) return 'На вашем тарифе число устройств не ограничено';
  if (a.kind === 'location' && a.duration_days && permanentLocations.includes(a.location_id ?? '')) return 'Эта локация уже подключена у вас бессрочно';
  return null;
}

export async function getAddon(id: string, requireActive = true): Promise<AddonRow> {
  const [a] = await sql()<AddonRow[]>`select * from addon_products where id = ${id}`;
  if (!a || (requireActive && !a.is_active)) throw notFound('Товар не найден');
  if (requireActive) {
    if(lteEnabled()&&(a.kind==='traffic'||a.kind==='location'))throw conflict('Этот товар снят с продажи. Выберите пакет LTE или устройств','addon_archived');
    if(a.kind==='lte'){if(!lteEnabled())throw conflict('Учёт LTE ещё не подключён','lte_unavailable');const [ready]=await lteDb()`select to_regclass('public.vaylo_lte_orders') is not null as ok`;if(!ready?.ok)throw conflict('Выполните подключение LTE на сервере','lte_unavailable');}
    const cfg = await getSettings('addons');
    if (!cfg.enabled) throw conflict('Докупки временно отключены', 'addons_disabled');
    if (a.kind === 'location') {
      const [l] = await sql()`select is_active from locations where id = ${a.location_id}`;
      if (!l?.is_active) throw notFound('Локация сейчас недоступна');
    }
  }
  return a;
}

/** Каталог докупок для пользователя + его купленные локации */
export async function addonCatalog(user: UserRow) {
  const cfg = await getSettings('addons');
  if (!cfg.enabled) return { enabled: false, products: [], locations: [], mine: [] };
  const products = await sql()<(AddonRow & { loc_name: string | null; loc_country: string | null; loc_active: boolean | null })[]>`
    select p.*, l.name as loc_name, l.country_code as loc_country, l.is_active as loc_active
    from addon_products p left join locations l on l.id = p.location_id
    where p.is_active and (${!lteEnabled()} or p.kind in ('devices','lte')) and (p.kind <> 'location' or l.is_active) order by p.sort, p.price`;
  const mine = await sql()<{ location_id: string; expires_at: Date; name: string }[]>`
    select ul.location_id, ul.expires_at, l.name from user_locations ul join locations l on l.id = ul.location_id
    where ul.user_id = ${user.id} and ul.expires_at > now()`;
  const [sub] = await sql()<SubscriptionRow[]>`select * from subscriptions where user_id = ${user.id}`;
  const pct = user.discount_pct;
  return {
    enabled: true,
    unlimited: sub ? Number(sub.traffic_limit_bytes) === 0 : false,
    active: Boolean(sub && sub.expires_at.getTime() > Date.now()),
    products: products.map((p) => ({
      available: !addonUnavailable(p,sub,mine.filter(m=>m.expires_at>=FOREVER).map(m=>m.location_id)),
      unavailableReason: addonUnavailable(p,sub,mine.filter(m=>m.expires_at>=FOREVER).map(m=>m.location_id)),
      id: p.id,
      kind: p.kind,
      name: p.name,
      description: p.description,
      price: p.price,
      finalPrice: p.price - Math.floor((p.price * pct) / 100),
      qty: p.qty,
      durationDays: p.duration_days,
      locationId: p.location_id,
      locationName: p.loc_name,
      countryCode: p.loc_country,
      owned: p.kind === 'location' && mine.some((m) => m.location_id === p.location_id),
    })),
    mine: mine.map((m) => ({ locationId: m.location_id, name: m.name, expiresAt: m.expires_at >= FOREVER ? null : m.expires_at.toISOString() })),
  };
}

export async function assertCanBuyAddon(userId: string, a: AddonRow): Promise<void> {
  const [sub] = await sql()<SubscriptionRow[]>`select * from subscriptions where user_id = ${userId}`;
  const own = a.kind === 'location' ? await sql()`select location_id from user_locations where user_id=${userId} and expires_at>=${FOREVER}` : [];
  if(a.kind==='lte'){const [u]=await sql()`select rw_id,rw_username from users where id=${userId}`;const q=await lteQuota(u?.rw_id??null,u?.rw_username);if(!q||q.optedOut)throw conflict('Профиль LTE отсутствует или доступ отключён','lte_unavailable');}
  const reason = addonUnavailable(a,sub,own.map(r=>r.location_id as string));
  if (reason) throw conflict(reason,!sub || sub.expires_at.getTime()<=Date.now() ? 'no_subscription' : a.kind==='location'?'location_owned_forever':'unlimited_plan');
}

/** Применить докупку внутри транзакции (платёж уже оплачен). */
export async function applyAddon(tx: TxSql, userId: string, snap: { kind: AddonRow['kind']; qty: number; locationId?: string | null; days?: number | null }, paymentId?:string): Promise<void> {
  const [user] = await tx<UserRow[]>`select * from users where id = ${userId} for update`;
  if (!user) throw badRequest('Пользователь не найден');
  const [sub] = await tx<SubscriptionRow[]>`select * from subscriptions where user_id = ${userId}`;
  if (!sub || sub.expires_at.getTime() <= Date.now()) throw conflict('Нет активной подписки', 'no_subscription');

  if(snap.kind==='lte'){if(!paymentId||!user.rw_id)throw conflict('Для выдачи LTE нужен профиль Remnawave');await grantLte(paymentId,user.rw_id,snap.qty);return;}

  let devices = sub.device_limit;
  let extraDev = sub.extra_devices;
  let traffic = lteEnabled()?0:Number(sub.traffic_limit_bytes);
  let extraTr = Number(sub.extra_traffic_bytes);
  const limited = traffic > 0;

  if (snap.kind === 'devices') {
    if (devices === 0) throw conflict('На вашем тарифе число устройств не ограничено', 'unlimited_plan');
    if (devices > 0) {
      devices += snap.qty;
      extraDev += snap.qty;
    }
  } else if (snap.kind === 'traffic') {
    if (!limited) throw conflict('На безлимитном тарифе докупка трафика не нужна', 'unlimited_plan');
    traffic += snap.qty * GB;
    extraTr += snap.qty * GB;
  } else {
    if (!snap.locationId) throw badRequest('Не указана локация');
    const [loc] = await tx<LocationRow[]>`select * from locations where id = ${snap.locationId}`;
    if (!loc) throw notFound('Локация не найдена');
    const cur = await currentLocExpiry(tx, userId, loc.id);
    // бессрочная локация не «понижается» до срочной
    const until = !snap.days || cur === 'forever' ? FOREVER : new Date(Math.max(Date.now(), cur) + snap.days * 86400_000);
    await tx`
      insert into user_locations (user_id, location_id, expires_at) values (${userId}, ${loc.id}, ${until})
      on conflict (user_id, location_id) do update set expires_at = excluded.expires_at`;
    if (limited && snap.qty > 0) {
      traffic += snap.qty * GB;
      extraTr += snap.qty * GB;
    }
  }

  if (user.rw_id) {
    const squads = await squadsFor(tx, userId);
    try {
      await remnawave.updateUser(user.rw_id, { trafficLimitBytes: traffic, hwidDeviceLimit: devices, activeInternalSquads: squads });
    } catch (e) {
      rwErrorToHttp(e);
    }
  }
  await tx`update subscriptions set device_limit = ${devices}, extra_devices = ${extraDev}, traffic_limit_bytes = ${traffic}, extra_traffic_bytes = ${extraTr}, updated_at = now() where user_id = ${userId}`;
}

async function currentLocExpiry(tx: TxSql, userId: string, locId: string): Promise<number | 'forever'> {
  const [r] = await tx<{ expires_at: Date }[]>`select expires_at from user_locations where user_id = ${userId} and location_id = ${locId}`;
  if (!r) return 0;
  return r.expires_at >= FOREVER ? 'forever' : r.expires_at.getTime();
}

/**
 * Воркер: убирает истёкшие локации. Сначала обновляем сквады в панели, и только потом удаляем строки —
 * при сбое панели запись остаётся и будет обработана при следующем запуске.
 */
export async function expireLocations(): Promise<number> {
  const rows = await sql()<{ user_id: string }[]>`select distinct user_id from user_locations where expires_at <= now()`;
  let done = 0;
  for (const { user_id: id } of rows) {
    try {
      const [u] = await sql()<UserRow[]>`select * from users where id = ${id}`;
      if (u?.rw_id) {
        const squads = await squadsFor(sql(), id); // истёкшие уже отфильтрованы по времени
        await remnawave.updateUser(u.rw_id, { activeInternalSquads: squads });
      }
      await sql()`delete from user_locations where user_id = ${id} and expires_at <= now()`;
      done++;
    } catch {
      /* панель недоступна — повторим при следующем запуске */
    }
  }
  return done;
}
