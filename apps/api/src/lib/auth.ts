import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { AdminRow, UserRow } from '../db/types.js';
import { safeEqual } from './crypto.js';
import { forbidden, unauthorized } from './errors.js';
import { verifyToken } from './jwt.js';
import type { TgUser } from './telegram.js';
import { upsertTelegramUser } from '../services/users.js';
import { ROLE_LEVEL, type AdminRole } from '@vpn/shared';
import { enforceGate } from '../services/gate.js';

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export function isInternal(req: FastifyRequest): boolean {
  const k = config().INTERNAL_KEY;
  const given = req.headers['x-internal-key'];
  return Boolean(k) && typeof given === 'string' && safeEqual(given, k);
}

/** Пользователь: JWT, либо внутренний вызов бота (x-internal-key + x-tg-user в base64 JSON) */
export async function requireUser(req: FastifyRequest, opts: { gate?: boolean } = {}): Promise<UserRow> {
  let user: UserRow | undefined;
  if (isInternal(req)) {
    const raw = req.headers['x-tg-user'];
    if (typeof raw !== 'string') throw unauthorized('Нет x-tg-user');
    let tg: TgUser;
    try {
      tg = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      throw unauthorized('Некорректный x-tg-user');
    }
    if (typeof tg?.id !== 'number') throw unauthorized('Некорректный x-tg-user');
    const ref = typeof req.headers['x-ref-code'] === 'string' ? (req.headers['x-ref-code'] as string) : null;
    user = await upsertTelegramUser(tg, ref);
  } else {
    const t = bearer(req);
    if (!t) throw unauthorized();
    const v = await verifyToken(t, 'user');
    if (!v) throw unauthorized('Сессия истекла, войдите заново');
    const [u] = await sql()<UserRow[]>`select * from users where id = ${v.sub}`;
    user = u;
  }
  if (!user) throw unauthorized();
  if (user.status === 'banned') throw forbidden('Аккаунт заблокирован');
  if (opts.gate !== false) await enforceGate(user);
  return user;
}

export async function requireAdmin(req: FastifyRequest, minRole: AdminRole = 'analyst'): Promise<AdminRow> {
  let a: AdminRow | undefined;
  if (isInternal(req) && typeof req.headers['x-tg-user'] === 'string') {
    // администратор, пришедший из Telegram-бота: определяем по tg_id
    let tgId: number | undefined;
    try {
      tgId = JSON.parse(Buffer.from(req.headers['x-tg-user'] as string, 'base64').toString('utf8'))?.id;
    } catch {
      /* ignore */
    }
    if (typeof tgId !== 'number') throw unauthorized();
    [a] = await sql()<AdminRow[]>`select * from admins where tg_id = ${tgId}`;
  } else {
    const t = bearer(req);
    if (!t) throw unauthorized();
    const v = await verifyToken(t, 'admin');
    if (!v) throw unauthorized('Сессия истекла');
    [a] = await sql()<AdminRow[]>`select * from admins where id = ${v.sub}`;
    // пароль сменили или нажали «выйти на всех устройствах» — старые токены больше не действуют
    if (a && (v.ep ?? 0) !== (a.session_epoch ?? 0)) throw unauthorized('Сессия завершена — войдите снова');
  }
  if (!a) throw unauthorized();
  if (ROLE_LEVEL[a.role] < ROLE_LEVEL[minRole]) throw forbidden();
  return a;
}

export async function audit(admin: AdminRow, req: FastifyRequest, action: string, entity?: string, entityId?: string, data?: unknown) {
  await sql()`insert into audit_log (admin_id, admin_email, action, entity, entity_id, data, ip)
    values (${admin.id}, ${admin.email}, ${action}, ${entity ?? null}, ${entityId ?? null}, ${data === undefined ? null : sql().json(data as any)}, ${req.ip})`;
}
