import { z } from 'zod';
import { config } from '../config.js';
import { badGateway, escapeHtml } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { alertAdminsThrottled } from './alerts.js';
import { getSettings, settingsIssues } from './settings.js';

/**
 * Клиент Remnawave Panel API (панель 3.x). Схемы описаны терпимо — только нужные нам поля.
 * Все ответы панели приходят в конверте { response: ... }.
 */
const userSchema = z
  .object({
    id: z.number(),
    shortUuid: z.string(),
    username: z.string(),
    status: z.string(),
    trafficLimitBytes: z.number().nullish(),
    expireAt: z.string(),
    subscriptionUrl: z.string().nullish(),
    hwidDeviceLimit: z.number().nullish(),
    userTraffic: z.object({ usedTrafficBytes: z.number().nullish() }).passthrough().nullish(),
  })
  .passthrough();
export type RwUser = z.infer<typeof userSchema>;

const nodeSchema = z
  .object({
    uuid: z.string(),
    name: z.string(),
    address: z.string().nullish(),
    countryCode: z.string().nullish(),
    isConnected: z.boolean().nullish(),
    isDisabled: z.boolean().nullish(),
    usersOnline: z.number().nullish(),
    xrayUptime: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();
const hostSchema = z.object({ uuid: z.string(), remark: z.string().nullish(), address: z.string() }).passthrough();
export type RwHost = z.infer<typeof hostSchema>;
export type RwNode = z.infer<typeof nodeSchema>;

const hwidDeviceSchema = z
  .object({
    hwid: z.string(),
    platform: z.string().nullish(),
    osVersion: z.string().nullish(),
    deviceModel: z.string().nullish(),
    userAgent: z.string().nullish(),
    createdAt: z.string().nullish(),
    updatedAt: z.string().nullish(),
  })
  .passthrough();
export type RwDevice = z.infer<typeof hwidDeviceSchema>;
const hwidListSchema = z.object({ total: z.number().nullish(), devices: z.array(hwidDeviceSchema) }).passthrough();

const squadSchema = z.object({ uuid: z.string(), name: z.string() }).passthrough();

export interface RwUserInput {
  username?: string;
  expireAt: Date;
  trafficLimitBytes: number;
  hwidDeviceLimit: number;
  telegramId?: number | null;
  status?: 'ACTIVE' | 'DISABLED';
  description?: string;
  activeInternalSquads?: string[];
  /** только при создании: сохранить прежнюю ссылку подписки (восстановление панели) */
  shortUuid?: string;
}

export class RemnawaveError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

/** Строгий UUID — как z.uuid() в zod 4, которым панель (nestjs-zod) валидирует activeInternalSquads */
export const UUID_RE = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/;
export const RW_USERNAME_RE = /^[a-zA-Z0-9_-]{3,36}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v.trim());

/** Таймаут одного запроса к панели. Короткий: часть вызовов идёт внутри транзакции БД. */
const TIMEOUT_MS = 8000;

async function creds() {
  const s = await getSettings('remnawave');
  const url = (s.url || config().REMNAWAVE_URL).replace(/\/+$/, '');
  const token = s.token || config().REMNAWAVE_TOKEN;
  const squad = (s.squad_uuid || config().REMNAWAVE_SQUAD_UUID || '').trim();
  return { url, token, squad };
}

/** Тело ошибки nestjs-zod: { statusCode, message: 'Validation failed', errors: [zod issues] } → «path: message; …» */
export function describePanelErrors(json: any): string {
  const errs = Array.isArray(json?.errors) ? json.errors : Array.isArray(json?.issues) ? json.issues : null;
  if (!errs?.length) return '';
  return errs
    .slice(0, 8)
    .map((i: any) => {
      const path = Array.isArray(i?.path) ? i.path.join('.') : typeof i?.path === 'string' ? i.path : '';
      const msg = String(i?.message ?? i?.code ?? JSON.stringify(i)).slice(0, 200);
      return path ? `${path}: ${msg}` : msg;
    })
    .join('; ');
}

async function request<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown, attempt = 0): Promise<T> {
  const { url, token } = await creds();
  if (!url || !token) throw new RemnawaveError('Remnawave не настроена (URL/токен)');
  // чтение повторяем дважды; изменяющие запросы — один раз (они идемпотентны по смыслу, но держат транзакцию БД)
  const maxRetries = method === 'GET' ? 2 : 1;
  let res: Response;
  try {
    res = await fetch(url + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        // Панель принимает запросы только "через прокси"; из внутренней docker-сети подставляем заголовки сами.
        'x-forwarded-for': '127.0.0.1',
        'x-forwarded-proto': 'https',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      return request(method, path, schema, body, attempt + 1);
    }
    log.error('remnawave unreachable', { method, path, err: (e as Error).message });
    throw new RemnawaveError(`Remnawave недоступна: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    if (res.status >= 500 && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return request(method, path, schema, body, attempt + 1);
    }
    const details = describePanelErrors(json);
    const base = typeof json?.message === 'string' ? json.message : text.slice(0, 200);
    const msg = `Remnawave ${method} ${path} → ${res.status}: ${base}${details ? ` (${details})` : ''}`;
    log.error('remnawave request failed', { method, path, status: res.status, message: base, errors: details || undefined });
    throw new RemnawaveError(msg, res.status, json);
  }
  const parsed = schema.safeParse(json?.response ?? json);
  if (!parsed.success) {
    throw new RemnawaveError(`Неожиданный ответ Remnawave на ${method} ${path}: ${parsed.error.issues[0]?.message}`, res.status, json);
  }
  return parsed.data;
}

const anyOk = z.any();

/** Только корректные UUID, без дублей. Некорректные — в лог (их не пропустит валидация панели). */
export function sanitizeSquads(list: readonly unknown[] | undefined): string[] | undefined {
  if (!list) return undefined;
  const out: string[] = [];
  const bad: unknown[] = [];
  for (const raw of list) {
    const v = typeof raw === 'string' ? raw.trim() : raw;
    if (isUuid(v)) {
      if (!out.includes(v)) out.push(v);
    } else bad.push(raw);
  }
  if (bad.length) log.warn('remnawave: dropped invalid squad uuids', { bad: bad.map((b) => String(b).slice(0, 80)) });
  return out;
}

const int0 = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));

function cleanDescription(d: string | undefined | null): string | undefined {
  const t = (d ?? '').trim().slice(0, 200);
  return t ? t : undefined;
}

// ---------- Сквады: кэш списка и выбор основного ----------
type Squad = z.infer<typeof squadSchema>;
let squadCache: { at: number; list: Squad[] } | null = null;
const SQUAD_TTL = 60_000;

export function clearSquadCache() {
  squadCache = null;
}

async function cachedSquads(force = false): Promise<Squad[]> {
  if (!force && squadCache && Date.now() - squadCache.at < SQUAD_TTL) return squadCache.list;
  const r = await request('GET', '/api/internal-squads/', z.object({ internalSquads: z.array(squadSchema) }));
  squadCache = { at: Date.now(), list: r.internalSquads };
  return r.internalSquads;
}

function pickFallback(list: Squad[]): Squad | undefined {
  const valid = list.filter((s) => isUuid(s.uuid));
  return valid.find((s) => /default/i.test(s.name)) ?? valid[0];
}

export interface SquadResolution {
  uuid?: string;
  name?: string;
  source: 'settings' | 'auto' | 'none';
  /** Проблема с настройкой (по-русски), если пришлось взять запасной сквад */
  problem?: string;
  configured?: string;
}

/** Определяет основной сквад: из настроек, а если он некорректен/не найден — запасной из панели (с оповещением админов). */
export async function resolveSquad(opts: { force?: boolean; alert?: boolean } = {}): Promise<SquadResolution> {
  const { squad } = await creds();
  const invalidStored = settingsIssues('remnawave').squad_uuid;
  const configured = squad || (typeof invalidStored === 'string' ? invalidStored.trim() : '');
  let list: Squad[];
  try {
    list = await cachedSquads(opts.force);
  } catch (e) {
    // список недоступен: если настроенный UUID корректен — используем его, иначе ошибка панели всплывёт выше
    if (isUuid(configured)) return { uuid: configured, source: 'settings', configured };
    throw e;
  }
  let problem: string | undefined;
  if (configured) {
    if (!isUuid(configured)) {
      problem = `В настройках Remnawave указан некорректный UUID сквада: «${String(configured).slice(0, 64)}»`;
    } else {
      const found = list.find((s) => s.uuid.toLowerCase() === configured.toLowerCase());
      if (found) return { uuid: found.uuid, name: found.name, source: 'settings', configured };
      problem = `Сквад ${configured} из настроек Remnawave не найден в панели`;
    }
  }
  const fb = pickFallback(list);
  if (problem) {
    problem += fb ? `. Используется сквад «${fb.name}».` : '. В панели нет ни одного сквада.';
    if (opts.alert !== false) {
      void alertAdminsThrottled('rw-squad-config', `⚠️ <b>Remnawave: проблема со сквадом</b>\n${escapeHtml(problem)}\nИсправьте в админке: Настройки → Remnawave.`, 3600);
      log.warn('remnawave squad fallback', { problem });
    }
  }
  if (!fb) return { source: 'none', problem, configured: configured || undefined };
  return { uuid: fb.uuid, name: fb.name, source: 'auto', problem, configured: configured || undefined };
}

export const remnawave = {
  async isConfigured(): Promise<boolean> {
    const { url, token } = await creds();
    return Boolean(url && token);
  },

  async getSquadUuid(): Promise<string | undefined> {
    return (await resolveSquad()).uuid;
  },

  async listSquads() {
    return cachedSquads(true);
  },

  async createUser(input: RwUserInput & { username: string }): Promise<RwUser> {
    const username = input.username.trim();
    if (!RW_USERNAME_RE.test(username)) throw new RemnawaveError(`Некорректное имя пользователя для Remnawave: «${username.slice(0, 50)}»`, 400);
    const requested = input.activeInternalSquads ?? (await remnawave.getSquadUuid().then((s) => (s ? [s] : undefined)));
    const squads = sanitizeSquads(requested);
    const description = cleanDescription(input.description);
    return request('POST', '/api/users/', userSchema, {
      username,
      status: input.status ?? 'ACTIVE',
      expireAt: input.expireAt.toISOString(),
      trafficLimitBytes: int0(input.trafficLimitBytes),
      trafficLimitStrategy: 'NO_RESET',
      hwidDeviceLimit: int0(input.hwidDeviceLimit),
      ...(typeof input.telegramId === 'number' && Number.isFinite(input.telegramId) ? { telegramId: Math.round(input.telegramId) } : {}),
      ...(description ? { description } : {}),
      ...(squads?.length ? { activeInternalSquads: squads } : {}),
      ...(input.shortUuid ? { shortUuid: input.shortUuid } : {}),
    });
  },

  async updateUser(id: number, input: Partial<RwUserInput>): Promise<RwUser> {
    const squads = sanitizeSquads(input.activeInternalSquads);
    const description = input.description !== undefined ? cleanDescription(input.description) : undefined;
    return request('PATCH', '/api/users/', userSchema, {
      id,
      ...(input.expireAt ? { expireAt: input.expireAt.toISOString() } : {}),
      ...(input.trafficLimitBytes !== undefined ? { trafficLimitBytes: int0(input.trafficLimitBytes) } : {}),
      ...(input.hwidDeviceLimit !== undefined ? { hwidDeviceLimit: int0(input.hwidDeviceLimit) } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.telegramId !== undefined ? { telegramId: typeof input.telegramId === 'number' ? Math.round(input.telegramId) : null } : {}),
      ...(description ? { description } : {}),
      // пустой список после очистки не отправляем — иначе панель отключит пользователя от всех сквадов
      ...(squads?.length ? { activeInternalSquads: squads } : {}),
    });
  },

  getUser(id: number): Promise<RwUser> {
    return request('GET', `/api/users/${id}`, userSchema);
  },

  async getUserByUsername(username: string): Promise<RwUser | null> {
    try {
      return await request('GET', `/api/users/by-username/${encodeURIComponent(username)}`, userSchema);
    } catch (e) {
      if (e instanceof RemnawaveError && e.status === 404) return null;
      throw e;
    }
  },

  async getUserByShortUuid(shortUuid: string): Promise<RwUser | null> {
    try {
      return await request('GET', `/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`, userSchema);
    } catch (e) {
      if (e instanceof RemnawaveError && e.status === 404) return null;
      throw e;
    }
  },

  revokeSubscription(id: number): Promise<RwUser> {
    return request('POST', `/api/users/${id}/actions/revoke`, userSchema, {});
  },

  async setStatus(id: number, enabled: boolean): Promise<void> {
    await request('POST', `/api/users/${id}/actions/${enabled ? 'enable' : 'disable'}`, anyOk, {});
  },

  async resetTraffic(id: number): Promise<void> {
    await request('POST', `/api/users/${id}/actions/reset-traffic`, anyOk, {});
  },

  async deleteUser(id: number): Promise<void> {
    await request('DELETE', `/api/users/${id}`, anyOk);
  },

  async listDevices(userId: number): Promise<RwDevice[]> {
    return (await request('GET', `/api/hwid/devices/${userId}`, hwidListSchema)).devices;
  },

  async deleteDevice(userId: number, hwid: string): Promise<RwDevice[]> {
    return (await request('POST', '/api/hwid/devices/delete', hwidListSchema, { userId, hwid })).devices;
  },

  async deleteAllDevices(userId: number): Promise<void> {
    await request('POST', '/api/hwid/devices/delete-all', hwidListSchema, { userId });
  },

  async listNodes(): Promise<RwNode[]> {
    return request('GET', '/api/nodes/', z.array(nodeSchema));
  },

  async updateNode(uuid: string, patch: { address?: string; name?: string }): Promise<void> {
    await request('PATCH', '/api/nodes', anyOk, { uuid, ...patch });
  },

  async restartNode(uuid: string): Promise<void> {
    await request('POST', `/api/nodes/${uuid}/actions/restart`, anyOk, {});
  },

  async listHosts(): Promise<RwHost[]> {
    return request('GET', '/api/hosts', z.array(hostSchema));
  },

  async updateHost(uuid: string, patch: { address: string }): Promise<void> {
    await request('PATCH', '/api/hosts', anyOk, { uuid, ...patch });
  },

  /** Проверка подключения для админки: ноды, сквады и основной сквад из настроек */
  async ping(): Promise<{ nodes: number; squads: number; squadName?: string; squadUuid?: string; squadSource: SquadResolution['source']; squadProblem?: string }> {
    const nodes = await remnawave.listNodes();
    const squads = await cachedSquads(true);
    const r = await resolveSquad({ alert: false });
    const squadProblem = r.problem ?? (r.source === 'none' ? 'В панели нет ни одного внутреннего сквада — пользователи будут созданы без доступа к нодам' : undefined);
    return { nodes: nodes.length, squads: squads.length, squadName: r.name, squadUuid: r.uuid, squadSource: r.source, squadProblem };
  },
};

export const RW_USER_MESSAGE = 'Не удалось выдать доступ: сервис VPN временно недоступен. Мы уже разбираемся — попробуйте через пару минут.';

/** Ошибка панели → 502 с понятным текстом для пользователя; технические детали — в лог и админам. */
export function rwErrorToHttp(e: unknown): never {
  if (e instanceof RemnawaveError) {
    log.error('remnawave error', { message: e.message, status: e.status });
    void alertAdminsThrottled('rw-error', `🔴 <b>Ошибка Remnawave при выдаче доступа</b>\n<code>${escapeHtml(e.message.slice(0, 1500))}</code>`, 600);
    throw badGateway(RW_USER_MESSAGE, 'remnawave', e.message);
  }
  throw e;
}
