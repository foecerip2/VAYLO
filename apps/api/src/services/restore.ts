import { sql } from '../db/index.js';
import { log } from '../lib/log.js';
import { RemnawaveError, remnawave } from './remnawave.js';
import { rwUsernameFor, squadsFor } from './subscriptions.js';
import type { UserRow } from '../db/types.js';

export interface RestoreState {
  running: boolean;
  dryRun: boolean;
  includeExpired: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  created: number;
  existed: number;
  linkChanged: number;
  failed: number;
  errors: string[];
  warnings: string[];
  panel: { nodes: number; squads: number; squadName?: string } | null;
  fatal?: string;
}

const fresh = (): RestoreState => ({ running: false, dryRun: true, includeExpired: false, startedAt: null, finishedAt: null, total: 0, done: 0, created: 0, existed: 0, linkChanged: 0, failed: 0, errors: [], warnings: [], panel: null });
let state: RestoreState = fresh();
export const restoreState = (): RestoreState => state;

interface Row extends UserRow { sub_expires: Date; traffic_limit_bytes: string; device_limit: number }

/**
 * Восстановление пользователей в НОВОЙ панели Remnawave из базы VAYLO (после переустановки панели).
 * Идемпотентно: пользователь, который уже есть в панели (по username), только перепривязывается; повторный запуск безопасен.
 * Ссылка подписки сохраняется (shortUuid) — клиентам не нужно ничего перенастраивать.
 */
export async function startRestore(opts: { dryRun: boolean; includeExpired: boolean }): Promise<RestoreState> {
  if (state.running) throw new Error('Восстановление уже выполняется');
  state = { ...fresh(), running: true, dryRun: opts.dryRun, includeExpired: opts.includeExpired, startedAt: new Date().toISOString() };
  void run(opts).catch((e) => { state.fatal = (e as Error).message; }).finally(() => { state.running = false; state.finishedAt = new Date().toISOString(); });
  return state;
}

async function run(opts: { dryRun: boolean; includeExpired: boolean }): Promise<void> {
  if (!(await remnawave.isConfigured())) throw new Error('Remnawave не настроена: укажите адрес и API-токен новой панели в Настройки → Remnawave');
  const p = await remnawave.ping().catch((e) => { throw new Error('Панель недоступна: ' + (e as Error).message); });
  state.panel = { nodes: p.nodes, squads: p.squads, squadName: p.squadName };
  if (p.squadProblem) state.warnings.push(p.squadProblem);
  if (p.nodes === 0) state.warnings.push('В панели пока нет нод — пользователи восстановятся, но подключаться будет не к чему, пока вы не добавите ноды.');

  // премиум-локации: их сквады в новой панели имеют другие UUID — нужно перепривязать в «Докупки → Локации»
  const squads = await remnawave.listSquads();
  const known = new Set(squads.map((s) => s.uuid));
  const locs = await sql()<{ name: string; squad_uuid: string }[]>`select name, squad_uuid from locations where is_active`;
  for (const l of locs) if (!known.has(l.squad_uuid)) state.warnings.push(`Локация «${l.name}»: сквад ${l.squad_uuid} не найден в новой панели — создайте сквад заново и привяжите в «Докупки → Локации».`);

  const rows = await sql()<Row[]>`
    select u.*, s.expires_at as sub_expires, s.traffic_limit_bytes, s.device_limit
    from users u join subscriptions s on s.user_id = u.id
    where (u.rw_username is not null or u.rw_id is not null) and (${opts.includeExpired} or s.expires_at > now())
    order by u.created_at`;
  state.total = rows.length;
  if (opts.dryRun) { state.done = rows.length; return; }

  // старые rw_id указывают на несуществующих пользователей и мешали бы уникальности — сбрасываем, ниже проставим новые
  await sql()`update users set rw_id = null where id = any(${rows.map((r) => r.id)})`;

  let next = 0;
  const worker = async () => {
    for (;;) {
      const r = rows[next++];
      if (!r) return;
      try {
        await restoreOne(r);
      } catch (e) {
        state.failed++;
        if (state.errors.length < 30) state.errors.push(`${r.rw_username ?? r.tg_id ?? r.id}: ${(e as Error).message.slice(0, 200)}`);
        log.warn('restore user failed', { user: r.id, err: (e as Error).message });
      }
      state.done++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function restoreOne(r: Row): Promise<void> {
  const username = r.rw_username ?? rwUsernameFor(r);
  const subActive = r.sub_expires.getTime() > Date.now();
  const squads = await squadsFor(sql(), r.id, subActive);
  const payload = {
    expireAt: r.sub_expires,
    trafficLimitBytes: Number(r.traffic_limit_bytes),
    hwidDeviceLimit: r.device_limit,
    status: r.status === 'banned' ? ('DISABLED' as const) : ('ACTIVE' as const),
    activeInternalSquads: squads,
  };
  let rw = await remnawave.getUserByUsername(username);
  if (rw) {
    state.existed++;
  } else {
    const base = { username, telegramId: r.tg_id, description: r.username ? `@${r.username}` : undefined, ...payload };
    try {
      rw = await remnawave.createUser({ ...base, ...(r.rw_short_uuid ? { shortUuid: r.rw_short_uuid } : {}) });
    } catch (e) {
      // панель не приняла прежний shortUuid (занят/формат) — создаём с новым, ссылка поменяется
      if (e instanceof RemnawaveError && e.status === 400 && r.rw_short_uuid) rw = await remnawave.createUser(base);
      else throw e;
    }
    state.created++;
  }
  if (r.rw_short_uuid && rw.shortUuid !== r.rw_short_uuid) state.linkChanged++;
  await sql().begin(async (tx) => {
    await tx`update users set rw_id = ${rw!.id}, rw_short_uuid = ${rw!.shortUuid}, rw_username = ${rw!.username} where id = ${r.id}`;
    if (rw!.subscriptionUrl) await tx`update subscriptions set sub_url = ${rw!.subscriptionUrl} where user_id = ${r.id}`;
  });
}
