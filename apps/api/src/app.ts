import { supportRoutes } from './routes/support.js';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import './lib/zod-ru.js';
import { config } from './config.js';
import { isInternal } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { verifyToken } from './lib/jwt.js';
import { RemnawaveError, RW_USER_MESSAGE } from './services/remnawave.js';
import { adminRoutes } from './routes/admin/index.js';
import { publicRoutes } from './routes/public.js';
import { webhookRoutes } from './routes/webhooks.js';

/**
 * Ключ лимита запросов: запросы бота (валидный x-internal-key) считаем по Telegram ID из x-tg-user —
 * иначе все пользователи бота делят один IP контейнера. Остальные — по IP.
 */
export async function rateLimitKey(req: FastifyRequest): Promise<string> {

  if (isInternal(req)) {
    const raw = req.headers['x-tg-user'];
    if (typeof raw === 'string' && raw.length < 4096) {
      try {
        const id = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))?.id;
        if (typeof id === 'number' && Number.isFinite(id)) return `tg:${id}`;
      } catch {
        /* некорректный заголовок — считаем по IP */
      }
    }
  }
  // Авторизованный пользователь (подпись JWT проверена) — по своему id: у мобильных операторов один IP на десятки людей,
  // и счёт «по IP» блокировал бы приложение у честных пользователей. Без токена — по IP.
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ') && h.length < 1500) {
    const t = h.slice(7);
    const v = (await verifyToken(t, 'user')) ?? (await verifyToken(t, 'admin'));
    if (v) return `u:${v.sub}`;
  }
  return req.ip;
}

export function rateLimitError(_req: FastifyRequest, ctx: { statusCode: number; after: string }) {
  const err: any = new Error(ctx.statusCode === 403 ? 'Доступ временно ограничен из-за слишком частых запросов' : 'Слишком много запросов, попробуйте через минуту');
  err.statusCode = ctx.statusCode;
  err.code = 'rate_limited';
  return err;
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const cfg = config();
  const app = Fastify({ logger: opts.logger ?? cfg.NODE_ENV !== 'test', trustProxy: true, bodyLimit: 1024 * 256 });

  const origins = new Set([cfg.APP_URL, cfg.ADMIN_URL, ...(cfg.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])]);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.has(origin) || cfg.NODE_ENV !== 'production'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: '1 minute',
    allowList: (req) => cfg.NODE_ENV === 'test' || req.url.includes('/webhooks/'),
    keyGenerator: rateLimitKey,
    errorResponseBuilder: rateLimitError,
  });

  // Клиенты (бот, fetch) шлют POST с content-type: application/json и пустым телом — по умолчанию Fastify отвечает 400. Считаем пустое тело за {}.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString();
    (_req as { rawBody?: string }).rawBody = text; // для проверки подписи вебхуков
    if (!text.trim()) return done(null, {});
    try { done(null, JSON.parse(text)); } catch { const e: any = new Error('Некорректный JSON в теле запроса'); e.statusCode = 400; done(e, undefined); }
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      if (err.detail) req.log.error({ detail: err.detail, code: err.code }, 'upstream error');
      return reply.code(err.status).send({ error: { message: err.message, code: err.code } });
    }
    if (err instanceof RemnawaveError) {
      req.log.error({ err }, 'remnawave error');
      return reply.code(502).send({ error: { message: RW_USER_MESSAGE, code: 'remnawave' } });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: { message: err.issues[0]?.message ?? 'Некорректные данные', code: 'validation', field: err.issues[0]?.path.join('.') } });
    if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { message: err.message, code: err.code ?? 'bad_request' } });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { message: 'Внутренняя ошибка сервера', code: 'internal' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { message: 'Не найдено', code: 'not_found' } }));

  await app.register(
    async (v1) => {
      await v1.register(publicRoutes);
      await v1.register(webhookRoutes);
      await v1.register(supportRoutes);
      await v1.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api/v1' },
  );
  return app;
}
