import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { isInternal } from './auth.js';
import { forbidden, unauthorized } from './errors.js';

export const PROBE_SCOPES = ['probe:write', 'probe:read'] as const;
export type ProbeScope = (typeof PROBE_SCOPES)[number];
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Выпуск токена: само значение возвращается один раз, в БД только хэш. Admin-scope не существует. */
export async function issueProbeToken(input: { label: string; scopes: ProbeScope[]; createdBy?: string; expiresInDays?: number | null }) {
  const token = 'vp_' + randomBytes(32).toString('base64url');
  const [r] = await sql()`insert into probe_tokens (label, token_hash, scopes, created_by, expires_at)
    values (${input.label.slice(0, 60)}, ${hash(token)}, ${input.scopes}, ${input.createdBy ?? null},
      ${input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null}) returning id`;
  return { id: r!.id as string, token };
}

export async function revokeProbeToken(id: string): Promise<boolean> {
  const r = await sql()`update probe_tokens set revoked_at = now() where id = ${id} and revoked_at is null returning id`;
  return r.length > 0;
}

export async function listProbeTokens() {
  const rows = await sql()`select id, label, scopes, created_at, expires_at, revoked_at, last_used_at from probe_tokens order by created_at desc limit 200`;
  return rows.map((r) => ({
    id: r.id as string, label: r.label as string, scopes: r.scopes as string[],
    createdAt: (r.created_at as Date).toISOString(), expiresAt: (r.expires_at as Date | null)?.toISOString() ?? null,
    revokedAt: (r.revoked_at as Date | null)?.toISOString() ?? null, lastUsedAt: (r.last_used_at as Date | null)?.toISOString() ?? null,
  }));
}

export interface ProbeIdentity { probeId: string | null; label: string; legacy: boolean }

/**
 * Проверка автора отчёта пробы. Токен — заголовок x-probe-token.
 * Старый общий INTERNAL_KEY принимается только пока NETPROBE_SCOPED_AUTH выключен.
 */
export async function requireProbe(req: FastifyRequest, scope: ProbeScope): Promise<ProbeIdentity> {
  const given = req.headers['x-probe-token'];
  if (typeof given === 'string' && given.startsWith('vp_') && given.length < 100) {
    const [t] = await sql()`select id, label, scopes, expires_at, revoked_at from probe_tokens where token_hash = ${hash(given)}`;
    if (!t || t.revoked_at || (t.expires_at && (t.expires_at as Date).getTime() < Date.now())) throw unauthorized();
    if (!(t.scopes as string[]).includes(scope)) throw forbidden();
    await sql()`update probe_tokens set last_used_at = now() where id = ${t.id}`;
    return { probeId: t.id as string, label: t.label as string, legacy: false };
  }
  if (!config().NETPROBE_SCOPED_AUTH && isInternal(req)) return { probeId: null, label: '', legacy: true };
  throw unauthorized();
}
