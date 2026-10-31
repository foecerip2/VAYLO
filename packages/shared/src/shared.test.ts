import { describe, expect, it } from 'vitest';
import { bytesToHuman, durationLabel, formatRub, pluralDays, subscriptionState } from './index';

describe('shared utils', () => {
  it('formats rubles', () => {
    expect(formatRub(29900).replace(/\s/g, ' ')).toBe('299 ₽');
    expect(formatRub(29950).replace(/\s/g, ' ')).toBe('299,50 ₽');
  });
  it('formats bytes', () => {
    expect(bytesToHuman(0)).toBe('0 Б');
    expect(bytesToHuman(1024 * 1024 * 1.5)).toBe('1.5 МБ');
    expect(bytesToHuman(5 * 1024 ** 3)).toBe('5 ГБ');
  });
  it('pluralizes days', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(pluralDays)).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня', 'дней']);
  });
  it('labels durations', () => {
    expect(durationLabel(30)).toBe('1 месяц');
    expect(durationLabel(90)).toBe('3 месяца');
    expect(durationLabel(360)).toBe('12 месяцев');
    expect(durationLabel(7)).toBe('7 дней');
  });
  it('computes subscription state', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(subscriptionState(null, false, now)).toBe('none');
    expect(subscriptionState(new Date('2025-12-31T00:00:00Z'), false, now)).toBe('expired');
    expect(subscriptionState(new Date('2026-01-02T00:00:00Z'), false, now)).toBe('expiring');
    expect(subscriptionState(new Date('2026-02-01T00:00:00Z'), false, now)).toBe('active');
    expect(subscriptionState(new Date('2026-02-01T00:00:00Z'), true, now)).toBe('trial');
  });
});

import { friendlyErrorMessage, isTechnicalMessage, isUuid, normalizeChannelUrl, isValidChannelUrl, paymentStatusLabel, paymentPurposeLabel, deviceLimitLabel, FRIENDLY_ERROR } from './index';

describe('friendly helpers', () => {
  it('detects technical error messages', () => {
    expect(isTechnicalMessage('Remnawave недоступен')).toBe(true);
    expect(isTechnicalMessage('POST /api/users → 500')).toBe(true);
    expect(isTechnicalMessage('fetch failed')).toBe(true);
    expect(isTechnicalMessage('Internal Server Error')).toBe(true);
    expect(isTechnicalMessage('Ошибка 500')).toBe(true);
    expect(isTechnicalMessage('Нет соединения с сервером. Проверьте интернет.')).toBe(false);
    expect(isTechnicalMessage('Промокод не найден')).toBe(false);
    expect(friendlyErrorMessage('Bad Request: x')).toBe(FRIENDLY_ERROR);
    expect(friendlyErrorMessage('Недостаточно средств')).toBe('Недостаточно средств');
    expect(friendlyErrorMessage('')).toBe(FRIENDLY_ERROR);
  });
  it('validates uuid and channel urls', () => {
    expect(isUuid('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe(true);
    expect(isUuid('squad-1')).toBe(false);
    expect(normalizeChannelUrl('@mychannel')).toBe('https://t.me/mychannel');
    expect(normalizeChannelUrl('t.me/x_chan')).toBe('https://t.me/x_chan');
    expect(isValidChannelUrl('https://t.me/mychannel')).toBe(true);
    expect(isValidChannelUrl('tg://resolve?domain=x')).toBe(true);
    expect(isValidChannelUrl('mychannel')).toBe(false);
  });
  it('labels', () => {
    expect(paymentStatusLabel('pending')).toBe('Ожидает');
    expect(paymentStatusLabel('refunded')).toBe('Возврат');
    expect(paymentPurposeLabel('addon')).toBe('Докупка');
    expect(deviceLimitLabel(0)).toBe('без ограничений');
    expect(deviceLimitLabel(3)).toBe('до 3');
  });
});
