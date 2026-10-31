import { sql } from '../db/index.js';
import { escapeHtml } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { getSettings } from './settings.js';

/** Оповещение администраторов в Telegram (те же получатели, что у мониторинга). text — HTML. */
export async function alertAdmins(text: string): Promise<void> {
  // вызывается как «выстрелил и забыл» (void alertAdmins(...)): ошибка здесь не должна ронять процесс
  try {
    const cfg = await getSettings('monitoring');
    if (!cfg.alerts) return;
    const ids = new Set<number>();
    const admins = await sql()<{ tg_id: number }[]>`select tg_id from admins where tg_id is not null`;
    for (const a of admins) ids.add(a.tg_id);
    if (/^-?\d+$/.test(cfg.extra_chat_id)) ids.add(Number(cfg.extra_chat_id));
    for (const id of ids) await sendTelegramMessage(id, text.slice(0, 4000)).catch(() => {});
  } catch (e) {
    log.error('admin alert failed', { err: (e as Error).message });
  }
}

/**
 * Оповещение с защитой от спама: не чаще одного раза за intervalSec для одного key.
 * Метка хранится в БД (monitor_state, служебная запись «_alert:…»), поэтому троттлинг общий для API и воркера.
 * Никогда не бросает исключений.
 */
export async function alertAdminsThrottled(key: string, text: string, intervalSec = 600): Promise<boolean> {
  try {
    const target = `_alert:${key}`.slice(0, 200);
    const r = await sql()`
      insert into monitor_state (target, label, status, checked_at) values (${target}, 'throttle', 'unknown', now())
      on conflict (target) do update set checked_at = now()
      where monitor_state.checked_at is null or monitor_state.checked_at < now() - make_interval(secs => ${intervalSec})
      returning 1`;
    if (!r.length) return false;
    await alertAdmins(text);
    return true;
  } catch (e) {
    log.error('admin alert failed', { key, err: (e as Error).message });
    return false;
  }
}

export { escapeHtml };
