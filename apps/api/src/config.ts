import { z } from 'zod';

const flag = z.enum(['true', 'false', '1', '0', '']).default('false').transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@127.0.0.1:5432/vpn'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  APP_SECRET: z.string().min(32, 'APP_SECRET должен быть не короче 32 символов'),
  /** Публичные URL (без слеша на конце) */
  API_URL: z.string().default('http://localhost:3000'),
  APP_URL: z.string().default('http://localhost:5173'),
  ADMIN_URL: z.string().default('http://localhost:5174'),
  CORS_ORIGINS: z.string().optional(),
  BOT_TOKEN: z.string().default(''),
  BOT_USERNAME: z.string().default(''),
  TELEGRAM_API_ROOT: z.string().default('https://api.telegram.org'),
  /** Ключ для общения бота с API (внутренняя сеть) */
  INTERNAL_KEY: z.string().default(''),
  LTE_DATABASE_URL: z.string().default(''),
  LTE_NODE_ID: z.coerce.number().int().min(1).default(2),
  LTE_ACTIVITY_START_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const date = new Date(v + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, 'Нужна календарная дата YYYY-MM-DD').default('2026-10-25'),
  REMNAWAVE_URL: z.string().default(''),
  REMNAWAVE_TOKEN: z.string().default(''),
  REMNAWAVE_SQUAD_UUID: z.string().default(''),
  /** Для самоподписанных прокси, только dev */
  REMNAWAVE_INSECURE: z.coerce.boolean().default(false),
  /** Feature flags новых модулей (по умолчанию выключены) */
  NETPROBE_SCOPED_AUTH: flag,
  NETWORK_INTELLIGENCE_ENABLED: flag,
  NETWORK_INCIDENT_ALERTS_ENABLED: flag,
  NODE_RECOMMENDATIONS_ENABLED: flag,
  PRODUCT_ANALYTICS_ENABLED: flag,
  SUPPORT_AI_KNOWLEDGE_ENABLED: flag,
  UI_V2_ENABLED: flag,
  NETWORK_USER_NOTICES_ENABLED: flag,
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Некорректная конфигурация: ${msg}`);
  }
  return parsed.data;
}

export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}
