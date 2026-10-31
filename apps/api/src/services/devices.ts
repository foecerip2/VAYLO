import { createHash } from 'node:crypto';
import type { SubscriptionRow, UserRow } from '../db/types.js';
import { sql } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { remnawave, rwErrorToHttp, type RwDevice } from './remnawave.js';

export interface DeviceDTO {
  /** Короткий идентификатор (хэш HWID) — безопасно передавать в callback-кнопки бота */
  id: string;
  name: string;
  platform: string | null;
  addedAt: string | null;
  lastSeenAt: string | null;
}
export interface DevicesDTO {
  limit: number; // 0 = безлимит
  extraDevices: number;
  used: number;
  devices: DeviceDTO[];
  active: boolean;
}

const idOf = (hwid: string) => createHash('sha256').update(hwid).digest('hex').slice(0, 16);

function nameOf(d: RwDevice): string {
  const model = d.deviceModel?.trim();
  const os = [d.platform, d.osVersion].filter(Boolean).join(' ').trim();
  if (model && os) return `${model} · ${os}`;
  if (model) return model;
  if (os) return os;
  const ua = d.userAgent?.trim();
  if (ua) return ua.slice(0, 40);
  return 'Устройство ' + d.hwid.slice(0, 6);
}

async function subOf(user: UserRow): Promise<SubscriptionRow | null> {
  const [sub] = await sql()<SubscriptionRow[]>`select * from subscriptions where user_id = ${user.id}`;
  return sub ?? null;
}

export async function listDevices(user: UserRow): Promise<DevicesDTO> {
  const sub = await subOf(user);
  if (!user.rw_id || !sub) return { limit: 0, extraDevices: 0, used: 0, devices: [], active: false };
  let raw: RwDevice[];
  try {
    raw = await remnawave.listDevices(user.rw_id);
  } catch (e) {
    rwErrorToHttp(e);
  }
  const devices = raw
    .map((d) => ({ id: idOf(d.hwid), name: nameOf(d), platform: d.platform ?? null, addedAt: d.createdAt ?? null, lastSeenAt: d.updatedAt ?? d.createdAt ?? null }))
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  return { limit: sub.device_limit, extraDevices: sub.extra_devices ?? 0, used: devices.length, devices, active: sub.expires_at.getTime() > Date.now() };
}

export async function removeDevice(user: UserRow, id: string): Promise<DevicesDTO> {
  if (!user.rw_id) throw conflict('Подписка не активна', 'no_subscription');
  let raw: RwDevice[];
  try {
    raw = await remnawave.listDevices(user.rw_id);
  } catch (e) {
    rwErrorToHttp(e);
  }
  const d = raw.find((x) => idOf(x.hwid) === id);
  if (!d) throw notFound('Устройство уже удалено');
  try {
    await remnawave.deleteDevice(user.rw_id, d.hwid);
  } catch (e) {
    rwErrorToHttp(e);
  }
  return listDevices(user);
}

export async function removeAllDevices(user: UserRow): Promise<DevicesDTO> {
  if (!user.rw_id) throw conflict('Подписка не активна', 'no_subscription');
  try {
    await remnawave.deleteAllDevices(user.rw_id);
  } catch (e) {
    rwErrorToHttp(e);
  }
  return listDevices(user);
}
