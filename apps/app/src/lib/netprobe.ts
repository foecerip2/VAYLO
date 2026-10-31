import { get, post } from './api';
import { isTelegram } from './tg';

interface Target { id: string; kind: 'sub' | 'api' | 'host'; url: string }
interface Result { target: string; kind: Target['kind']; ok: boolean; ms: number }

const KEY = 'netprobe-at';
const EVERY_MS = 6 * 3600_000;
const TIMEOUT_MS = 6000;

/**
 * Замер доступности с устройства пользователя. Браузер не умеет делать «сырое» TCP-подключение, поэтому:
 * — sub и api: считаем успехом, если сервер ответил (запрос no-cors);
 * — host (узел VPN на 443): сертификат не совпадёт с IP, ответ придёт ошибкой; быстрая ошибка = порт достижим, таймаут = не достижим.
 *   Это грубая оценка (сброс соединения тоже приходит быстро), точный тест узлов делает проба по ключу VLESS.
 */
async function measure(t: Target): Promise<Result> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  let ok = false;
  try {
    await fetch(t.url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    ok = true;
  } catch {
    ok = t.kind === 'host' && !ctl.signal.aborted && performance.now() - t0 < TIMEOUT_MS - 500;
  } finally {
    clearTimeout(timer);
  }
  return { target: t.id, kind: t.kind, ok, ms: Math.round(performance.now() - t0) };
}

/** Раз в 6 часов на устройство, только внутри Telegram, не мешает работе приложения */
export async function runNetProbe(): Promise<void> {
  try {
    if (!isTelegram()) return;
    const last = Number(localStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < EVERY_MS) return;
    localStorage.setItem(KEY, String(Date.now())); // ставим сразу: при сбое не повторяем в цикле
    const r = await get<{ enabled: boolean; targets: Target[] }>('/net/targets');
    if (!r.enabled || !r.targets.length) return;
    const results = await Promise.all(r.targets.slice(0, 12).map(measure));
    await post('/net/report', { results });
  } catch {
    /* замеры — фоновая вещь, пользователю ошибки не показываем */
  }
}
