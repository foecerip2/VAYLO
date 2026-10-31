import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashPassword, verifyPassword } from '../src/lib/crypto.js';
import { validateInitData } from '../src/lib/telegram.js';
import { base32Encode, totpAt, verifyTotp } from '../src/lib/totp.js';
import { makeInitData } from './helpers/initdata.js';

describe('Telegram initData', () => {
  const token = process.env.BOT_TOKEN!;
  it('принимает корректную подпись', () => {
    const r = validateInitData(makeInitData({ id: 42, first_name: 'Сергей', username: 'sergey' }), token);
    expect(r?.user.id).toBe(42);
    expect(r?.user.first_name).toBe('Сергей');
  });
  it('возвращает start_param', () => {
    expect(validateInitData(makeInitData({ id: 1 }, { startParam: 'ref_abc' }), token)?.startParam).toBe('ref_abc');
  });
  it('отклоняет подделку и чужой токен', () => {
    const good = makeInitData({ id: 42 });
    expect(validateInitData(good.replace('%22id%22%3A42', '%22id%22%3A43'), token)).toBeNull();
    expect(validateInitData(makeInitData({ id: 42 }, { token: '999:OTHER' }), token)).toBeNull();
    expect(validateInitData('hash=abc', token)).toBeNull();
    expect(validateInitData('', token)).toBeNull();
  });
  it('отклоняет просроченные данные', () => {
    const old = makeInitData({ id: 1 }, { authDate: Math.floor(Date.now() / 1000) - 3 * 86400 });
    expect(validateInitData(old, token)).toBeNull();
  });
});

describe('TOTP (RFC 6238)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('совпадает с тестовым вектором RFC', () => {
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(totpAt(secret, 1111111109_000)).toBe('081804');
    expect(totpAt(secret, 1234567890_000)).toBe('005924');
  });
  it('проверяет код с допуском ±1 окно', () => {
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '287082', 59_000 + 30_000)).toBe(true);
    expect(verifyTotp(secret, '287082', 59_000 + 120_000)).toBe(false);
    expect(verifyTotp(secret, 'abc123', 59_000)).toBe(false);
  });
});

describe('crypto', () => {
  it('шифрует и расшифровывает секреты', () => {
    const c = encrypt('shop-secret');
    expect(c).not.toContain('shop-secret');
    expect(decrypt(c)).toBe('shop-secret');
    expect(encrypt('a')).not.toBe(encrypt('a'));
  });
  it('хеширует пароли scrypt', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});
