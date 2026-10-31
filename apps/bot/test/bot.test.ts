import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBot } from '../src/bot.js';

interface Rec { method: string; url: string; headers: Record<string, any>; body: any }

function startServer(handler: (r: Rec) => { status?: number; json: unknown }): Promise<{ server: Server; url: string; calls: Rec[] }> {
  const calls: Rec[] = [];
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString();
      const rec: Rec = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      calls.push(rec);
      const r = handler(rec);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(r.json));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as any).port}`, calls }));
  });
}

const me = (over: any = {}) => ({
  id: 'u1', tgId: 1, balance: 0, referralCode: 'abc', trialAvailable: true,
  subscription: { state: 'none', planName: null, expiresAt: null, daysLeft: 0, totalDays: 0, trafficUsedBytes: 0, trafficLimitBytes: 0, deviceLimit: 0, subUrl: null, isTrial: false },
  ...over,
});
const activeSub = { state: 'active', planName: '1 месяц', expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(), daysLeft: 10, totalDays: 30, trafficUsedBytes: 1024 ** 3, trafficLimitBytes: 0, deviceLimit: 3, subUrl: 'https://sub.example.test/api/sub/abc', isTrial: false };

let tg: Awaited<ReturnType<typeof startServer>>;
let core: Awaited<ReturnType<typeof startServer>>;
let state: { me: any; promoError: boolean; gate: any; quests: any; plans?: any; techError?: boolean; welcome?: any };
/** подмена ответа Telegram (для имитации ошибок Bot API) */
let tgReply: ((r: Rec) => { status?: number; json: unknown } | null) | null = null;
let bot: ReturnType<typeof createBot>;
let updateId = 1;

const sent = () => tg.calls.filter((c) => c.url.endsWith('/sendMessage') || c.url.endsWith('/editMessageText') || c.url.endsWith('/sendPhoto')).map((c) => ({...c.body, text:c.body.text ?? c.body.caption}));
const lastText = () => sent().at(-1)?.text as string;
const buttons = () => (sent().at(-1)?.reply_markup?.inline_keyboard ?? []).flat() as any[];

const from = { id: 1, is_bot: false, first_name: 'Сергей', username: 'sergey' };
const message = (text: string) => ({ update_id: updateId++, message: { message_id: updateId, date: 1, chat: { id: 1, type: 'private', first_name: 'S' }, from, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } : {}) } });
const callback = (data: string) => ({ update_id: updateId++, callback_query: { id: 'cq' + updateId, from, chat_instance: 'x', data, message: { message_id: 5, date: 1, chat: { id: 1, type: 'private' } } } });

beforeAll(async () => {
  tg = await startServer((r) => tgReply?.(r) ?? { json: { ok: true, result: { message_id: 1 } } });
  core = await startServer((r) => {
    const u = r.url.replace('/api/v1', '');
    if (u === '/config') return { json: { ...state.welcome, brandName: 'TestVPN', supportUrl: 'https://t.me/support', channelUrl: '', trial: { enabled: true, days: 3, trafficGb: 5, devices: 1 }, referral: { days: 7, percent: 0 }, topup: { min: 10000, max: 10000000, presets: [10000, 30000], bonuses: [{ from: 50000, percent: 10 }] }, addonsEnabled: true, questsEnabled: true, autoRenewEnabled: true, maintenance: false } };
    if (u === '/gate') return { json: state.gate };
    if (u === '/gate/check') { state.gate = { ...state.gate, ok: true }; return { json: state.gate }; }
    if (u === '/me' && (state as any).regClosed) return { status: 403, json: { error: { message: 'Проект закрывается, регистрация закрыта.', code: 'registration_closed' } } };
    if (u === '/me') return { json: state.me };
    if (u === '/quote') { const t = r.body?.addonId ? 5000 : 19900; return { json: { gross: t, discount: 0, total: t, bonus: 0, balance: state.me.balance } }; }
    if (u === '/addons') return { json: { enabled: true, active: true, products: [{ id: 'a1', kind: 'devices', name: '+2 устройства', description: '', price: 5000, finalPrice: 5000, qty: 2, durationDays: null, locationId: null, locationName: null, countryCode: null, owned: false }], mine: [] } };
    if (u === '/quests') return { json: state.quests };
    if (u === '/quests/q1/claim') return { json: { rewardType: 'balance', rewardValue: 500 } };
    if (u === '/subscription/auto-renew') return { json: { autoRenew: true } };
    if (u === '/admin/stats/overview') return { json: { users: { total: 10, new_1d: 1, new_7d: 3 }, subscriptions: { active: 4, trial: 2, expiring: 1 }, revenue: { today: 19900, d7: 50000, d30: 99000, count30: 5 }, trialConversion: 12.5, unfulfilledPayments: 0 } };
    if (u.startsWith('/admin/users?')) return { json: { items: [{ id: 'u9', first_name: 'Вася', username: 'vasya', tg_id: 9 }] } };
    if (u === '/admin/users/u9') return { json: { user: { first_name: 'Вася', username: 'vasya', tg_id: 9, status: 'active', balance: 100, discount_pct: 0 }, subscription: { state: 'active', planName: 'M', expiresAt: new Date(Date.now() + 86400000).toISOString(), trafficUsedBytes: 0, trafficLimitBytes: 0, deviceLimit: 3 }, invited: 0 } };
    if (u === '/admin/users/u9/extend') return { json: { ok: true } };
    if (u === '/admin/maintenance') return { json: { maintenance: true } };
    if (u === '/plans' && state.plans) return { json: state.plans };
    if (u === '/plans') return { json: [{ id: 'p1', name: '1 месяц', description: '', durationDays: 30, trafficLimitGb: 0, deviceLimit: 3, price: 19900, oldPrice: null, badge: null, sort: 1, isActive: true }] };
    if (u === '/payment-methods') return { json: [{ id: 'yookassa', provider: 'yookassa', title: 'Карта · СБП' }, { id: 'platega:sbp', provider: 'platega', title: 'СБП (QR)' }] };
    if (u === '/payments') return { json: { id: 'pay1', status: r.body.method === 'balance' ? 'succeeded' : 'pending', payUrl: r.body.method === 'balance' ? null : 'https://yoomoney.test/pay/1' } };
    if (u === '/subscription/trial') { state.me = me({ trialAvailable: false, subscription: { ...activeSub, state: 'trial', isTrial: true } }); return { json: state.me }; }
    if (u === '/referrals') return { json: { code: 'abc', link: 'https://t.me/bot?start=ref_abc', webLink: 'x', invited: 2, invitedLevel2: 0, paid: 1, earnedDays: 7, earnedBalance: 0, rewardDays: 7, rewardPercent: 0, level2Percent: 0, recurring: false, signupBonus: 0, rank: { name: 'Новичок', percent: 0, extraDays: 0 }, nextRank: { name: 'Друг', minPaid: 3, left: 2 }, ranks: [], partnerLinks: [] } };
    if (u === '/promo/redeem' && state.techError) return { status: 502, json: { error: { message: 'Remnawave POST /api/users → 500: fetch failed' } } };
    if (u === '/promo/redeem') return state.promoError ? { status: 400, json: { error: { message: 'Промокод не найден' } } } : { json: { type: 'days', value: 7 } };
    if (u === '/contests/join') return { json: (state as any).join ?? { ok: true, contest: { title: 'Розыгрыш', prize: '7 дн. подписки', endsAt: new Date(Date.now() + 86400000).toISOString() } } };
    if (u === '/contests') return { json: [{ code: 'abc123', title: 'Розыгрыш', prize: '7 дн. подписки', endsAt: new Date(Date.now() + 86400000).toISOString(), entries: 5 }] };
    if (u === '/internal/tglink/confirm') return { json: { ok: true } };
    return { status: 404, json: { error: { message: 'nf' } } };
  });
  bot = createBot({ token: '1:T', apiUrl: core.url, internalKey: 'k', appUrl: 'https://app.example.test', apiRoot: tg.url, gateCacheMs: 0, botInfo: { id: 1, is_bot: true, first_name: 'B', username: 'test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any });
  await bot.init();
});
afterAll(() => { tg.server.close(); core.server.close(); });
beforeEach(() => { tgReply = null; tg.calls.length = 0; core.calls.length = 0; state = { me: me(), promoError: false, gate: { required: false, ok: true, text: '', chats: [] }, quests: { enabled: true, streak: 2, quests: [] } }; });

describe('бот', () => {
  it('закрытие проекта: в меню таймер и «О закрытии», покупки скрыты', async () => {
    const now = new Date(); state.welcome = { closure: { active: true, endsAt: new Date(now.getTime() + 3 * 86_400_000 + 5 * 3_600_000).toISOString(), serverNow: now.toISOString(), reason: 'Проект не приносит пользы.', altText: '', altUrl: '' } };
    await bot.handleUpdate(message('/menu') as any);
    expect(lastText()).toContain('Проект закрывается'); expect(lastText()).toContain('3 дн.');
    const b = buttons();
    expect(b.some((x) => x.callback_data === 'closure')).toBe(true);
    expect(b.some((x) => x.callback_data === 'plans' || x.callback_data === 'trial' || x.callback_data === 'addons')).toBe(false);
    await bot.handleUpdate(callback('closure') as any);
    expect(lastText()).toContain('Проект не приносит пользы'); expect(lastText()).toContain('не слетят');
  });

  it('новый пользователь при закрытой регистрации получает понятное сообщение', async () => {
    (state as any).regClosed = true;
    const now = new Date(); state.welcome = { closure: { active: true, endsAt: new Date(now.getTime() + 86_400_000).toISOString(), serverNow: now.toISOString(), reason: 'Проект закрывается.', altText: '', altUrl: '' } };
    await bot.handleUpdate(message('/start') as any);
    expect(lastText()).toContain('Регистрация закрыта'); expect(lastText()).toContain('До закрытия');
  });

  it('конкурс: ссылка /start c_<код> записывает участие, без подписки просит подписаться', async () => {
    await bot.handleUpdate(message('/start c_abc123') as any);
    expect(core.calls.find((c) => c.url.endsWith('/contests/join'))!.body).toEqual({ code: 'abc123' });
    expect(lastText()).toContain('Вы участвуете');
    (state as any).join = { ok: false, reason: 'need_channel', channelUrl: 'https://t.me/ch', contest: { title: 'Розыгрыш', prize: 'x', endsAt: new Date().toISOString() } };
    await bot.handleUpdate(message('/start c_abc123') as any);
    expect(lastText()).toContain('подпишитесь');
    expect(buttons().some((b) => b.callback_data === 'cj:abc123')).toBe(true);
    expect(buttons().some((b) => b.url === 'https://t.me/ch')).toBe(true);
  });

  it('конкурсы: список с кнопкой «Участвовать»', async () => {
    await bot.handleUpdate(message('/contests') as any);
    expect(lastText()).toContain('Розыгрыш');
    expect(buttons().find((b) => b.text.includes('Участвовать'))?.callback_data).toBe('cj:abc123');
  });

  it('/start регистрирует пользователя с реф-кодом и показывает меню с кнопкой Mini App и триалом', async () => {
    await bot.handleUpdate(message('/start ref_xyz') as any);
    const meCall = core.calls.find((c) => c.url.endsWith('/me'))!;
    expect(meCall.headers['x-ref-code']).toBe('xyz');
    expect(meCall.headers['x-internal-key']).toBe('k');
    expect(JSON.parse(Buffer.from(meCall.headers['x-tg-user'], 'base64').toString()).id).toBe(1);
    expect(lastText()).toContain('TestVPN');
    const b = buttons();
    expect(b.find((x) => x.web_app)?.web_app.url).toBe('https://app.example.test');
    expect(b.some((x) => x.callback_data === 'trial' && x.text.includes('3 дня'))).toBe(true);
    expect(b.find((x) => x.text.includes('Поддержка'))?.url).toBe('https://t.me/support');
  });

  it('/start auth_<token> не подтверждает вход молча — сначала спрашивает', async () => {
    await bot.handleUpdate(message('/start auth_abcdefghijklmnop') as any);
    expect(core.calls.some((x) => x.url.endsWith('/internal/tglink/confirm'))).toBe(false);
    expect(lastText()).toContain('Вход на сайт app.example.test');
    expect(lastText()).toContain('проигнорируйте');
    const b = buttons();
    expect(b.find((x) => x.text.includes('Подтвердить'))?.callback_data).toBe('al:abcdefghijklmnop');
    expect(b.some((x) => x.callback_data === 'al_no')).toBe(true);
    await bot.handleUpdate(callback('al:abcdefghijklmnop') as any);
    const c = core.calls.find((x) => x.url.endsWith('/internal/tglink/confirm'))!;
    expect(c.body).toEqual({ token: 'abcdefghijklmnop' });
    expect(lastText()).toContain('Вход выполнен');
  });

  it('вход на сайт: «Отмена» ничего не подтверждает', async () => {
    await bot.handleUpdate(message('/start auth_abcdefghijklmnop') as any);
    await bot.handleUpdate(callback('al_no') as any);
    expect(core.calls.some((x) => x.url.endsWith('/internal/tglink/confirm'))).toBe(false);
    expect(lastText()).toContain('Вход отменён');
  });

  it('вход на сайт: длинный токен хранится на сервере, callback_data ≤ 64 байт', async () => {
    const token = 'x'.repeat(64);
    await bot.handleUpdate(message('/start auth_' + token) as any);
    const data = buttons().find((x) => x.text.includes('Подтвердить'))!.callback_data as string;
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(data.startsWith('alk:')).toBe(true);
    await bot.handleUpdate(callback(data) as any);
    expect(core.calls.find((x) => x.url.endsWith('/internal/tglink/confirm'))!.body).toEqual({ token });
    // повторно тот же id не срабатывает
    core.calls.length = 0;
    await bot.handleUpdate(callback(data) as any);
    expect(core.calls.some((x) => x.url.endsWith('/internal/tglink/confirm'))).toBe(false);
    expect(lastText()).toContain('устарела');
  });

  it('триал → показывает ссылку подписки и кнопки импорта через страницу приложения', async () => {
    await bot.handleUpdate(callback('trial') as any);
    expect(core.calls.some((c) => c.url.endsWith('/subscription/trial') && c.method === 'POST')).toBe(true);
    expect(lastText()).toContain('https://sub.example.test/api/sub/abc');
    const b = buttons();
    const happ = b.find((x) => x.text.includes('Happ'));
    expect(happ.url).toBe('https://app.example.test/import?client=happ&url=' + encodeURIComponent('https://sub.example.test/api/sub/abc'));
    // у кнопок только http(s) — Telegram не принимает кастомные схемы
    expect(b.filter((x) => x.url).every((x) => /^https:\/\//.test(x.url))).toBe(true);
  });

  it('подключение без подписки предлагает тарифы', async () => {
    await bot.handleUpdate(callback('connect') as any);
    expect(lastText()).toContain('Сначала оформите подписку');
  });

  it('покупка: тариф → способ оплаты → ссылка на оплату', async () => {
    await bot.handleUpdate(callback('plans') as any);
    expect(lastText()).toContain('199 ₽');
    expect(buttons().find((x) => x.callback_data === 'plan:p1')).toBeTruthy();
    await bot.handleUpdate(callback('plan:p1') as any);
    expect(buttons().map((x) => x.callback_data)).toEqual(expect.arrayContaining(['pay:p1:yookassa', 'pay:p1:platega:sbp']));
    expect(buttons().some((x) => x.callback_data?.includes('balance'))).toBe(false);
    await bot.handleUpdate(callback('pay:p1:platega:sbp') as any);
    const payCall = core.calls.find((c) => c.url.endsWith('/payments') && c.method === 'POST')!;
    expect(payCall.body).toEqual({ planId: 'p1', method: 'platega:sbp' });
    expect(buttons().find((x) => x.url)?.url).toBe('https://yoomoney.test/pay/1');
  });

  it('оплата с баланса предлагается только при достаточных средствах', async () => {
    state.me = me({ balance: 25000 });
    await bot.handleUpdate(callback('plan:p1') as any);
    expect(buttons().some((x) => x.callback_data === 'pay:p1:balance')).toBe(true);
    await bot.handleUpdate(callback('pay:p1:balance') as any);
    expect(lastText()).toContain('Подписка оформлена');
  });

  it('промокод: ввод текста после кнопки', async () => {
    await bot.handleUpdate(callback('promo') as any);
    expect(lastText()).toContain('промокод');
    await bot.handleUpdate(message('GIFT7') as any);
    expect(core.calls.find((c) => c.url.endsWith('/promo/redeem'))!.body).toEqual({ code: 'GIFT7' });
    expect(lastText()).toContain('+7 дней');
    // дальше обычный текст — просто меню
    await bot.handleUpdate(message('привет') as any);
    expect(lastText()).toContain('TestVPN');
  });

  it('ошибки API показываются пользователю понятным текстом', async () => {
    state.promoError = true;
    await bot.handleUpdate(callback('promo') as any);
    await bot.handleUpdate(message('BAD') as any);
    expect(lastText()).toContain('Промокод не найден');
  });

  it('технические ошибки API не показываются пользователю', async () => {
    state.techError = true;
    await bot.handleUpdate(callback('promo') as any);
    await bot.handleUpdate(message('GIFT') as any);
    expect(lastText()).toContain('Что-то пошло не так. Попробуйте ещё раз или напишите в поддержку.');
    expect(lastText()).not.toContain('Remnawave');
  });

  it('промокод длиннее 40 символов отклоняется, ожидание ввода сохраняется', async () => {
    await bot.handleUpdate(callback('promo') as any);
    await bot.handleUpdate(message('A'.repeat(41)) as any);
    expect(lastText()).toContain('не больше 40 символов');
    expect(core.calls.some((c) => c.url.endsWith('/promo/redeem'))).toBe(false);
    await bot.handleUpdate(message('GIFT7') as any);
    expect(core.calls.find((c) => c.url.endsWith('/promo/redeem'))!.body).toEqual({ code: 'GIFT7' });
  });

  it('«Отмена»/меню сбрасывает ожидание ввода', async () => {
    await bot.handleUpdate(callback('promo') as any);
    await bot.handleUpdate(callback('menu') as any);
    await bot.handleUpdate(message('GIFT7') as any);
    expect(core.calls.some((c) => c.url.endsWith('/promo/redeem'))).toBe(false);
    expect(lastText()).toContain('TestVPN');
    await bot.handleUpdate(callback('tpc') as any);
    await bot.handleUpdate(callback('wallet') as any);
    await bot.handleUpdate(message('500') as any);
    expect(buttons().some((x) => x.callback_data?.startsWith('tpm:'))).toBe(false);
  });

  it('пополнение: абсурдные суммы отклоняются', async () => {
    for (const bad of ['1e22', '99999999999999999999999', '5000000', 'Infinity']) {
      tg.calls.length = 0;
      await bot.handleUpdate(callback('tpc') as any);
      await bot.handleUpdate(message(bad) as any);
      expect(buttons().some((x) => x.callback_data?.startsWith('tpm:'))).toBe(false);
      expect(sent().every((m) => !JSON.stringify(m.reply_markup ?? {}).includes('e+'))).toBe(true);
    }
    expect(lastText()).toMatch(/Введите сумму|Сумма должна быть/);
  });

  it('лимит устройств 0 показывается как безлимит', async () => {
    state.plans = [{ id: 'p0', name: 'Семья', description: '', durationDays: 30, trafficLimitGb: 0, deviceLimit: 0, price: 29900, oldPrice: null, badge: null, sort: 1, isActive: true }];
    await bot.handleUpdate(callback('plans') as any);
    expect(lastText()).toContain('безлимит устройств');
    expect(lastText()).not.toContain('до 0');
    state.me = me({ trialAvailable: false, subscription: { ...activeSub, deviceLimit: 0 } });
    await bot.handleUpdate(message('/menu') as any);
    expect(lastText()).toContain('Устройств: без ограничений');
  });

  it('ошибка answerCallbackQuery не ломает обработчик, результат сообщается сообщением', async () => {
    tgReply = (r) => (r.url.endsWith('/answerCallbackQuery') ? { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' } } : null);
    state.me = me({ subscription: activeSub, trialAvailable: false });
    await bot.handleUpdate(callback('ar:1') as any);
    expect(core.calls.find((c) => c.url.endsWith('/subscription/auto-renew'))!.body).toEqual({ enabled: true });
    expect(lastText()).toContain('Автопродление включено');
    await bot.handleUpdate(callback('menu') as any);
    expect(lastText()).toContain('TestVPN');
  });

  it('админ: ack сразу, без преждевременного «успеха» во всплывашке', async () => {
    state.me = me({ adminRole: 'owner' });
    await bot.handleUpdate(callback('ax:u9:30') as any);
    const answers = tg.calls.filter((c) => c.url.endsWith('/answerCallbackQuery'));
    expect(answers.length).toBe(1);
    expect(answers[0]!.body.text).toBeUndefined();
    expect(lastText()).toContain('Выдано +30 дн.');
  });

  it('рассылка: битый HTML в предпросмотре — подсказка и повторный ввод', async () => {
    state.me = me({ adminRole: 'owner' });
    tgReply = (r) => ((r.url.endsWith('/sendMessage') || r.url.endsWith('/editMessageText')) && r.body?.parse_mode === 'HTML' && String(r.body.text).includes('Предпросмотр') && String(r.body.text).includes('<b>') && !String(r.body.text).includes('</b>')
      ? { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Can't find end tag corresponding to start tag \"b\"" } }
      : null);
    await bot.handleUpdate(callback('ad_bc') as any);
    await bot.handleUpdate(message('Привет <b>всем') as any);
    expect(lastText()).toContain('&lt;');
    expect(lastText()).toContain('Отправьте исправленный текст');
    await bot.handleUpdate(message('Привет <b>всем</b>') as any);
    expect(lastText()).toContain('Предпросмотр');
    expect(buttons().some((x) => x.callback_data === 'bcg:all')).toBe(true);
  });

  it('гейт: если Telegram отверг кнопку со ссылкой — барьер всё равно показывается с кнопкой проверки', async () => {
    state.gate = { required: true, ok: false, text: 'Подпишитесь на канал', chats: [{ chat: '@chan', title: 'Новости', url: 'mychannel', joined: false }] };
    tgReply = (r) => ((r.url.endsWith('/sendMessage') || r.url.endsWith('/editMessageText')) && JSON.stringify(r.body?.reply_markup ?? {}).includes('"url"')
      ? { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: BUTTON_URL_INVALID' } }
      : null);
    await bot.handleUpdate(message('/start') as any);
    const ok = sent().at(-1)!;
    expect(ok.text).toContain('Подпишитесь на канал');
    expect(ok.reply_markup.inline_keyboard.flat().map((x: any) => x.callback_data)).toEqual(['gate:check']);
  });

  it('реферальная ссылка и кнопка «Поделиться»', async () => {
    await bot.handleUpdate(callback('ref') as any);
    expect(lastText()).toContain('https://t.me/bot?start=ref_abc');
    expect(buttons().find((x) => x.url?.startsWith('https://t.me/share/url'))).toBeTruthy();
  });

  it('статус подписки в меню', async () => {
    state.me = me({ subscription: activeSub, trialAvailable: false });
    await bot.handleUpdate(message('/menu') as any);
    expect(lastText()).toContain('Подписка активна');
    expect(lastText()).toContain('осталось 10 дней');
    expect(buttons().some((x) => x.callback_data === 'trial')).toBe(false);
  });

  it('гейт: без подписки на канал бот показывает барьер и не пускает дальше; после проверки — меню', async () => {
    state.gate = { required: true, ok: false, text: 'Подпишитесь на канал', chats: [{ chat: '@chan', title: 'Новости', url: 'https://t.me/chan', joined: false }] };
    await bot.handleUpdate(message('/start ref_zzz') as any);
    expect(core.calls.find((c) => c.url.endsWith('/gate'))!.headers['x-ref-code']).toBe('zzz');
    expect(lastText()).toContain('Подпишитесь на канал');
    expect(buttons().find((x) => x.url)?.url).toBe('https://t.me/chan');
    expect(core.calls.some((c) => c.url.endsWith('/me'))).toBe(false);
    await bot.handleUpdate(callback('plans') as any);
    expect(lastText()).toContain('Подпишитесь');
    await bot.handleUpdate(callback('gate:check') as any);
    expect(core.calls.some((c) => c.url.endsWith('/gate/check') && c.method === 'POST')).toBe(true);
    expect(lastText()).toContain('TestVPN');
  });

  it('баланс: пресеты, бонусы, пополнение и «умная корзина» (пополнить и купить)', async () => {
    await bot.handleUpdate(callback('wallet') as any);
    expect(lastText()).toContain('от 500 ₽ — +10%');
    expect(buttons().map((x) => x.callback_data)).toEqual(expect.arrayContaining(['tp:10000', 'tp:30000', 'tpc']));
    await bot.handleUpdate(callback('tp:30000') as any);
    await bot.handleUpdate(callback('tpm:30000:1') as any);
    const top = core.calls.filter((c) => c.url.endsWith('/payments') && c.method === 'POST').at(-1)!;
    expect(top.body).toEqual({ topupAmount: 30000, method: 'platega:sbp' });
    // тариф при нулевом балансе: пополнить на нужную сумму и купить
    await bot.handleUpdate(callback('plan:p1') as any);
    expect(buttons().some((x) => x.callback_data === 'cp:p1:0')).toBe(true);
    await bot.handleUpdate(callback('cp:p1:0') as any);
    const cart = core.calls.filter((c) => c.url.endsWith('/payments') && c.method === 'POST').at(-1)!;
    expect(cart.body).toEqual({ topupAmount: 19900, method: 'yookassa', then: { planId: 'p1' } });
    // произвольная сумма
    await bot.handleUpdate(callback('tpc') as any);
    await bot.handleUpdate(message('250') as any);
    expect(buttons().some((x) => x.callback_data === 'tpm:25000:0')).toBe(true);
  });

  it('докупки: список и покупка с баланса', async () => {
    state.me = me({ balance: 9000 });
    await bot.handleUpdate(callback('addons') as any);
    expect(lastText()).toContain('+2 устройства');
    await bot.handleUpdate(callback('ad:a1') as any);
    expect(buttons().some((x) => x.callback_data === 'adb:a1')).toBe(true);
    await bot.handleUpdate(callback('adb:a1') as any);
    expect(core.calls.filter((c) => c.url.endsWith('/payments') && c.method === 'POST').at(-1)!.body).toEqual({ addonId: 'a1', method: 'balance' });
    expect(lastText()).toContain('Докупка применена');
  });

  it('задания: можно забрать награду', async () => {
    state.quests = { enabled: true, streak: 3, quests: [{ id: 'q1', title: 'Ежедневный бонус', description: '', type: 'daily_checkin', target: 1, progress: 0, rewardType: 'balance', rewardValue: 500, repeat: 'daily', claimed: false, claimable: true, url: null }] };
    await bot.handleUpdate(callback('quests') as any);
    expect(lastText()).toContain('Серия ежедневных заходов: 3');
    expect(buttons().some((x) => x.callback_data === 'qc:q1')).toBe(true);
    await bot.handleUpdate(callback('qc:q1') as any);
    expect(core.calls.some((c) => c.url.endsWith('/quests/q1/claim'))).toBe(true);
  });

  it('админ-меню: недоступно обычному пользователю, работает у админа', async () => {
    await bot.handleUpdate(callback('admin') as any);
    expect(lastText()).toContain('Нет доступа');
    state.me = me({ adminRole: 'owner' });
    expect(buttons().length).toBeGreaterThan(0);
    await bot.handleUpdate(message('/start') as any);
    expect(buttons().some((x) => x.callback_data === 'admin')).toBe(true);
    await bot.handleUpdate(callback('ad_stats') as any);
    expect(lastText()).toContain('Выручка');
    await bot.handleUpdate(callback('ad_find') as any);
    await bot.handleUpdate(message('@vasya') as any);
    expect(lastText()).toContain('Вася');
    await bot.handleUpdate(callback('ax:u9:7') as any);
    expect(core.calls.find((c) => c.url.endsWith('/admin/users/u9/extend'))!.body).toEqual({ days: 7 });
    await bot.handleUpdate(callback('ad_mt:1') as any);
    expect(core.calls.find((c) => c.url.endsWith('/admin/maintenance'))!.body).toEqual({ enabled: true });
  });
});


describe('Orbit bot privacy and media', () => {
  it('does not query personal API for a group balance command', async () => {
    const update = message('/balance');
    (update.message as any).chat = {id:-100123,type:'supergroup',title:'Group'};
    await bot.handleUpdate(update as any);
    expect(core.calls).toHaveLength(0);
    expect(lastText()).not.toContain('Баланс:');
    expect(lastText()).toContain('личный чат');
  });
  it('photo is sent even when welcome text is empty', async () => {
    state.welcome = {startText:'',startImageUrl:'https://example.test/banner.png'};
    await bot.handleUpdate(message('/start') as any);
    expect(tg.calls.find(c=>c.url.endsWith('/sendPhoto'))!.body.photo).toBe('https://example.test/banner.png');
  });
  it('repeated payment actions carry the same operation key', async () => {
    const update = callback('pay:p1:balance');
    await bot.handleUpdate(update as any);await bot.handleUpdate(update as any);
    const calls=core.calls.filter(c=>c.url.endsWith('/payments'));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers['idempotency-key']).toBe(calls[1]!.headers['idempotency-key']);
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^bot:/);
  });
});

describe('gift invitation links', () => {
  it('opens a gift in the Mini App without activating it', async () => {
    const code = 'VAYLO-' + 'A'.repeat(24);
    await bot.handleUpdate(message('/start gift_' + code) as any);
    expect(buttons().find(x => x.web_app)?.web_app.url).toBe('https://app.example.test/gifts#gift=' + code);
    expect(core.calls.some(c => c.url.includes('/gifts/redeem'))).toBe(false);
  });
  it('keeps the invitation after the required channel check', async () => {
    state.gate = {required:true,ok:false,text:'Подпишитесь',chats:[]};
    const code = 'VAYLO-' + 'B'.repeat(24);
    await bot.handleUpdate(message('/start gift_' + code) as any);
    await bot.handleUpdate(callback('gate:check') as any);
    expect(buttons().find(x => x.web_app)?.web_app.url).toBe('https://app.example.test/gifts#gift=' + code);
  });
});

describe('daily report activity', () => {
  it('passes referral attribution to telemetry without copying a message into the payload', async () => {
    const update = message('/start ref_test-ref');
    await bot.handleUpdate(update as any);
    const event=core.calls.find(c=>c.url.endsWith('/internal/bot-activity'))!;
    expect(event.body).toEqual({updateId:update.update_id,category:'start'});
    expect(event.headers['x-ref-code']).toBe('test-ref');
  });
  it('records gift invitations as a category without the secret code', async () => {
    const code='VAYLO-'+'C'.repeat(24);
    await bot.handleUpdate(message('/start gift_'+code) as any);
    const event=core.calls.find(c=>c.url.endsWith('/internal/bot-activity'))!;
    expect(JSON.stringify(event.body)).not.toContain(code);
    expect(event.body.category).toBe('start');
  });
  it('classifies bonus callbacks and continues when analytics endpoint fails', async () => {
    await bot.handleUpdate(callback('wspin') as any);
    expect(core.calls.find(c=>c.url.endsWith('/internal/bot-activity'))!.body.category).toBe('rewards');
    expect(core.calls.some(c=>c.url.endsWith('/wheel/spin'))).toBe(true);
  });
});
