import { describe, expect, it } from 'vitest';
import type { ServerStatusDTO } from '@vpn/shared';
import { ago, statusScreen } from '../src/statusText.js';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const base: ServerStatusDTO = {
  overall: 'ok', summary: 'Все локации работают · мосты работают',
  groups: [
    { key: 'location', title: '🌍 Локации', items: [{ id: '1', title: '🇸🇪 Швеция', status: 'up' }, { id: '2', title: '🇱🇹 Литва', status: 'down' }] },
    { key: 'bridge', title: '🔀 Мосты (вход из РФ)', items: [{ id: '3', title: '🇷🇺 ➜ 🇩🇪 Германия', status: 'up' }] },
    { key: 'lte', title: '🗽 LTE для белых списков (только в тарифе 🟣PURPLE)', items: [{ id: '4', title: '🇸🇪 LTE‑2', status: 'unknown' }] },
  ],
  compensate: { enabled: true, hours: 5, days: 1 },
  updatedAt: new Date(NOW - 3 * 60_000).toISOString(),
};

describe('экран «Статус серверов»', () => {
  it('повторяет согласованный формат: заголовок, сводка, группы, компенсация, время обновления', () => {
    const t = statusScreen(base, 'VAYLO', NOW);
    expect(t.split('\n')).toEqual([
      '🌐 <b>Статус серверов</b>', '', '🟢 Все локации работают · мосты работают',
      '', '<b>🌍 Локации</b>', '🟢 🇸🇪 Швеция', '🔴 🇱🇹 Литва',
      '', '<b>🔀 Мосты (вход из РФ)</b>', '🟢 🇷🇺 ➜ 🇩🇪 Германия',
      '', '<b>🗽 LTE для белых списков (только в тарифе 🟣PURPLE)</b>', '⚪️ 🇸🇪 LTE‑2',
      '', '🛡 <b>Компенсируем простои</b>', 'Если сервер недоступен дольше 5 часов, мы сами продлеваем', 'ваш VAYLO VPN на 1 день — без заявок в поддержку.',
      '', '🕒 Статус серверов обновлён 3 минуты назад.',
    ]);
  });
  it('склонения и экранирование; без компенсации блока нет', () => {
    const d = { ...base, compensate: { enabled: false, hours: 1, days: 2 }, groups: [{ key: 'location' as const, title: '🌍 Локации', items: [{ id: '1', title: 'A<b>&', status: 'up' as const }] }] };
    const t = statusScreen(d, 'VAYLO', NOW);
    expect(t).toContain('A&lt;b&gt;&amp;');
    expect(t).not.toContain('Компенсируем');
    expect(statusScreen({ ...base, compensate: { enabled: true, hours: 21, days: 2 } }, 'VAYLO', NOW)).toMatch(/дольше 21 часа.*на 2 дня/s);
    expect(statusScreen({ ...base, compensate: { enabled: true, hours: 24, days: 5 } }, 'VAYLO', NOW)).toMatch(/дольше 24 часов.*на 5 дней/s);
  });
  it('время: только что, минуты, часы, нет данных', () => {
    expect(ago(new Date(NOW - 10_000).toISOString(), NOW)).toBe('только что');
    expect(ago(new Date(NOW - 1 * 60_000).toISOString(), NOW)).toBe('1 минуту назад');
    expect(ago(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe('12 минут назад');
    expect(ago(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toBe('3 часа назад');
    expect(ago(null, NOW)).toBe('данные обновляются');
  });
  it('пустой список серверов', () => {
    expect(statusScreen({ ...base, groups: [], overall: 'unknown', summary: 'Данные обновляются' }, 'VAYLO', NOW)).toContain('Список серверов пока не настроен');
  });
});
