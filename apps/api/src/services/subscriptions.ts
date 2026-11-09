import { lteEnabled,lteQuota } from './lte.js';
import { subscriptionState, type SubscriptionDTO } from '@vpn/shared';
import { sql, type Sql, type TxSql } from '../db/index.js';
import type { SubscriptionRow, UserRow } from '../db/types.js';
import { badRequest, conflict } from '../lib/errors.js';
import { remnawave, RemnawaveError, rwErrorToHttp, type RwUser } from './remnawave.js';
import { getSettings } from './settings.js';
import { isTgAdmin, passesChannelCheck } from './gate.js';
import { assertSalesOpen } from './closure.js';

export async function assertNotMaintenance(): Promise<void> {
  const g = await getSettings('general');
  if (g.maintenance) throw conflict(g.maintenance_text || 'Технические работы', 'maintenance');
}

const GB = 1024 ** 3;
const DAY = 86400_000;

export interface GrantSpec {
  days: number;
  /** Если не заданы — берутся из текущей подписки (или из настроек триала) */
  trafficLimitBytes?: number;
  deviceLimit?: number;
  planId?: string | null;
  planName?: string | null;
  isTrial?: boolean;
  /** Сбросить использованный трафик в панели */
  resetTraffic?: boolean;
}

export interface GrantResult {
  expiresAt: Date;
  subUrl: string | null;
  previous: SubscriptionRow | null;
}

export function rwUsernameFor(u: Pick<UserRow, 'id' | 'tg_id'>): string {
  return u.tg_id ? `tg_${u.tg_id}` : `u_${u.id.replace(/-/g, '').slice(0, 12)}`;
}

export const FOREVER = new Date('2099-12-31T00:00:00Z');

/**
 * Список сквадов пользователя: основной + купленные премиум-локации.
 * Всегда возвращает явный список (даже если локаций нет): иначе после истечения/удаления локаций панель
 * оставила бы пользователю премиум-сквад. Пустой список — только если в панели вообще нет сквадов.
 */
export async function squadsFor(db: Sql | TxSql, userId: string, subActive = true): Promise<string[]> {
  const rows = await db<{ squad_uuid: string; expires_at: Date; is_active: boolean }[]>`
    select l.squad_uuid, ul.expires_at, l.is_active from user_locations ul join locations l on l.id = ul.location_id where ul.user_id = ${userId}`;
  const base = await remnawave.getSquadUuid();
  const list = new Set<string>(base ? [base] : []);
  if (subActive) for (const r of rows) if (r.is_active && r.expires_at.getTime() > Date.now()) list.add(r.squad_uuid);
  if(lteEnabled()){
    const [u]=await db<UserRow[]>`select * from users where id=${userId}`;
    const quota=await lteQuota(u?.rw_id??null,u?.rw_username??(u?rwUsernameFor(u):null));
    if(quota){if(base===quota.squad)throw conflict('Основная группа подписки должна отличаться от LTE');list.delete(quota.squad);if(subActive&&!quota.optedOut&&quota.remainingBytes>0)list.add(quota.squad);}
    else {const [squad]=await (await import('./lte.js')).lteDb()`select uuid::text as uuid from internal_squads where name='LTE' limit 1`;if(squad){if(base===String(squad.uuid))throw conflict('Основная группа подписки должна отличаться от LTE');list.add(String(squad.uuid));}}
  }
  return [...list];
}

/** Создаёт/обновляет пользователя в Remnawave. Идемпотентно по username. */
async function syncRemnawave(
  user: UserRow,
  input: { expireAt: Date; trafficLimitBytes: number; deviceLimit: number; resetTraffic: boolean; squads?: string[] },
): Promise<RwUser> {
  const payload = {
    expireAt: input.expireAt,
    trafficLimitBytes: lteEnabled()?0:input.trafficLimitBytes,
    hwidDeviceLimit: input.deviceLimit,
    status: 'ACTIVE' as const,
    ...(input.squads ? { activeInternalSquads: input.squads } : {}),
  };
  const username = user.rw_username ?? rwUsernameFor(user);
  const create = async (): Promise<RwUser> => {
    try {
      return await remnawave.createUser({ username, telegramId: user.tg_id, description: user.username ? `@${user.username}` : undefined, ...payload });
    } catch (e) {
      // уже существует (например, создан вручную или ранее) — подхватываем
      if (e instanceof RemnawaveError && (e.status === 400 || e.status === 409)) {
        const found = await remnawave.getUserByUsername(username);
        if (found) return remnawave.updateUser(found.id, { ...payload, telegramId: user.tg_id });
      }
      throw e;
    }
  };

  let rw: RwUser;
  if (user.rw_id) {
    try {
      rw = await remnawave.updateUser(user.rw_id, payload);
    } catch (e) {
      if (e instanceof RemnawaveError && e.status === 404) rw = await create();
      else throw e;
    }
  } else {
    rw = await create();
  }
  if (input.resetTraffic) {
    try {
      await remnawave.resetTraffic(rw.id);
    } catch {
      /* не критично */
    }
  }
  return rw;
}

/**
 * Выдаёт/продлевает доступ. Вызывать внутри транзакции: блокирует строку пользователя,
 * вызывает Remnawave, затем пишет локальную подписку. Если Remnawave упала — транзакция откатится.
 */
export async function grantAccess(tx: TxSql, userId: string, spec: GrantSpec): Promise<GrantResult> {
  const [user] = await tx<UserRow[]>`select * from users where id = ${userId} for update`;
  if (!user) throw badRequest('Пользователь не найден');
  if (user.status === 'banned') throw conflict('Пользователь заблокирован', 'banned');
  const [prev] = await tx<SubscriptionRow[]>`select * from subscriptions where user_id = ${userId}`;
  const trial = await getSettings('trial');

  const now = Date.now();
  const prevActive = prev && prev.expires_at.getTime() > now;
  const base = prevActive ? prev!.expires_at.getTime() : now;
  const expiresAt = new Date(base + spec.days * DAY);

  // докупки (устройства/трафик/локации) живут, пока подписка активна; после окончания и новой покупки — сбрасываются
  const extraDev = prevActive ? (prev!.extra_devices ?? 0) : 0;
  const extraTr = prevActive ? Number(prev!.extra_traffic_bytes ?? 0) : 0;
  const prevBaseTraffic = prev ? Math.max(0, Number(prev.traffic_limit_bytes) - Number(prev.extra_traffic_bytes ?? 0)) : null;
  const prevBaseDevices = prev ? Math.max(0, prev.device_limit - (prev.extra_devices ?? 0)) : null;
  const baseTraffic = spec.trafficLimitBytes ?? (prev ? (Number(prev.traffic_limit_bytes) === 0 ? 0 : prevBaseTraffic! ) : trial.traffic_gb * GB);
  const baseDevices = spec.deviceLimit ?? prevBaseDevices ?? trial.device_limit;
  const trafficLimitBytes = lteEnabled()?0:baseTraffic === 0 ? 0 : baseTraffic + extraTr;
  const deviceLimit = baseDevices === 0 ? 0 : baseDevices + extraDev;
  if (!prevActive) await tx`delete from user_locations where user_id = ${userId} and expires_at >= ${FOREVER}`;
  const squads = await squadsFor(tx, userId);
  const isTrial = spec.isTrial ?? (prevActive ? prev!.is_trial : false);
  const resetTraffic = spec.resetTraffic ?? (!prevActive || Boolean(prev?.is_trial && !isTrial));

  const rw = await syncRemnawave(user, { expireAt: expiresAt, trafficLimitBytes, deviceLimit, resetTraffic, squads });
  const subUrl = rw.subscriptionUrl ?? prev?.sub_url ?? null;

  await tx`update users set rw_id = ${rw.id}, rw_short_uuid = ${rw.shortUuid}, rw_username = ${rw.username} where id = ${userId}`;
  await tx`
    insert into subscriptions (user_id, plan_id, plan_name, is_trial, expires_at, started_at, traffic_limit_bytes, traffic_used_bytes, device_limit, extra_devices, extra_traffic_bytes, sub_url)
    values (${userId}, ${spec.planId ?? prev?.plan_id ?? null}, ${spec.planName ?? prev?.plan_name ?? null}, ${isTrial}, ${expiresAt},
            ${prevActive ? prev!.started_at : new Date()}, ${trafficLimitBytes}, ${resetTraffic ? 0 : (prev?.traffic_used_bytes ?? 0)}, ${deviceLimit}, ${extraDev}, ${extraTr}, ${subUrl})
    on conflict (user_id) do update set
      plan_id = excluded.plan_id, plan_name = excluded.plan_name, is_trial = excluded.is_trial,
      expires_at = excluded.expires_at, started_at = excluded.started_at,
      traffic_limit_bytes = excluded.traffic_limit_bytes, traffic_used_bytes = excluded.traffic_used_bytes,
      device_limit = excluded.device_limit, extra_devices = excluded.extra_devices, extra_traffic_bytes = excluded.extra_traffic_bytes, sub_url = excluded.sub_url,
      notified = '{}'::jsonb, updated_at = now()`;
  return { expiresAt, subUrl, previous: prev ?? null };
}

export async function startTrial(userId: string): Promise<GrantResult> {
  const trial = await getSettings('trial');
  if (!trial.enabled) throw conflict('Пробный период отключён', 'trial_disabled');
  const [u0] = await sql()<UserRow[]>`select * from users where id = ${userId}`;
  // без Telegram пробного периода нет: от повторных пробных защищает метка по tg_id, а подписку на канал проверить не на чем
  if (u0 && u0.tg_id == null) throw conflict('Для пробного периода привяжите Telegram', 'telegram_required');
  if (trial.require_channel) {
    if (u0 && !(await passesChannelCheck(u0)) && !(await isTgAdmin(u0.tg_id))) throw conflict('Для пробного периода подпишитесь на канал', 'subscribe_required');
  }
  await assertNotMaintenance();
  await assertSalesOpen();
  return sql()
    .begin(async (tx) => {
      const [u] = await tx<UserRow[]>`select * from users where id = ${userId} for update`;
      if (!u) throw badRequest('Пользователь не найден');
      const [sub] = await tx`select 1 from subscriptions where user_id = ${userId}`;
      const [blocked] = await tx`select 1 from trial_cleanup_tombstones where tg_id=${u.tg_id}`;
      if (u.trial_used || sub || blocked) throw conflict('Пробный период уже использован. Выберите платный тариф.', 'trial_used');
      const r = await grantAccess(tx, userId, {
        days: trial.days,
        trafficLimitBytes: trial.traffic_gb * GB,
        deviceLimit: trial.device_limit,
        planName: 'Пробный период',
        isTrial: true,
        resetTraffic: true,
      });
      await tx`update users set trial_used = true where id = ${userId}`;
      await tx`insert into trial_activations(user_id) values(${userId}) on conflict do nothing`;
      return r;
    })
    .catch(rwErrorToHttp);
}

/** Выдача дней (админ, промокод, реферал) — без изменения лимитов */
export async function extendDays(userId: string, days: number): Promise<GrantResult> {
  return sql()
    .begin((tx) => grantAccess(tx, userId, { days }))
    .catch(rwErrorToHttp);
}

export async function resetSubscriptionLink(userId: string): Promise<string | null> {
  const [u] = await sql()<UserRow[]>`select * from users where id = ${userId}`;
  if (!u?.rw_id) throw badRequest('Подписка ещё не создана');
  try {
    const rw = await remnawave.revokeSubscription(u.rw_id);
    await sql()`update users set rw_short_uuid = ${rw.shortUuid} where id = ${userId}`;
    await sql()`update subscriptions set sub_url = ${rw.subscriptionUrl ?? null}, updated_at = now() where user_id = ${userId}`;
    return rw.subscriptionUrl ?? null;
  } catch (e) {
    return rwErrorToHttp(e);
  }
}

/** Блокировка/разблокировка: отключаем доступ и в панели */
export async function setBanned(userId: string, banned: boolean): Promise<void> {
  const [u] = await sql()<UserRow[]>`update users set status = ${banned ? 'banned' : 'active'} where id = ${userId} returning *`;
  if (u?.rw_id) {
    try {
      await remnawave.setStatus(u.rw_id, !banned);
    } catch (e) {
      rwErrorToHttp(e);
    }
  }
}

const liveCache = new Map<string, { at: number; used: number }>();

export async function getSubscriptionRow(userId: string, db: Sql | TxSql = sql()): Promise<SubscriptionRow | null> {
  const [s] = await db<SubscriptionRow[]>`select * from subscriptions where user_id = ${userId}`;
  return s ?? null;
}

export async function getSubscriptionDTO(user: UserRow, opts: { live?: boolean } = {}): Promise<SubscriptionDTO> {
  const sub = await getSubscriptionRow(user.id);
  if (!sub) {
    return { state: 'none', planName: null, expiresAt: null, daysLeft: 0, totalDays: 0, trafficUsedBytes: 0, trafficLimitBytes: 0, deviceLimit: 0, extraDevices: 0, extraTrafficBytes: 0, subUrl: null, isTrial: false, autoRenew: user.auto_renew };
  }
  let used = sub.traffic_used_bytes;
  if (opts.live && user.rw_id) {
    const c = liveCache.get(user.id);
    if (c && Date.now() - c.at < 30_000) used = c.used;
    else {
      try {
        const rw = await remnawave.getUser(user.rw_id);
        used = rw.userTraffic?.usedTrafficBytes ?? used;
        liveCache.set(user.id, { at: Date.now(), used });
        if (used !== sub.traffic_used_bytes) await sql()`update subscriptions set traffic_used_bytes = ${used} where user_id = ${user.id}`;
      } catch {
        /* показываем закэшированное значение */
      }
    }
  }
  let lte:Awaited<ReturnType<typeof lteQuota>>=null;let lteUnavailable=false;
  if(lteEnabled())try{lte=await lteQuota(user.rw_id,user.rw_username);}catch{lteUnavailable=true;}
  const now = Date.now();
  const daysLeft = Math.max(0, Math.ceil((sub.expires_at.getTime() - now) / DAY));
  const totalDays = Math.max(daysLeft, Math.ceil((sub.expires_at.getTime() - sub.started_at.getTime()) / DAY));
  return {
    state: subscriptionState(sub.expires_at, sub.is_trial),
    planName: sub.plan_name,
    expiresAt: sub.expires_at.toISOString(),
    daysLeft,
    totalDays,
    trafficUsedBytes: used,
    trafficLimitBytes: lteEnabled()?0:sub.traffic_limit_bytes,
    ...(lteEnabled()?{lte:lte?{usedBytes:lte.usedBytes,baseBytes:lte.baseBytes,extraBytes:lte.extraBytes,limitBytes:lte.limitBytes,remainingBytes:lte.remainingBytes,optedOut:lte.optedOut,nextExpiry:lte.nextExpiry}:null,lteUnavailable}:{}),
    deviceLimit: sub.device_limit,
    extraDevices: sub.extra_devices ?? 0,
    extraTrafficBytes: Number(sub.extra_traffic_bytes ?? 0),
    subUrl: sub.sub_url,
    isTrial: sub.is_trial,
    autoRenew: user.auto_renew,
  };
}
