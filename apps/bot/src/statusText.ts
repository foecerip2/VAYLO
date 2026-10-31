import { pluralDays, type ServerStatusDTO } from '@vpn/shared';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const DOT = { up: '🟢', down: '🔴', unknown: '⚪️' } as const;
const OVERALL = { ok: '🟢', partial: '🟡', down: '🔴', unknown: '⚪️' } as const;

const plural = (n: number, a: string, b: string, c: string) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'данные обновляются';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} ${plural(h, 'час', 'часа', 'часов')} назад` : 'давно';
}

/** Текст экрана «Статус серверов» */
export function statusScreen(d: ServerStatusDTO, brand = 'VAYLO', now = Date.now()): string {
  const lines: string[] = ['🌐 <b>Статус серверов</b>', '', `${OVERALL[d.overall]} ${esc(d.summary)}`];
  for (const g of d.groups) {
    lines.push('', `<b>${esc(g.title)}</b>`);
    for (const i of g.items) lines.push(`${DOT[i.status]} ${esc(i.title)}`);
  }
  if (!d.groups.length) lines.push('', 'Список серверов пока не настроен.');
  if (d.compensate.enabled) {
    lines.push('', '🛡 <b>Компенсируем простои</b>', `Если сервер недоступен дольше ${d.compensate.hours} ${plural(d.compensate.hours, 'часа', 'часов', 'часов')}, мы сами продлеваем`, `ваш ${esc(brand)} VPN на ${d.compensate.days} ${pluralDays(d.compensate.days)} — без заявок в поддержку.`);
  }
  lines.push('', `🕒 Статус серверов обновлён ${ago(d.updatedAt, now)}.`);
  return lines.join('\n');
}
