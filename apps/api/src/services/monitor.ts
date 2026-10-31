import { sql } from '../db/index.js';
import { escapeHtml } from '../lib/errors.js';
import { tgCall } from '../lib/telegram.js';
import { alertAdmins } from './alerts.js';
import { plategaBase } from './platega.js';
import { rollypayBase } from './rollypay.js';
import { remnawave } from './remnawave.js';
import { getSettings, setSettings } from './settings.js';
import { yookassa } from './yookassa.js';

export interface CheckResult {
  target: string;
  label: string;
  ok: boolean;
  detail?: string;
}

async function guard(target: string, label: string, fn: () => Promise<string | void>): Promise<CheckResult> {
  try {
    const d = await fn();
    return { target, label, ok: true, detail: d || undefined };
  } catch (e) {
    return { target, label, ok: false, detail: ((e as any).detail ?? (e as Error).message).slice(0, 200) };
  }
}

/** Собирает результаты всех проверок (без записи состояния) */
export async function runChecks(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  out.push(await guard('db', 'База данных', async () => void (await sql()`select 1`)));

  if (await remnawave.isConfigured()) {
    out.push(
      await guard('remnawave', 'Панель Remnawave', async () => {
        const p = await remnawave.ping();
        // проблема со сквадом не считается падением панели (работает запасной сквад), но видна в деталях
        return `нод: ${p.nodes}, сквадов: ${p.squads}` + (p.squadProblem ? ` · ⚠️ ${p.squadProblem}` : '');
      }),
    );
    try {
      const nodes = (await remnawave.listNodes()).filter((n) => !n.isDisabled);
      for (const n of nodes) {
        out.push({ target: `node:${n.uuid}`, label: `Нода ${n.name}`, ok: Boolean(n.isConnected), detail: n.isConnected ? `онлайн: ${n.usersOnline ?? 0}` : 'нет соединения с панелью' });
      }
    } catch {
      /* ошибка уже видна в проверке remnawave */
    }
  }

  const yk = await getSettings('yookassa');
  if (yk.enabled && yk.shop_id && yk.secret_key) out.push(await guard('yookassa', 'ЮKassa', () => yookassa.ping()));
  const pl = await getSettings('platega');
  if (pl.enabled && pl.merchant_id && pl.secret) {
    out.push(
      await guard('platega', 'Platega', async () => {
        const r = await fetch(plategaBase(), { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        if (!r.ok && ![401, 403, 404, 405].includes(r.status)) throw new Error(`HTTP ${r.status}`);
        return `HTTP ${r.status} · HTTP-узел отвечает; проведение платежей не проверялось`;
      }),
    );
  }
  const rp = await getSettings('rollypay');
  if (rp.enabled && rp.api_key) {
    out.push(
      await guard('rollypay', 'RollyPay', async () => {
        const r = await fetch(new URL(rollypayBase(rp)).origin, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        if (!r.ok && ![401, 403, 404, 405].includes(r.status)) throw new Error(`HTTP ${r.status}`);
        return `HTTP ${r.status} · HTTP-узел отвечает; проведение платежей не проверялось`;
      }),
    );
  }
  out.push(
    await guard('telegram', 'Telegram Bot API', async () => {
      const r = await tgCall<{ username: string }>('getMe', {});
      if (!r.ok) throw new Error(r.description ?? 'getMe failed');
      return '@' + r.result?.username;
    }),
  );
  const [stuck] = await sql()`select count(*)::int as n from payments where status = 'succeeded' and fulfilled_at is null and fulfill_failed_at is null and paid_at < now() - interval '10 minutes'`;
  out.push({ target: 'payments', label: 'Выдача оплаченных заказов', ok: stuck!.n === 0, detail: stuck!.n ? `не выполнено: ${stuck!.n}` : 'очередь пуста' });
  return out;
}

const alert = alertAdmins;

/** Записывает результат проверки, с «дребезгом»: падение — после N неудач подряд. Возвращает событие, если статус сменился. */
export async function record(r: CheckResult, threshold: number): Promise<'down' | 'up' | null> {
  const [prev] = await sql()`select * from monitor_state where target = ${r.target}`;
  let status: 'up' | 'down' | 'unknown' = prev?.status ?? 'unknown';
  let fails = r.ok ? 0 : (prev?.fails ?? 0) + 1;
  let since = prev?.since ?? new Date();
  let event: 'down' | 'up' | null = null;
  if (r.ok) {
    if (status === 'down') event = 'up';
    if (status !== 'up') since = new Date();
    status = 'up';
  } else if (fails >= threshold && status !== 'down') {
    status = 'down';
    since = new Date();
    event = 'down';
  }
  await sql()`
    insert into monitor_state (target, label, status, fails, since, checked_at, detail)
    values (${r.target}, ${r.label}, ${status}, ${fails}, ${since}, now(), ${r.detail ?? null})
    on conflict (target) do update set label = excluded.label, status = excluded.status, fails = excluded.fails, since = excluded.since, checked_at = now(), detail = excluded.detail`;
  if (event) await sql()`insert into monitor_events (target, label, status, detail) values (${r.target}, ${r.label}, ${event}, ${r.detail ?? null})`;
  return event;
}

/** Одна итерация мониторинга: проверки, оповещения, авто-техработы */
export async function monitorTick(opts: { scheduled?: boolean } = {}): Promise<{ checked: number; changes: number }> {
  const cfg = await getSettings('monitoring');
  if (!cfg.enabled) return { checked: 0, changes: 0 };
  if (opts.scheduled) {
    const claimed = await sql()`insert into monitor_state (target, label, status, checked_at) values ('_schedule', 'Расписание', 'unknown', now())
      on conflict (target) do update set checked_at = now()
      where monitor_state.checked_at < now() - make_interval(secs => ${cfg.interval_seconds}) returning 1`;
    if (!claimed.length) return { checked: 0, changes: 0 };
  }
  const results = await runChecks();
  let changes = 0;
  for (const r of results) {
    const ev = await record(r, cfg.fail_threshold);
    if (!ev) continue;
    changes++;
    const alternatives = r.target.startsWith('node:') && ev === 'down' ? results.filter(n => n.target.startsWith('node:') && n.ok).slice(0, 3).map(n => escapeHtml(n.label)) : [];
    const advice = alternatives.length ? `\nРезервные ноды со связью с панелью: ${alternatives.join(', ')}. Доступность у пользователя не измерялась.` : '';
    await alert(ev === 'down' ? `🔴 <b>${escapeHtml(r.label)}</b>: проблема\n${escapeHtml(r.detail ?? '')}${advice}` : `🟢 <b>${escapeHtml(r.label)}</b>: восстановилось`);
    if (r.target === 'remnawave' && cfg.auto_maintenance) await autoMaintenance(ev === 'down');
  }
  // убрать из состояния ноды, которых больше нет
  const live = results.map((r) => r.target);
  if (results.some(r => r.target === 'remnawave' && r.ok)) await sql()`delete from monitor_state where target like 'node:%' and not (target = any(${live}))`;
  await sql()`delete from monitor_events where created_at < now() - interval '30 days'`;
  return { checked: results.length, changes };
}

async function autoMaintenance(down: boolean): Promise<void> {
  const g = await getSettings('general');
  const [flag] = await sql()`select status from monitor_state where target = '_auto_maint'`;
  if (down && !g.maintenance) {
    await setSettings('general', { maintenance: true });
    await sql()`insert into monitor_state (target, label, status) values ('_auto_maint', 'Авто-техработы', 'down') on conflict (target) do update set status = 'down'`;
    await alert('🛠 Включены автоматические техработы: панель Remnawave недоступна.');
  } else if (!down && flag?.status === 'down') {
    await setSettings('general', { maintenance: false });
    await sql()`update monitor_state set status = 'up' where target = '_auto_maint'`;
    await alert('✅ Техработы сняты автоматически: панель снова доступна.');
  }
}

export async function monitorSnapshot() {
  const state = await sql()`select target, label, status, fails, since, checked_at, detail from monitor_state where left(target, 1) <> '_' order by (status = 'down') desc, label`;
  const events = await sql()`select id, target, label, status, detail, created_at from monitor_events order by created_at desc limit 50`;
  return { state, events };
}
