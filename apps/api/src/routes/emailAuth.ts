import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isInternal, requireUser } from '../lib/auth.js';
import { unauthorized } from '../lib/errors.js';
import {
  changePassword,
  completePasswordReset,
  confirmAccountAction,
  emailSchema,
  loginByEmail,
  passwordResetStatus,
  passwordSchema,
  registerByEmail,
  setCredentials,
  startPasswordReset,
  startTelegramLink,
  telegramLinkStatus,
} from '../services/emailAuth.js';

const token = z.string().min(10).max(64);
const limit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

/** Telegram id вызывающего из заголовка бота. Пользователя НЕ создаём (в отличие от requireUser): привязка и сброс не должны плодить аккаунты. */
function botTgId(req: FastifyRequest): number {
  const raw = req.headers['x-tg-user'];
  if (typeof raw === 'string' && raw.length < 4096) {
    try {
      const id = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))?.id;
      if (typeof id === 'number' && Number.isSafeInteger(id)) return id;
    } catch {
      /* ниже */
    }
  }
  throw unauthorized('Некорректный x-tg-user');
}

/** Вход по почте и паролю для клиентов (Android-приложение). Контракт: docs/android/API.md */
export async function emailAuthRoutes(app: FastifyInstance) {
  const me = (req: FastifyRequest) => requireUser(req, { gate: false });

  app.post('/auth/email/register', limit(10, '1 hour'), async (req) => {
    const b = z.object({ email: emailSchema, password: passwordSchema }).parse(req.body);
    return registerByEmail(b.email, b.password);
  });

  app.post('/auth/email/login', limit(10, '1 minute'), async (req) => {
    const b = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).parse(req.body);
    return loginByEmail(b.email, b.password);
  });

  app.post('/auth/email/reset/start', limit(5, '1 minute'), async (req) => {
    const b = z.object({ email: emailSchema }).parse(req.body);
    return startPasswordReset(b.email);
  });

  app.get('/auth/email/reset/:token', async (req) => ({ status: await passwordResetStatus(z.object({ token }).parse(req.params).token) }));

  app.post('/auth/email/reset/complete', limit(10, '1 minute'), async (req) => {
    const b = z.object({ token, password: passwordSchema }).parse(req.body);
    return completePasswordReset(b.token, b.password);
  });

  app.post('/me/credentials', limit(10, '1 minute'), async (req) => {
    const user = await me(req);
    const b = z.object({ email: emailSchema, password: passwordSchema }).parse(req.body);
    return setCredentials(user, b.email, b.password);
  });

  app.post('/me/password', limit(5, '1 minute'), async (req) => {
    const user = await me(req);
    const b = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).parse(req.body);
    return changePassword(user, b.currentPassword, b.newPassword);
  });

  app.post('/me/telegram/link/start', limit(10, '1 minute'), async (req) => startTelegramLink(await me(req)));

  app.get('/me/telegram/link/:token', async (req) => {
    const user = await me(req);
    return { status: await telegramLinkStatus(user, z.object({ token }).parse(req.params).token) };
  });

  // вызывает только бот
  app.post('/internal/account-action/confirm', async (req) => {
    if (!isInternal(req)) throw unauthorized();
    return confirmAccountAction(botTgId(req), z.object({ token }).parse(req.body).token);
  });
}
