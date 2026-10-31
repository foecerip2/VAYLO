import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const key = () => createHash('sha256').update('vpn-jwt:' + config().APP_SECRET).digest();

export async function signUserToken(userId: string): Promise<string> {
  return new SignJWT({ typ: 'user' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime('30d').sign(key());
}

export const ADMIN_TTL = { short: '12h', remember: '30d' } as const;

/** rem — «Запомнить меня» (30 дней, продлевается при работе); ep — эпоха сессий админа: смена пароля или «выйти везде» обнуляет все старые токены */
export async function signAdminToken(adminId: string, role: string, opts: { remember?: boolean; epoch?: number } = {}): Promise<string> {
  const rem = Boolean(opts.remember);
  return new SignJWT({ typ: 'admin', role, rem, ep: opts.epoch ?? 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(rem ? ADMIN_TTL.remember : ADMIN_TTL.short)
    .sign(key());
}

export async function verifyToken(token: string, typ: 'user' | 'admin'): Promise<{ sub: string; role?: string; rem?: boolean; ep?: number; exp?: number } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    if (payload.typ !== typ || !payload.sub) return null;
    return { sub: payload.sub, role: payload.role as string | undefined, rem: payload.rem === true, ep: typeof payload.ep === 'number' ? payload.ep : 0, exp: payload.exp };
  } catch {
    return null;
  }
}
