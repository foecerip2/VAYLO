import { screenNavigation } from './screens.js';
import { statusScreen } from './statusText.js';
import { createHash } from 'node:crypto';
import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy';
import { CLIENT_APP_NAMES, CLIENT_APP_STATUS, durationLabel, formatRub, bytesToHuman, pluralDays, deviceLimitLabel, friendlyErrorMessage, FRIENDLY_ERROR, MAX_TOPUP_KOPECKS, PROMO_MAX_LENGTH, type AddonCatalogDTO, type ActivityDTO, type AppConfigDTO, type DevicesDTO, type GateDTO, type MeDTO, type PlanDTO, type ServerStatusDTO, type PaymentMethodDTO, type QuestDTO, type ReferralStatsDTO, type WheelDTO, type WheelSpinResultDTO } from '@vpn/shared';
import type { UserFromGetMe } from 'grammy/types';
import { ApiError, createApi } from './api.js';

export interface BotOptions {
  token: string;
  apiUrl: string;
  internalKey: string;
  appUrl: string;
  botUsername?: string;
  apiRoot?: string;
  botInfo?: UserFromGetMe;
  /** сколько мс не перепроверять подписку на канал после успешной проверки */
  gateCacheMs?: number;
}

type PublicConfig = Pick<AppConfigDTO, 'brandName' | 'supportUrl' | 'channelUrl' | 'trial' | 'referral'> & Partial<AppConfigDTO>;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Telegram ограничивает callback_data 64 байтами */
const CALLBACK_DATA_MAX = 64;

const SUB_STATE_RU: Record<string, string> = { trial: 'пробный', active: 'активна', expiring: 'заканчивается', expired: 'истекла', none: 'нет' };

/** Ошибка Telegram «не удалось разобрать HTML-разметку» */
const isParseEntitiesError = (e: unknown) => e instanceof GrammyError && /can't parse entities|unsupported start tag|can't find end tag/i.test(e.description);

export function createBot(o: BotOptions) {
  const bot = new Bot(o.token, { ...(o.apiRoot ? { client: { apiRoot: o.apiRoot } } : {}), ...(o.botInfo ? { botInfo: o.botInfo } : {}) });
  const api = createApi({ baseUrl: o.apiUrl, internalKey: o.internalKey });
  type Await = { kind: 'promo' | 'topup' | 'find' | 'bc'; exp: number };
  const awaiting = new Map<number, Await>();
  const await_ = (id: number, kind: Await['kind']) => awaiting.set(id, { kind, exp: Date.now() + 5 * 60_000 });
  const pendingBc = new Map<number, string>(); // текст рассылки, ждущий выбора сегмента
  /** Длинные токены входа на сайт, не влезающие в callback_data: короткий id -> токен */
  const authTokens = new Map<string, { token: string; tgId: number; exp: number }>();
  let authSeq = 0;
  const appHost = (() => {
    try {
      return new URL(o.appUrl).host || o.appUrl;
    } catch {
      return o.appUrl || 'сайт';
    }
  })();
  /** Ответ на нажатие кнопки; ошибки Telegram (например, «query is too old») не ломают обработчик */
  const ack = (ctx: Context, text?: string, showAlert = false) =>
    ctx.answerCallbackQuery(text ? { text, show_alert: showAlert } : undefined).catch(() => {});
  const pendingGifts = new Map<number, {code:string;exp:number}>();
  async function giftInvitation(ctx: Context, code: string) {
    const cfg = await getConfig(ctx);
    await ctx.reply(`🎁 <b>Вам подарок ${esc(cfg.brandName)}</b>\nОткройте открытку, прочитайте поздравление и подтвердите получение. Переход по ссылке не активирует код.`, {parse_mode:'HTML',reply_markup:new InlineKeyboard().webApp('🎁 Открыть подарок', o.appUrl.replace(/\/$/,'') + '/gifts#gift=' + encodeURIComponent(code))});
  }
  const gateOk = new Map<number, number>(); // tgId -> до какого времени не проверяем канал
  const adm = <T,>(ctx: Context, method: string, path: string, body?: unknown) => api.call<T>(ctx.from!, method, '/admin' + path, body);
  const menuRow = () => new InlineKeyboard().text('⬅️ Меню', 'menu');
  const importPage = (client: string, url: string) => `${o.appUrl}/import?client=${client}&url=${encodeURIComponent(url)}`;

  const purchase = <T,>(ctx: Context, body: unknown) => api.call<T>(ctx.from!, 'POST', '/payments', body, { 'idempotency-key': 'bot:' + createHash('sha256').update(`${ctx.from!.id}:${ctx.chat?.id}:${ctx.callbackQuery?.message?.message_id ?? ctx.update.update_id}:${ctx.callbackQuery?.data ?? ''}`).digest('hex') });

  const getConfig = async (ctx: Context) => api.call<PublicConfig>(ctx.from!, 'GET', '/config');
  const me = (ctx: Context) => api.call<MeDTO>(ctx.from!, 'GET', '/me');

  // ---------- Закрытие проекта ----------
  const closureOn = (cfg?: PublicConfig) => cfg?.closure?.active === true;
  const leftText = (c: { endsAt: string | null; serverNow: string }) => {
    if (!c.endsAt) return '';
    const ms = new Date(c.endsAt).getTime() - new Date(c.serverNow).getTime();
    if (ms <= 0) return 'срок закрытия наступил';
    const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), mi = Math.floor((ms % 3_600_000) / 60_000);
    return d > 0 ? `${d} дн. ${h} ч` : h > 0 ? `${h} ч ${mi} мин` : `${mi} мин`;
  };
  /** Строка с обратным отсчётом: Telegram не обновляет сообщения сам, поэтому время пересчитывается при каждом показе меню. */
  const closureLine = (cfg?: PublicConfig): string => {
    const c = cfg?.closure;
    if (!c || !c.active) return '';
    const left = leftText(c);
    return `😢 <b>Проект закрывается.</b>${left ? ` До закрытия: <b>${left}</b> ⏳` : ''}\n🚫 Продажи и регистрация закрыты, 💙 действующие подписки работают до конца срока.`;
  };
  async function showClosure(ctx: Context) {
    const cfg = await getConfig(ctx);
    const c = cfg.closure;
    if (!c || !c.active) return void (await ctx.reply('Проект работает в обычном режиме.', { reply_markup: menuRow() }));
    const end = c.endsAt ? new Date(c.endsAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (МСК)' : '';
    await ctx.reply(`😢 <b>Проект закрывается</b>\n\n${esc(c.reason)}\n\n⏳ До закрытия: <b>${leftText(c) || '—'}</b>${end ? `\n📅 Дата: ${end}` : ''}\n\n🚫 Продажи, пополнения и регистрация закрыты.\n💙 Действующие подписки не слетят и работают до окончания срока.${c.altText ? '\n\n🧭 ' + esc(c.altText) : ''}`, { parse_mode: 'HTML', reply_markup: menuRow() });
  }

  function mainMenu(m?: MeDTO, cfg?: PublicConfig): InlineKeyboard {
    // Минимум кнопок: всё остальное (устройства, баланс, задания, колесо, друзья, промокод) — в кабинете
    const kb = new InlineKeyboard().webApp('🚀 Личный кабинет', o.appUrl).row();
    const closing = closureOn(cfg);
    if (closing) kb.text('⏳ О закрытии проекта', 'closure').row();
    if (!closing && m?.trialAvailable && cfg?.trial.enabled) kb.text(`🎁 ${cfg.trial.days} ${pluralDays(cfg.trial.days)} бесплатно`, 'trial').row();
    if (closing) kb.text('🔑 Подключиться', 'connect').row(); else kb.text('🔑 Подключиться', 'connect').text('💳 Тарифы', 'plans').row();
    kb.text('🌐 Статус серверов', 'status').row();
    if (!closing && cfg?.contestsActive) kb.text('🎁 Конкурсы', 'contests').row();
    if (!closing && cfg?.addonsEnabled !== false) kb.text('🧩 Докупки', 'addons').row();
    if (!closing) kb.webApp('🎁 Подарки', o.appUrl.replace(/\/$/, '') + '/gifts');
    kb.webApp('🛟 Помощь', o.appUrl.replace(/\/$/, '') + '/help').row();
    if (cfg?.supportInApp) kb.webApp('💬 Поддержка', o.appUrl.replace(/\/$/, '') + '/support');
    else if (cfg?.supportUrl && /^(https?:\/\/|tg:\/\/)/.test(cfg.supportUrl)) kb.url('💬 Поддержка', cfg.supportUrl);
    else kb.text('💬 Поддержка', 'support');
    if (m?.adminRole) kb.row().text('🛠 Админ-меню', 'admin');
    return kb;
  }

  function statusText(m: MeDTO): string {
    const s = m.subscription;
    const lines: string[] = [];
    if (s.state === 'none') lines.push('У вас пока нет подписки.');
    else if (s.state === 'expired') lines.push('⛔ <b>Подписка закончилась.</b> Продлите, чтобы снова пользоваться VPN.');
    else {
      const until = new Date(s.expiresAt!).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      lines.push(`${s.state === 'trial' ? '🎁 Пробный период' : '✅ Подписка активна'} до <b>${until}</b> (осталось ${s.daysLeft} ${pluralDays(s.daysLeft)})`);
      lines.push(`📊 Трафик: ${bytesToHuman(s.trafficUsedBytes)}${s.trafficLimitBytes ? ' из ' + bytesToHuman(s.trafficLimitBytes) : ' · безлимит'}`);
      lines.push(`📱 Устройств: ${deviceLimitLabel(s.deviceLimit)}`);
      if(s.lte)lines.push(`📶 Локации LTE: ${bytesToHuman(s.lte.usedBytes)} из ${bytesToHuman(s.lte.limitBytes)} · осталось ${bytesToHuman(s.lte.remainingBytes)}${s.lte.extraBytes?` (докуплено ${bytesToHuman(s.lte.extraBytes)})`:''}${s.lte.optedOut?' · отключено администратором':s.lte.remainingBytes===0?' · пакет израсходован':''}`);
      else if(s.lteUnavailable)lines.push('📶 Счётчик LTE временно недоступен');
      if (s.autoRenew) lines.push('🔄 Автопродление включено');
    }
    if (m.balance > 0) lines.push(`💰 Баланс: ${formatRub(m.balance)}`);
    return lines.join('\n');
  }

  async function showMenu(ctx: Context, edit = false) {
    const [m, cfg] = await Promise.all([me(ctx), getConfig(ctx)]);
    const text = `👋 <b>${esc(cfg.brandName)}</b> — быстрый и безопасный VPN.\n${cfg.welcomeText ? esc(cfg.welcomeText) + '\n' : ''}${cfg.maintenance ? '\n🛠 ' + esc(cfg.maintenanceText ?? 'Технические работы') + '\n' : ''}${closureLine(cfg) ? '\n' + closureLine(cfg) + '\n' : ''}\n${statusText(m)}`;
    const kb = mainMenu(m, cfg);
    if (edit && ctx.callbackQuery && !ctx.callbackQuery.message?.photo) await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }));
    else await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  /** Приветствие после /start: картинка + текст из админки + главное меню. Без текста — стандартное меню. */
  async function showStart(ctx: Context) {
    const [m, cfg] = await Promise.all([me(ctx), getConfig(ctx)]);
    const tpl = (cfg.startText ?? '').trim();
    const plain = (tpl || 'Добро пожаловать в {brand}, {name}!\n\nВаш интернет. Ваши правила.\nОткройте кабинет или подключите устройство.').replace(/\{brand\}/g, () => cfg.brandName).replace(/\{name\}/g, () => ctx.from?.first_name || 'друг');
    const text = esc(plain) + (closureLine(cfg) ? `\n\n${closureLine(cfg)}` : '') + (cfg.maintenance ? `\n\n🛠 ${esc(cfg.maintenanceText ?? 'Технические работы')}` : '') + (m.subscription.state !== 'none' ? `\n\n${statusText(m)}` : '');
    const kb = mainMenu(m, cfg);
    const image = cfg.startImageUrl || `${o.appUrl.replace(/\/$/, '')}/orbit-bot.png`;
    try {
      // Не режем HTML-сущности; длинное приветствие отделяем от баннера.
      await ctx.replyWithPhoto(image, { caption: text.length <= 1000 ? text : esc(cfg.brandName), parse_mode: 'HTML', reply_markup: text.length <= 1000 ? kb : undefined });
      if (text.length <= 1000) return;
    } catch (e) {
      console.error('[bot] welcome photo failed:', (e as Error).message);
    }
    const chunks = Array.from(plain);
    for (let i = 0; i < chunks.length; i += 900) await ctx.reply(chunks.slice(i, i + 900).join(''), { reply_markup: i + 900 >= chunks.length ? kb : undefined });
    if (cfg.maintenance) await ctx.reply('🛠 ' + (cfg.maintenanceText ?? 'Технические работы'));
    if (m.subscription.state !== 'none') await ctx.reply(statusText(m), { parse_mode: 'HTML' });
  }

  async function showConnect(ctx: Context) {
    const m = await me(ctx);
    const s = m.subscription;
    if (!s.subUrl || s.state === 'none') {
      await ctx.reply('Сначала оформите подписку или получите пробный период 👇', { reply_markup: new InlineKeyboard().text('💳 Тарифы', 'plans').row().text('⬅️ Меню', 'menu') });
      return;
    }
    const cfg=await getConfig(ctx);
    const appInfo=(cfg.clientApps??[]).filter(e=>(e.os==='ios'||e.os==='android')&&(e.status!=='unknown'||e.recommended)).slice(0,10).map(e=>`• ${esc(CLIENT_APP_NAMES[e.id])} · ${e.os==='ios'?'iPhone / iPad':e.os}: ${esc(CLIENT_APP_STATUS[e.status])}${e.recommended?' · Рекомендуем':''}`).join('\n');
    const kb = new InlineKeyboard()
      .url('🚀 Подключить VPN', s.subUrl)
      .row()
      .url('📲 Happ', importPage('happ', s.subUrl))
      .url('📲 Hiddify', importPage('hiddify', s.subUrl))
      .row()
      .url('📲 Incy', importPage('incy', s.subUrl))
      .url('📲 Streisand', importPage('streisand', s.subUrl))
      .row()
      .url('📲 Karing', importPage('karing', s.subUrl))
      .row()
      .webApp('📖 Инструкция в приложении', `${o.appUrl}/connect`)
      .row()
      .text('📱 Мои устройства', 'devices')
      .text('⬅️ Меню', 'menu');
    await ctx.reply(
      `🔑 <b>Ваша ссылка подписки</b>\n<code>${esc(s.subUrl)}</code>\n\n1. Установите приложение (Happ, Hiddify, Incy, Streisand или Karing)\n2. Нажмите на кнопку приложения ниже — подписка добавится сама\n3. Или скопируйте ссылку и добавьте её вручную\n\n${appInfo?'По информации администрации:\n'+appInfo+'\n\nСохраните установленное приложение. В другом клиенте используйте прежнюю ссылку подписки.\n\n':''}${s.state === 'expired' ? '⚠️ Подписка закончилась — продлите её.' : ''}`,
      { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } },
    );
  }

  async function showServerStatus(ctx: Context, edit = false) {
    const [d, cfg] = await Promise.all([api.call<ServerStatusDTO>(ctx.from!, 'GET', '/status/servers'), getConfig(ctx)]);
    const kb = new InlineKeyboard().text('🔄 Обновить', 'status').row().text('⬅️ Меню', 'menu');
    const text = statusScreen(d, cfg.brandName);
    // «Обновить» правит то же сообщение, чтобы не копить экраны в чате
    if (edit && ctx.callbackQuery?.message) {
      try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); return; } catch (e) { if (String((e as Error).message).includes('not modified')) return; }
    }
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  async function showPlans(ctx: Context) {
    const plans = await api.call<PlanDTO[]>(ctx.from!, 'GET', '/plans');
    const kb = new InlineKeyboard();
    for (const p of plans) kb.text(`${p.name} — ${formatRub(p.price)}${p.badge ? ' · ' + p.badge : ''}`, `plan:${p.id}`).row();
    kb.text('⬅️ Меню', 'menu');
    const lines = plans.map((p) => `• <b>${esc(p.name)}</b> (${durationLabel(p.durationDays)}) — ${formatRub(p.price)}${p.trafficLimitGb ? ', ' + p.trafficLimitGb + ' ГБ' : ', безлимит'}, ${p.deviceLimit ? `до ${p.deviceLimit} устр.` : 'безлимит устройств'}`);
    await ctx.reply(`💳 <b>Выберите тариф</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML', reply_markup: kb });
  }

  const payMethods = async (ctx: Context) => (await api.call<PaymentMethodDTO[]>(ctx.from!, 'GET', '/payment-methods')).filter((x) => x.provider !== 'balance');

  /** Экран выбора оплаты для тарифа или докупки: с баланса / сразу картой / пополнить и купить автоматически */
  async function showBuy(ctx: Context, kind: 'p' | 'a', id: string) {
    const body = kind === 'p' ? { planId: id } : { addonId: id };
    const [q, methods] = await Promise.all([api.call<{ total: number; balance: number }>(ctx.from!, 'POST', '/quote', body), payMethods(ctx)]);
    let title = '';
    if (kind === 'p') {
      const plan = (await api.call<PlanDTO[]>(ctx.from!, 'GET', '/plans')).find((p) => p.id === id);
      if (!plan) return void (await ctx.reply('Тариф не найден или отключён.'));
      title = `<b>${esc(plan.name)}</b> (${durationLabel(plan.durationDays)})`;
    } else {
      const cat = await api.call<AddonCatalogDTO>(ctx.from!, 'GET', '/addons');
      const p = cat.products.find((x) => x.id === id);
      if (!p) return void (await ctx.reply('Товар не найден или отключён.'));
      title = `<b>${esc(p.name)}</b>`;
    }
    const kb = new InlineKeyboard();
    const enough = q.balance >= q.total;
    if (enough) kb.text(`💰 С баланса (${formatRub(q.balance)})`, kind === 'p' ? `pay:${id}:balance` : `adb:${id}`).row();
    else if (methods.length) {
      const need = Math.max(q.total - q.balance, 0);
      methods.forEach((x, i) => kb.text(`${x.title} · пополнить и купить`, `c${kind}:${id}:${i}`).row());
      void need;
    }
    if (kind === 'p') for (const x of methods) kb.text(`${x.title}${enough ? '' : ' (только оплата)'}`, `pay:${id}:${x.id}`).row();
    if (!methods.length && !enough) {
      await ctx.reply('Оплата временно недоступна — администратор ещё не подключил способы оплаты.', { reply_markup: menuRow() });
      return;
    }
    kb.text('⬅️ Назад', kind === 'p' ? 'plans' : 'addons');
    const hint = !enough ? `\n\nНа балансе ${formatRub(q.balance)}. «Пополнить и купить» зачислит нужную сумму и сразу оформит покупку.` : '';
    await ctx.reply(`${title} — ${formatRub(q.total)}\nВыберите способ оплаты:${hint}`, { parse_mode: 'HTML', reply_markup: kb });
  }

  async function showMethods(ctx: Context, planId: string) {
    return showBuy(ctx, 'p', planId);
  }

  async function pay(ctx: Context, planId: string, method: string) {
    const r = await purchase<{ id: string; status: string; payUrl: string | null }>(ctx, { planId, method });
    if (r.status === 'succeeded') {
      await ctx.reply('✅ Готово! Подписка оформлена.', { reply_markup: new InlineKeyboard().text('🔑 Подключиться', 'connect').text('⬅️ Меню', 'menu') });
      return;
    }
    await ctx.reply('Нажмите кнопку для оплаты. Доступ откроется автоматически сразу после оплаты — мы пришлём уведомление.', {
      reply_markup: new InlineKeyboard().url('💳 Перейти к оплате', r.payUrl!).row().text('⬅️ Меню', 'menu'),
    });
  }

  const payLink = (ctx: Context, url: string, text: string) => ctx.reply(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('💳 Перейти к оплате', url).row().text('⬅️ Меню', 'menu') });

  /** Пополнение (умная корзина: после оплаты автоматически купим тариф/докупку) */
  async function topupWith(ctx: Context, amount: number, methodIdx: number, then?: { planId?: string; addonId?: string }) {
    const methods = await payMethods(ctx);
    const m = methods[methodIdx];
    if (!m) return void (await ctx.reply('Способ оплаты недоступен.'));
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_TOPUP_KOPECKS) return void (await ctx.reply('Некорректная сумма пополнения.', { reply_markup: menuRow() }));
    const r = await purchase<{ id: string; status: string; payUrl: string | null }>(ctx, { topupAmount: amount, method: m.id, ...(then ? { then } : {}) });
    await payLink(ctx, r.payUrl!, `Пополнение на <b>${formatRub(amount)}</b>.${then ? ' После оплаты покупка оформится автоматически.' : ''}\nНажмите кнопку для оплаты:`);
  }

  async function cart(ctx: Context, kind: 'p' | 'a', id: string, idx: number) {
    const [cfg, q] = await Promise.all([getConfig(ctx), api.call<{ total: number; balance: number }>(ctx.from!, 'POST', '/quote', kind === 'p' ? { planId: id } : { addonId: id })]);
    const min = cfg.topup?.min ?? 10000;
    const amount = Math.max(min, Math.ceil((q.total - q.balance) / 100) * 100);
    await topupWith(ctx, amount, idx, kind === 'p' ? { planId: id } : { addonId: id });
  }

  async function showWallet(ctx: Context, notice?: string) {
    const [m, cfg] = await Promise.all([me(ctx), getConfig(ctx)]);
    const t = cfg.topup;
    const lines = [...(notice ? [notice, ''] : []), `💰 <b>Баланс: ${formatRub(m.balance)}</b>`, 'С баланса можно оплачивать тарифы и докупки, а он пополняется картой, СБП или криптой.'];
    if (t?.bonuses?.length) lines.push('\n🎁 Бонусы к пополнению: ' + t.bonuses.map((b) => `от ${formatRub(b.from)} — +${b.percent}%`).join(', '));
    if (m.discountPct) lines.push(`\n🏷 Ваша персональная скидка: ${m.discountPct}%`);
    const kb = new InlineKeyboard();
    (t?.presets ?? [10000, 30000, 50000, 100000]).forEach((a, i) => { kb.text(`+${formatRub(a)}`, `tp:${a}`); if (i % 2 === 1) kb.row(); });
    kb.row().text('✏️ Другая сумма', 'tpc').row();
    if (cfg.autoRenewEnabled !== false && m.subscription.state !== 'none' && !m.subscription.isTrial) {
      kb.text(m.subscription.autoRenew ? '🔄 Автопродление: вкл (выключить)' : '🔄 Включить автопродление', m.subscription.autoRenew ? 'ar:0' : 'ar:1').row();
      lines.push(m.subscription.autoRenew ? '\n🔄 Автопродление включено: за 3 дня до конца продлим тариф с баланса.' : '\n🔄 Автопродление: за 3 дня до конца продлим тариф с баланса, чтобы вы не потеряли доступ.');
    }
    kb.text('⬅️ Меню', 'menu');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  }

  async function showTopupMethods(ctx: Context, amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_TOPUP_KOPECKS) return void (await ctx.reply('Некорректная сумма пополнения.', { reply_markup: new InlineKeyboard().text('⬅️ Назад', 'wallet') }));
    const methods = await payMethods(ctx);
    if (!methods.length) return void (await ctx.reply('Оплата временно недоступна — администратор ещё не подключил способы оплаты.', { reply_markup: menuRow() }));
    const kb = new InlineKeyboard();
    methods.forEach((x, i) => kb.text(x.title, `tpm:${amount}:${i}`).row());
    kb.text('⬅️ Назад', 'wallet');
    await ctx.reply(`Пополнение на <b>${formatRub(amount)}</b>. Выберите способ оплаты:`, { parse_mode: 'HTML', reply_markup: kb });
  }

  async function showDevices(ctx: Context, edit = false, notice = '') {
    const d = await api.call<DevicesDTO>(ctx.from!, 'GET', '/devices');
    if (!d.active && !d.devices.length) {
      const t = 'У вас нет активной подписки, поэтому устройств пока нет.';
      const kb = new InlineKeyboard().text('💳 Тарифы', 'plans').row().text('⬅️ Меню', 'menu');
      if (edit && ctx.callbackQuery) await ctx.editMessageText(t, { reply_markup: kb }).catch(() => ctx.reply(t, { reply_markup: kb }));
      else await ctx.reply(t, { reply_markup: kb });
      return;
    }
    const unlimited = d.limit === 0;
    const free = unlimited ? null : Math.max(0, d.limit - d.used);
    const lines = [
      '📱 <b>Мои устройства</b>',
      unlimited ? `Подключено: <b>${d.used}</b> (без ограничений)` : `Подключено: <b>${d.used} из ${d.limit}</b>${free === 0 ? ' — мест нет' : ` · свободно ${free}`}`,
      '',
    ];
    if (!d.devices.length) lines.push('Пока нет подключённых устройств. Добавьте подписку в VPN-приложение — устройство появится здесь само.');
    d.devices.forEach((v, i) => lines.push(`${i + 1}. <b>${esc(v.name)}</b>${v.lastSeenAt ? ' · ' + new Date(v.lastSeenAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}`));
    if (free === 0) lines.push('', 'Чтобы подключить новое устройство, удалите ненужное или докупите место.');
    if (notice) lines.unshift(notice, '');
    const kb = new InlineKeyboard();
    d.devices.forEach((v, i) => kb.text(`🗑 ${i + 1}. ${v.name.slice(0, 24)}`, `dvx:${v.id}`).row());
    if (d.devices.length > 1) kb.text('🗑 Удалить все', 'dvall').row();
    kb.text('➕ Подключить', 'connect');
    kb.text('🛒 Докупить место', 'addons');
    kb.row().text('⬅️ Меню', 'menu');
    const text = lines.join('\n');
    if (edit && ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }));
    else await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  async function showAddons(ctx: Context) {
    const cat = await api.call<AddonCatalogDTO>(ctx.from!, 'GET', '/addons');
    if (!cat.enabled) return void (await ctx.reply('Докупки временно недоступны.', { reply_markup: menuRow() }));
    const products=cat.products.filter(p=>p.kind==='devices'||p.kind==='lte');
    if (!products.length) return void (await ctx.reply('Пока нет доступных докупок.', { reply_markup: menuRow() }));
    const kb = new InlineKeyboard();
    const lines = ['➕ <b>Докупки</b>', cat.active ? 'Расширьте текущую подписку:' : 'Докупки доступны при активной подписке.'];
    for (const p of products) {
      const icon = p.kind === 'devices' ? '📱' : (p.kind === 'traffic'||p.kind==='lte') ? '📊' : '🌍';
      const price = p.finalPrice < p.price ? `${formatRub(p.finalPrice)} (вместо ${formatRub(p.price)})` : formatRub(p.price);
      lines.push(`${icon} <b>${esc(p.name)}</b> — ${price}${p.kind==='lte'?` · +${p.qty} ГБ LTE на 30 дней`:''}${p.owned ? ' · ✅ подключено' : ''}${p.description ? '\n   ' + esc(p.description) : ''}`);
      if (p.available !== false && cat.active !== false) kb.text(`${icon} ${p.name} — ${formatRub(p.finalPrice)}`, `ad:${p.id}`).row();
      if (p.unavailableReason) lines.push('   ℹ️ ' + esc(p.unavailableReason));
    }
    if(products.some(p=>p.kind==='lte'))lines.push('\nLTE-пакеты учитываются отдельно от общего безлимитного VPN-трафика.');
    kb.text('⬅️ Меню', 'menu');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  }

  const questReward = (q: QuestDTO, bonus = 0) => (q.rewardType === 'days' ? `+${q.rewardValue} ${pluralDays(q.rewardValue)}` : `+${formatRub(q.rewardValue + bonus)}`);

  async function showQuests(ctx: Context, notice?: string) {
    const r = await api.call<{ enabled: boolean; streak: number; quests: QuestDTO[] }>(ctx.from!, 'GET', '/quests');
    if (!r.enabled) return void (await ctx.reply(notice ? `${notice}\n\nЗадания пока отключены.` : 'Задания пока отключены.', { reply_markup: menuRow() }));
    const kb = new InlineKeyboard();
    const lines = [...(notice ? [notice, ''] : []), '🎯 <b>Задания</b>', r.streak ? `🔥 Серия ежедневных заходов: ${r.streak}` : 'Выполняйте задания и получайте награды.', ''];
    for (const q of r.quests) {
      const mark = q.claimed ? '✅' : q.claimable ? '🎁' : '⬜';
      const prog = q.type === 'daily_checkin' || q.target === 1 ? '' : ` (${q.type === 'topup_total' || q.type === 'spend_total' ? formatRub(q.progress) + ' / ' + formatRub(q.target) : q.type === 'traffic_used' ? bytesToHuman(q.progress) + ' / ' + bytesToHuman(q.target) : q.progress + '/' + q.target})`;
      lines.push(`${mark} <b>${esc(q.title)}</b>${prog} — ${questReward(q)}${q.repeat === 'daily' ? ' · ежедневно' : ''}${q.description ? '\n   ' + esc(q.description) : ''}`);
      if (q.url) kb.url(`🔗 ${q.title}`, q.url).row();
      if (q.claimable) kb.text(`🎁 Забрать: ${q.title}`, `qc:${q.id}`).row();
    }
    kb.text('⬅️ Меню', 'menu');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  }

  async function showRef(ctx: Context, notice?: string) {
    const r = await api.call<ReferralStatsDTO>(ctx.from!, 'GET', '/referrals');
    const link = r.link ?? r.webLink;
    const pct = r.rewardPercent + (r.rank?.percent ?? 0);
    const days = r.rewardDays + (r.rank?.extraDays ?? 0);
    const kb = new InlineKeyboard().url('📤 Поделиться', `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Быстрый и надёжный VPN — попробуй:')}`).row();
    const lines = [...(notice ? [notice, ''] : []), '👥 <b>Пригласите друзей</b>'];
    if (r.mode === 'both') {
      const reward = [days ? `+${days} ${pluralDays(days)}` : '', pct ? `${pct}% на баланс` : ''].filter(Boolean).join(' и ');
      if (reward) lines.push(`За ${r.recurring ? 'каждую оплату' : 'первую оплату'} друга вы получаете ${reward}.`);
    } else {
      lines.push('Выберите, что вам выгоднее:');
      lines.push(`${r.mode === 'days' ? '✅' : '▫️'} <b>Бесплатные дни</b> — +${days} ${pluralDays(days)} за каждого друга, который оплатил подписку`);
      lines.push(`${r.mode === 'balance' ? '✅' : '▫️'} <b>Деньги</b> — ${pct}% ${r.recurring ? 'с каждой оплаты' : 'с первой оплаты'} друга на реферальный счёт, можно вывести`);
      kb.text(r.mode === 'days' ? '💰 Хочу деньги' : '🎁 Хочу дни', `refmode:${r.mode === 'days' ? 'balance' : 'days'}`).row();
    }
    if (r.level2Percent && r.mode !== 'days') lines.push(`Плюс ${r.level2Percent}% с оплат друзей ваших друзей.`);
    if (r.signupBonus) lines.push(`Друг получит приветственный бонус ${formatRub(r.signupBonus)}.`);
    if (r.rank) lines.push(`\n🏅 Ваш ранг: <b>${esc(r.rank.name)}</b>${r.rank.percent ? ` (+${r.rank.percent}%)` : ''}${r.nextRank ? ` · до «${esc(r.nextRank.name)}» осталось ${r.nextRank.left}` : ''}`);
    if (r.mode !== 'both' && (r.mode === 'balance' || r.refBalance > 0 || r.withdrawPending > 0)) {
      lines.push(`\n💼 <b>Реферальный счёт: ${formatRub(r.refBalance)}</b>${r.withdrawPending ? ` · в обработке ${formatRub(r.withdrawPending)}` : ''}${r.withdrawn ? ` · выплачено ${formatRub(r.withdrawn)}` : ''}`);
      if (r.refBalance > 0) kb.text(`🔁 На баланс${r.withdraw.transferBonusPercent ? ` +${r.withdraw.transferBonusPercent}%` : ''}`, 'refmove').row();
      if (r.withdraw.enabled) kb.webApp(r.refBalance >= r.withdraw.min ? '💸 Вывести' : `💸 Вывод от ${formatRub(r.withdraw.min)}`, o.appUrl.replace(/\/$/, '') + '/referrals').row();
    }
    lines.push(`\nВаша ссылка:\n<code>${esc(link)}</code>`);
    lines.push(`\nПриглашено: ${r.invited}${r.invitedLevel2 ? ` (+${r.invitedLevel2} 2-го уровня)` : ''} · оплатили: ${r.paid}${r.earnedBalance ? ` · заработано ${formatRub(r.earnedBalance)}` : ''}${r.earnedDays ? ` · получено ${r.earnedDays} ${pluralDays(r.earnedDays)}` : ''}`);
    kb.text('⬅️ Меню', 'menu');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
  }

  async function adminWithdrawals(ctx: Context) {
    await needAdmin(ctx);
    const list = await adm<any[]>(ctx, 'GET', '/withdrawals?status=pending');
    if (!list.length) return void (await ctx.reply('💸 <b>Выводы</b>\n\nЗаявок на вывод нет.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Обновить', 'ad_wd').text('⬅️ Назад', 'admin') }));
    await ctx.reply(`💸 <b>Заявок на вывод: ${list.length}</b>`, { parse_mode: 'HTML' });
    for (const w of list.slice(0, 8)) {
      await ctx.reply(
        `<b>${formatRub(w.payout)}</b>${w.fee ? ` (комиссия ${formatRub(w.fee)})` : ''}\n${esc(w.name ?? '—')}${w.username ? ' @' + esc(w.username) : ''} · TG <code>${w.tgId ?? '—'}</code>\n${esc(w.method || 'способ не указан')}: <code>${esc(w.details)}</code>\n<i>${fmtDT(w.createdAt)}</i>`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('✅ Выплачено', `wdp:${w.id}`).text('❌ Отклонить', `wdr:${w.id}`) },
      );
    }
    await ctx.reply('Нажмите «Выплачено» только после перевода денег пользователю.', { reply_markup: new InlineKeyboard().text('⬅️ Назад', 'admin') });
  }

  // ---------- Админ-меню ----------
  const needAdmin = async (ctx: Context) => {
    const m = await me(ctx);
    if (!m.adminRole) throw new ApiError(403, 'Нет доступа');
    return m;
  };

  async function showAdmin(ctx: Context) {
    const m = await needAdmin(ctx);
    const cfg = await getConfig(ctx);
    const kb = new InlineKeyboard()
      .text('📊 Сводка', 'ad_stats').text('👁 Активность', 'ad_act').row()
      .text('🩺 Мониторинг', 'ad_mon').text('👥 Кто кого привёл', 'ad_rf').row()
      .text('💸 Выводы', 'ad_wd').text('📡 Доступность', 'ad_net').row()
      .text('🔎 Найти пользователя', 'ad_find').text('📣 Рассылка', 'ad_bc').row()
      .text(cfg.maintenance ? '✅ Снять техработы' : '🛠 Включить техработы', `ad_mt:${cfg.maintenance ? 0 : 1}`).row()
      .webApp('🖥 Полная админка', o.appUrl.replace(/\/$/, '') + '/admin').row()
      .text('⬅️ Меню', 'menu');
    await ctx.reply(`🛠 <b>Админ-меню</b> · роль: ${m.adminRole}${cfg.maintenance ? '\n⚠️ Сейчас включены техработы' : ''}`, { parse_mode: 'HTML', reply_markup: kb });
  }

  async function adminStats(ctx: Context) {
    await needAdmin(ctx);
    const s = await adm<any>(ctx, 'GET', '/stats/overview');
    const t = `📊 <b>Сводка</b>\n\n👤 Пользователей: ${s.users.total} (+${s.users.new_1d} за сутки, +${s.users.new_7d} за неделю)\n✅ Активных подписок: ${s.subscriptions.active} · пробных: ${s.subscriptions.trial}\n⏳ Заканчиваются ≤3 дн.: ${s.subscriptions.expiring}\n\n💵 Выручка: сегодня ${formatRub(s.revenue.today)} · 7 дн. ${formatRub(s.revenue.d7)} · 30 дн. ${formatRub(s.revenue.d30)}\n🧾 Платежей за 30 дн.: ${s.revenue.count30}\n🎯 Конверсия пробного в оплату: ${s.trialConversion}%${s.unfulfilledPayments ? `\n⚠️ Оплачено, но не выдано: ${s.unfulfilledPayments}` : ''}`;
    await ctx.reply(t, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Обновить', 'ad_stats').text('⬅️ Назад', 'admin') });
  }

  async function adminActivity(ctx: Context) {
    await needAdmin(ctx);
    const a = await adm<ActivityDTO>(ctx, 'GET', '/activity');
    const m = a.summary;
    const when = (iso: string) => {
      const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
      return mins < 2 ? 'только что' : mins < 60 ? `${mins} мин` : mins < 1440 ? `${Math.round(mins / 60)} ч` : new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    };
    const icon: Record<string, string> = { signup: '🆕', payment: '💰', wheel: '🎡', quest: '🎯' };
    const lines = [
      '👁 <b>Активность</b>',
      '',
      `📶 В VPN сейчас: <b>${m.vpnOnline ?? '—'}</b>`,
      `🟢 Заходили за час: <b>${m.online1h}</b> · за сутки: <b>${m.active1d}</b> · за неделю: <b>${m.active7d}</b>`,
      `🆕 Новых за сутки: <b>${m.new1d}</b> (всего ${m.total})`,
      `💳 Платили за 30 дней: <b>${m.paying30d}</b> · активных подписок: <b>${m.activeSubs}</b>`,
      '',
      '<b>Последние события</b>',
      ...a.events.slice(0, 10).map((e) => `${icon[e.type] ?? '•'} ${esc(e.name)} — ${esc(e.detail)}${e.amount ? ' ' + formatRub(e.amount) : ''} <i>(${when(e.at)})</i>`),
    ];
    if (!a.events.length) lines.push('Пока ничего не происходило.');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Обновить', 'ad_act').text('⬅️ Назад', 'admin') });
  }

  async function adminNetwork(ctx: Context) {
    await needAdmin(ctx);
    type NetData = { labels: Record<string, string>; rows: { operator: string; target: string; os: string; samples: number; okPct: number }[]; issues: { operator: string; target: string; okPct: number; samples: number }[]; probes: { probe: string; target: string; ok: boolean; ms: number | null; detail: string | null }[] };
    const r = await adm<NetData>(ctx, 'GET', '/net?minutes=60');
    const lines = ['📡 <b>Доступность у операторов</b> · за час', ''];
    if (r.issues.length) {
      lines.push('🔴 <b>Проблемы сейчас</b>');
      for (const i of r.issues) lines.push(`• ${esc(r.labels[i.operator] ?? i.operator)}: ${esc(i.target)} — ${i.okPct}% из ${i.samples}`);
      lines.push('');
    }
    const byOp = new Map<string, { n: number; ok: number }>();
    for (const row of r.rows) { const v = byOp.get(row.operator) ?? { n: 0, ok: 0 }; v.n += row.samples; v.ok += (row.okPct / 100) * row.samples; byOp.set(row.operator, v); }
    if (!byOp.size) lines.push('Замеров за час пока нет: они приходят, когда клиенты открывают приложение.');
    for (const [op, v] of byOp) { const pct = Math.round((v.ok / v.n) * 100); lines.push(`${pct >= 90 ? '🟢' : pct >= 60 ? '🟡' : '🔴'} ${esc(r.labels[op] ?? op)} — ${pct}% (${v.n} замеров)`); }
    if (r.probes.length) {
      lines.push('', '<b>Проба по ключу</b>');
      for (const p of r.probes.slice(0, 12)) lines.push(`${p.ok ? '🟢' : '🔴'} ${esc(p.target)} · ${esc(p.probe)}${p.ok ? ` · ${p.ms ?? '—'} мс` : p.detail ? ' — ' + esc(p.detail) : ''}`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Обновить', 'ad_net').text('⬅️ Назад', 'admin') });
  }

  async function adminMonitoring(ctx: Context, run = false) {
    await needAdmin(ctx);
    if (run) await adm(ctx, 'POST', '/monitoring/run');
    const r = await adm<{ maintenance: boolean; state: { label: string; status: string; detail: string | null }[]; events: { label: string; status: string; created_at: string }[] }>(ctx, 'GET', '/monitoring');
    const icon = (st: string) => (st === 'up' ? '🟢' : st === 'down' ? '🔴' : '⚪️');
    const lines = ['🩺 <b>Мониторинг</b>', ''];
    for (const s of r.state) lines.push(`${icon(s.status)} ${esc(s.label)}${s.detail ? ' — ' + esc(s.detail) : ''}`);
    if (!r.state.length) lines.push('Данных пока нет — проверка запускается раз в минуту.');
    if (r.events.length) {
      lines.push('\n<b>Последние события</b>');
      for (const e of r.events.slice(0, 5)) lines.push(`${icon(e.status)} ${esc(e.label)} · ${new Date(e.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Проверить сейчас', 'ad_monrun').text('⬅️ Назад', 'admin') });
  }


  const SUB_ICON: Record<string, string> = { active: '✅', trial: '🎁', expired: '⛔', none: '▫️' };
  const fmtDT = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  const who = (n: { name: string; username: string | null }) => `${esc(n.name)}${n.username ? ' @' + esc(n.username) : ''}`;

  async function adminRefTree(ctx: Context, id: string) {
    await needAdmin(ctx);
    const t = await adm<any>(ctx, 'GET', `/users/${id}/referrals`);
    const lines = [
      `👥 <b>Рефералы: ${who(t.user)}</b>`,
      t.referrer ? `Пригласил: <b>${who(t.referrer)}</b> · ${fmtDT(t.user.joinedAt)}` : 'Пришёл сам, без реферальной ссылки',
      `Привёл: <b>${t.totals.level1}</b> (оплатили ${t.totals.paid}) · 2 уровень: ${t.totals.level2}`,
      `Заработал: ${t.totals.earnedBalance ? formatRub(t.totals.earnedBalance) : '0 ₽'}${t.totals.earnedDays ? ` + ${t.totals.earnedDays} дн.` : ''}`,
      '',
    ];
    if (!t.level1.length) lines.push('Пока никого не привёл.');
    for (const n of t.level1.slice(0, 15)) lines.push(`${SUB_ICON[n.sub] ?? '▫️'} ${who(n)} · ${fmtDT(n.joinedAt)}${n.paid ? ' · 💰' : ''}${n.invited ? ` · привёл ${n.invited}` : ''}`);
    if (t.level1.length > 15) lines.push(`… и ещё ${t.level1.length - 15} (полный список — в веб-админке)`);
    const kb = new InlineKeyboard();
    if (t.referrer) kb.text('⬆️ Карточка пригласившего', `au:${t.referrer.id}`).row();
    kb.text('👤 Карточка', `au:${id}`).text('⬅️ Назад', 'admin');
    await ctx.reply(lines.join('\n').slice(0, 4000), { parse_mode: 'HTML', reply_markup: kb });
  }

  async function adminRefFeed(ctx: Context) {
    await needAdmin(ctx);
    const feed = await adm<any[]>(ctx, 'GET', '/referrals/feed');
    const lines = ['👥 <b>Кто кого привёл</b>', ''];
    if (!feed.length) lines.push('Пока никто не регистрировался по реферальным ссылкам.');
    for (const f of feed.slice(0, 20)) lines.push(`${SUB_ICON[f.sub] ?? '▫️'} ${who(f)} ← ${who(f.referrer)}${f.paid ? ' 💰' : ''}\n   <i>${fmtDT(f.joinedAt)}</i>`);
    const kb = new InlineKeyboard();
    for (const f of feed.slice(0, 6)) kb.text(`👤 ${f.referrer.name.slice(0, 18)}`, `arf:${f.referrer.id}`);
    kb.row().text('🔄 Обновить', 'ad_rf').text('⬅️ Назад', 'admin');
    await ctx.reply(lines.join('\n').slice(0, 4000), { parse_mode: 'HTML', reply_markup: kb });
  }

  async function showWheel(ctx: Context) {
    const w = await api.call<WheelDTO>(ctx.from!, 'GET', '/wheel');
    if (!w.enabled) return void (await ctx.reply('Колесо удачи пока отключено.', { reply_markup: menuRow() }));
    const kb = new InlineKeyboard();
    const lines = ['🎡 <b>Колесо удачи</b>', 'Один бесплатный прокрут в сутки — дни подписки или деньги на баланс.', '', 'Призы: ' + w.prizes.map((p) => esc(p.label)).join(' · ')];
    if (w.canSpin) kb.text('🎡 Крутить!', 'wspin').row();
    else lines.push('', `⏳ Следующий прокрут: <b>${w.nextSpinAt ? fmtDT(w.nextSpinAt) : 'завтра'}</b> (МСК)`);
    if (w.last) lines.push('', `Прошлый приз: <b>${esc(w.last.label)}</b>`);
    kb.webApp('🎨 Открыть в приложении', o.appUrl.replace(/\/$/, '') + '/wheel').row().text('⬅️ Меню', 'menu');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  }

  async function spinWheelBot(ctx: Context) {
    const r = await api.call<WheelSpinResultDTO>(ctx.from!, 'POST', '/wheel/spin', {});
    await ctx.replyWithDice('🎰').catch(() => {});
    await new Promise((res) => setTimeout(res, 2500));
    await ctx.reply(`🎉 <b>Выпало: ${esc(r.prize.label)}!</b>\nПриз уже начислен. Следующий прокрут — завтра.`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🎯 Задания', 'quests').text('⬅️ Меню', 'menu') });
  }

  async function adminUserCard(ctx: Context, id: string, notice?: string) {
    await needAdmin(ctx);
    const r = await adm<any>(ctx, 'GET', `/users/${id}`);
    const u = r.user;
    const s = r.subscription;
    const lines = [
      ...(notice ? [notice, ''] : []),
      `👤 <b>${esc(u.first_name ?? '—')}</b>${u.username ? ' @' + esc(u.username) : ''}`,
      `TG ID: <code>${u.tg_id ?? '—'}</code>${u.status === 'banned' ? ' · 🚫 заблокирован' : ''}`,
      s.state === 'none' ? 'Подписки нет' : `Подписка: ${esc(s.planName ?? '—')} · до ${new Date(s.expiresAt).toLocaleDateString('ru-RU')} (${SUB_STATE_RU[s.state] ?? s.state})`,
      `Трафик: ${bytesToHuman(s.trafficUsedBytes)}${s.trafficLimitBytes ? ' / ' + bytesToHuman(s.trafficLimitBytes) : ' · безлимит'} · устройств: ${s.deviceLimit ? s.deviceLimit : 'без ограничений'}`,
      `Баланс: ${formatRub(u.balance)}${u.discount_pct ? ` · скидка ${u.discount_pct}%` : ''}`,
      `Приглашено: ${r.invited}`,
    ];
    const kb = new InlineKeyboard()
      .text('+7 дн.', `ax:${id}:7`).text('+30 дн.', `ax:${id}:30`).row()
      .text('+100 ₽', `abal:${id}:10000`).text('+500 ₽', `abal:${id}:50000`).row()
      .text(u.status === 'banned' ? '✅ Разблокировать' : '🚫 Заблокировать', `ab:${id}:${u.status === 'banned' ? 0 : 1}`).text('🔗 Сбросить ссылку', `arl:${id}`).row()
      .text('👥 Рефералы', `arf:${id}`).row()
      .text('⬅️ Назад', 'admin');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  }

  async function adminFind(ctx: Context, q: string) {
    await needAdmin(ctx);
    const r = await adm<{ items: { id: string; first_name: string | null; username: string | null; tg_id: number | null }[] }>(ctx, 'GET', `/users?q=${encodeURIComponent(q)}&limit=8`);
    if (!r.items.length) return void (await ctx.reply('Никого не нашли. Попробуйте @username, Telegram ID или имя.', { reply_markup: new InlineKeyboard().text('🔎 Ещё раз', 'ad_find').text('⬅️ Назад', 'admin') }));
    if (r.items.length === 1) return adminUserCard(ctx, r.items[0]!.id);
    const kb = new InlineKeyboard();
    for (const u of r.items) kb.text(`${u.first_name ?? '—'}${u.username ? ' @' + u.username : ''} · ${u.tg_id ?? ''}`, `au:${u.id}`).row();
    kb.text('⬅️ Назад', 'admin');
    await ctx.reply('Найдено несколько пользователей:', { reply_markup: kb });
  }

  async function guard(ctx: Context, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'registration_closed') {
        const cfg = await getConfig(ctx).catch(() => undefined);
        const line = closureLine(cfg);
        return void (await ctx.reply(`🚫 <b>Регистрация закрыта</b> 😔\n\n${cfg?.closure?.active ? esc(cfg.closure.reason) : 'Проект закрывается, новые пользователи не принимаются.'}${line ? '\n\n' + line : ''}`, { parse_mode: 'HTML' }).catch(() => {}));
      }
      const msg = e instanceof ApiError ? friendlyErrorMessage(e.message) : FRIENDLY_ERROR;
      if (!(e instanceof ApiError)) console.error('[bot]', e);
      await ctx.reply(`⚠️ ${esc(msg)}`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⬅️ Меню', 'menu') }).catch(() => {});
    }
  }

  // Личные данные и административные команды доступны только в личной переписке.
  bot.use(async (ctx, next) => {
    if (!ctx.from) return;
    if (ctx.chat?.type === 'private') return next();
    if (ctx.callbackQuery) await ack(ctx);
    if (!ctx.chat) return;
    await ctx.reply('Откройте личный чат с ботом — там доступны подписка, баланс и настройки.');
  });

  bot.use(screenNavigation());

  // Only category and update ID are sent; user messages/codes are never analytics payloads.
  bot.use(async (ctx, next) => {
    if (ctx.from && (ctx.message || ctx.callbackQuery)) {
      const action = ctx.callbackQuery?.data ?? ctx.message?.text ?? '';
      const category = /^\/start(?:@\w+)?(?: |$)/.test(action) ? 'start'
        : /^(?:menu|\/menu)$/.test(action) ? 'menu'
        : /^(?:trial|sub|connect|devices|dvx:|dvy:|dvall|ar:|\/(?:trial|connect|devices))/.test(action) ? 'subscription'
        : /^(?:pay|plan|topup|balance|wallet|tp:|tpc|tpm:|addons|ad:|adb:|c[pa]:|promo|\/buy)/.test(action) ? 'payments'
        : /^(?:gift|\/gift)/.test(action) ? 'gifts'
        : /^(?:support|help|\/(?:support|help))/.test(action) ? 'support'
        : /^(?:ref|\/ref)/.test(action) ? 'referrals'
        : /^(?:wheel|quest|checkin|wspin|qc:|\/wheel)/.test(action) ? 'rewards' : 'other';
      const ref = ctx.message?.text?.match(/^\/start(?:@\w+)? ref_(\S+)/)?.[1];
      await api.call(ctx.from, 'POST', '/internal/bot-activity', { updateId: ctx.update.update_id, category }, ref ? { 'x-ref-code': ref } : {}, 2000).catch(() => {});
    }
    return next();
  });

  // ---------- Обязательная подписка на канал: жёсткий барьер для всего ----------
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== 'private') return next();
    const giftPayload = ctx.message?.text?.match(/^\/start(?:@\w+)? gift_(VAYLO-[A-Fa-f0-9]{24})$/)?.[1];
    if (giftPayload) pendingGifts.set(ctx.from.id,{code:giftPayload.toUpperCase(),exp:Date.now()+30*60_000});
    for (const [id,gift] of pendingGifts) if(gift.exp<Date.now())pendingGifts.delete(id);
    if (ctx.callbackQuery?.data === 'gate:check') return next();
    if ((gateOk.get(ctx.from.id) ?? 0) > Date.now()) return next();
    const payload = ctx.message?.text?.startsWith('/start ') ? ctx.message.text.slice(7).trim() : '';
    const ref = payload.startsWith('ref_') ? payload.slice(4) : null;
    let g: GateDTO | null = null;
    try {
      g = await api.call<GateDTO>(ctx.from, 'GET', '/gate', undefined, ref ? { 'x-ref-code': ref } : {});
    } catch {
      return next(); // не блокируем из-за сбоя проверки
    }
    if (!g.required || g.ok) {
      gateOk.set(ctx.from.id, Date.now() + (o.gateCacheMs ?? 30_000));
      return next();
    }
    const need = g.chats.filter((c) => !c.joined);
    const kb = new InlineKeyboard();
    for (const c of need) if (c.url) kb.url(`📢 ${c.title}`, c.url).row();
    kb.text('✅ Я подписался', 'gate:check');
    if (ctx.callbackQuery) await ack(ctx, 'Сначала подпишитесь на канал', true);
    const text = `🔒 ${esc(g.text)}\n\nПосле подписки нажмите «Я подписался».`;
    try {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
      // Telegram отверг клавиатуру (например, некорректная ссылка на канал в настройках) — показываем без URL-кнопок
      console.error('[bot] gate: не удалось отправить кнопки канала', (e as Error).message);
      const list = need.map((c) => `📢 ${esc(c.title)}${c.url ? ` — ${esc(c.url)}` : ''}`).join('\n');
      await ctx
        .reply(`${text}${list ? '\n\n' + list : ''}`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('✅ Я подписался', 'gate:check'), link_preview_options: { is_disabled: true } })
        .catch((e2) => console.error('[bot] gate: fallback не отправлен', (e2 as Error).message));
    }
  });
  // любое нажатие кнопки завершает ожидание ввода (промокод, сумма, поиск, рассылка);
  // кнопки, которым нужен ввод, выставят ожидание заново
  bot.on('callback_query', (ctx, next) => {
    if (ctx.from) awaiting.delete(ctx.from.id);
    return next();
  });
  bot.callbackQuery('gate:check', (ctx) =>
    guard(ctx, async () => {
      const g = await api.call<GateDTO>(ctx.from!, 'POST', '/gate/check');
      if (g.ok) {
        gateOk.set(ctx.from!.id, Date.now() + (o.gateCacheMs ?? 30_000));
        await ack(ctx, 'Готово!');
        const gift = pendingGifts.get(ctx.from.id);
        if (gift && gift.exp>Date.now()) {pendingGifts.delete(ctx.from.id);await giftInvitation(ctx,gift.code);} else await showMenu(ctx);
      } else await ack(ctx, 'Подписка не найдена. Подпишитесь и нажмите снова.', true);
    }),
  );

  // ---------- Конкурсы ----------
  interface JoinDTO { ok: boolean; reason?: 'not_active' | 'need_channel' | 'already' | 'disabled' | 'not_eligible'; channelUrl?: string; contest?: { title: string; prize: string; endsAt: string } }
  const until = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' (МСК)';
  async function joinFlow(ctx: Context, code: string) {
    const r = await api.call<JoinDTO>(ctx.from!, 'POST', '/contests/join', { code });
    const t = r.contest ? `«${esc(r.contest.title)}»` : 'конкурсе';
    if (r.ok) {
      const when = r.contest ? `\nИтоги: ${until(r.contest.endsAt)}` : '';
      return void (await ctx.reply(`${r.reason === 'already' ? '✅ Вы уже участвуете в' : '🎉 Вы участвуете в'} ${t}!${when}\nПобедителей выберет бот случайно — результат придёт сюда.`, { parse_mode: 'HTML', reply_markup: menuRow() }));
    }
    if (r.reason === 'need_channel') {
      const kb = new InlineKeyboard();
      if (r.channelUrl) kb.url('📢 Подписаться на канал', r.channelUrl).row();
      kb.text('✅ Я подписался', `cj:${code}`);
      return void (await ctx.reply(`Чтобы участвовать в ${t}, подпишитесь на наш канал и нажмите «Я подписался».`, { parse_mode: 'HTML', reply_markup: kb }));
    }
    const msg = r.reason === 'not_active' ? 'Этот конкурс уже завершён или ещё не начался.' : r.reason === 'not_eligible' ? 'К сожалению, участие недоступно для этого аккаунта.' : 'Конкурсы сейчас отключены.';
    await ctx.reply(msg, { reply_markup: menuRow() });
  }
  async function showContests(ctx: Context) {
    const list = await api.call<{ code: string; title: string; prize: string; endsAt: string; entries: number }[]>(ctx.from!, 'GET', '/contests');
    if (!list.length) return void (await ctx.reply('Сейчас активных конкурсов нет. Следите за новостями в нашем канале.', { reply_markup: menuRow() }));
    for (const c of list.slice(0, 5)) {
      await ctx.reply(`🎁 <b>${esc(c.title)}</b>\n🏆 Приз: ${esc(c.prize)}\n⏰ Итоги: ${until(c.endsAt)}\n👥 Участников: ${c.entries}`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🎁 Участвовать', `cj:${c.code}`) });
    }
  }
  bot.command('closure', (ctx) => guard(ctx, () => showClosure(ctx)));
  bot.callbackQuery('closure', (ctx) => guard(ctx, async () => { await ack(ctx); await showClosure(ctx); }));
  bot.command('contests', (ctx) => guard(ctx, () => showContests(ctx)));
  bot.callbackQuery('contests', (ctx) => guard(ctx, async () => { await ack(ctx); await showContests(ctx); }));
  bot.callbackQuery(/^cj:([a-z0-9]{3,40})$/, (ctx) => guard(ctx, async () => { await ack(ctx); await joinFlow(ctx, ctx.match[1]!); }));

  bot.command('start', (ctx) =>
    guard(ctx, async () => {
      const payload = ctx.match?.toString().trim() ?? '';
      if (/^gift_VAYLO-[A-Fa-f0-9]{24}$/.test(payload)) {
        pendingGifts.delete(ctx.from!.id);
        await me(ctx);
        return giftInvitation(ctx,payload.slice(5).toUpperCase());
      }
      if (/^c_[a-z0-9]{3,40}$/.test(payload)) {
        await me(ctx);
        return joinFlow(ctx, payload.slice(2));
      }
      if (payload.startsWith('auth_')) {
        const token = payload.slice(5);
        if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return void (await ctx.reply('Ссылка для входа некорректна. Нажмите «Войти через Telegram» на сайте ещё раз.', { reply_markup: menuRow() }));
        let data = `al:${token}`;
        if (Buffer.byteLength(data) > CALLBACK_DATA_MAX) {
          const now = Date.now();
          for (const [k, v] of authTokens) if (v.exp < now) authTokens.delete(k);
          const id = (++authSeq).toString(36) + Math.random().toString(36).slice(2, 8);
          authTokens.set(id, { token, tgId: ctx.from!.id, exp: now + 10 * 60_000 });
          data = `alk:${id}`;
        }
        await ctx.reply(
          `🔐 <b>Вход на сайт ${esc(appHost)}</b> — это вы?\n\nЕсли вы не нажимали «Войти через Telegram» на сайте, просто проигнорируйте это сообщение.`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('✅ Подтвердить вход', data).row().text('Отмена', 'al_no'), link_preview_options: { is_disabled: true } },
        );
        return;
      }
      // регистрируем пользователя (и реферала) через любой запрос
      const ref = payload.startsWith('ref_') ? payload.slice(4) : null;
      await api.call(ctx.from!, 'GET', '/me', undefined, ref ? { 'x-ref-code': ref } : {});
      await showStart(ctx);
    }),
  );
  async function confirmLogin(ctx: Context, token: string | undefined) {
    await ack(ctx);
    const done = (text: string) => ctx.editMessageText(text, { parse_mode: 'HTML' }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
    if (!token) return void (await done('Ссылка для входа устарела. Нажмите «Войти через Telegram» на сайте ещё раз.'));
    await api.call(ctx.from!, 'POST', '/internal/tglink/confirm', { token });
    await done('✅ <b>Вход выполнен.</b> Вернитесь на сайт — страница обновится автоматически.');
  }
  bot.callbackQuery(/^al:(.+)$/, (ctx) => guard(ctx, () => confirmLogin(ctx, ctx.match[1])));
  bot.callbackQuery(/^alk:(.+)$/, (ctx) =>
    guard(ctx, async () => {
      const t = authTokens.get(ctx.match[1]!);
      const ok = t && t.exp > Date.now() && t.tgId === ctx.from!.id;
      if (t) authTokens.delete(ctx.match[1]!);
      await confirmLogin(ctx, ok ? t.token : undefined);
    }),
  );
  bot.callbackQuery('al_no', (ctx) =>
    guard(ctx, async () => {
      await ack(ctx);
      await ctx.editMessageText('Вход отменён. Если это были не вы — ничего делать не нужно.').catch(() => ctx.reply('Вход отменён.'));
    }),
  );
  bot.command('devices', (ctx) => guard(ctx, () => showDevices(ctx)));
  bot.callbackQuery('devices', (ctx) => guard(ctx, async () => { await ack(ctx); await showDevices(ctx, true); }));
  bot.callbackQuery(/^dvx:([0-9a-f]{16})$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    const d = await api.call<DevicesDTO>(ctx.from!, 'GET', '/devices');
    const v = d.devices.find((x) => x.id === ctx.match[1]);
    if (!v) return void (await showDevices(ctx, true, 'ℹ️ Это устройство уже удалено.'));
    await ctx.editMessageText(`Удалить устройство <b>${esc(v.name)}</b>?\nОно освободит место и потеряет доступ, пока его не подключат снова.`, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('🗑 Да, удалить', `dvy:${v.id}`).row().text('↩️ Отмена', 'devices'),
    });
  }));
  bot.callbackQuery(/^dvy:([0-9a-f]{16})$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    try {
      await api.call<DevicesDTO>(ctx.from!, 'POST', '/devices/delete', { id: ctx.match[1] });
      await showDevices(ctx, true, '✅ Устройство удалено.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return void (await showDevices(ctx, true, 'ℹ️ Это устройство уже удалено.'));
      throw e;
    }
  }));
  bot.callbackQuery('dvall', (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await ctx.editMessageText('Удалить <b>все</b> устройства? Их придётся подключить заново.', {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('🗑 Да, удалить все', 'dvally').row().text('↩️ Отмена', 'devices'),
    });
  }));
  bot.callbackQuery('dvally', (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await api.call<DevicesDTO>(ctx.from!, 'POST', '/devices/delete-all');
    await showDevices(ctx, true, '✅ Все устройства удалены.');
  }));
  bot.command('menu', (ctx) => guard(ctx, () => showMenu(ctx)));
  bot.command('status', (ctx) => guard(ctx, () => showServerStatus(ctx)));
  bot.callbackQuery('status', (ctx) => guard(ctx, async () => { await ack(ctx); await showServerStatus(ctx, true); }));
  bot.command('buy', (ctx) => guard(ctx, () => showPlans(ctx)));
  bot.command('connect', (ctx) => guard(ctx, () => showConnect(ctx)));
  bot.command('help', (ctx) => ctx.reply('Команды:\n/start — меню\n/buy — тарифы\n/connect — ссылка подписки\n/status — статус серверов\n/devices — мои устройства\n/support — поддержка\n/contests — конкурсы\n/closure — о закрытии проекта'));
  bot.command('support', (ctx) => guard(ctx, () => support(ctx)));

  async function support(ctx: Context) {
    const cfg = await getConfig(ctx);
    const kb = new InlineKeyboard();
    if (cfg.supportInApp) {
      kb.webApp('💬 Открыть поддержку', o.appUrl.replace(/\/$/, '') + '/support').row().text('⬅️ Меню', 'menu');
      await ctx.reply('💬 <b>Поддержка</b>\n\nИИ-помощник ответит сразу, а для сложных случаев можно создать обращение — ответит человек 🙌', { parse_mode: 'HTML', reply_markup: kb });
      return;
    }
    if (cfg.supportUrl && /^https?:\/\//.test(cfg.supportUrl)) kb.url('💬 Написать в поддержку', cfg.supportUrl).row();
    kb.text('⬅️ Меню', 'menu');
    await ctx.reply(cfg.supportUrl && !/^https?:\/\//.test(cfg.supportUrl) ? `💬 Поддержка: ${esc(cfg.supportUrl)}` : '💬 Мы на связи — напишите нам:', { parse_mode: 'HTML', reply_markup: kb });
  }

  bot.callbackQuery('menu', (ctx) => guard(ctx, async () => { pendingBc.delete(ctx.from.id); await ack(ctx); await showMenu(ctx, true); }));
  bot.callbackQuery('connect', (ctx) => guard(ctx, async () => { await ack(ctx); await showConnect(ctx); }));
  bot.callbackQuery('plans', (ctx) => guard(ctx, async () => { await ack(ctx); await showPlans(ctx); }));
  bot.callbackQuery('ref', (ctx) => guard(ctx, async () => { await ack(ctx); await showRef(ctx); }));
  bot.callbackQuery('support', (ctx) => guard(ctx, async () => { await ack(ctx); await support(ctx); }));
  bot.callbackQuery('trial', (ctx) =>
    guard(ctx, async () => {
      await ack(ctx);
      await api.call(ctx.from!, 'POST', '/subscription/trial');
      await ctx.reply('🎉 <b>Пробный период активирован!</b> Теперь подключите устройство 👇', { parse_mode: 'HTML' });
      await showConnect(ctx);
    }),
  );
  bot.callbackQuery('promo', (ctx) =>
    guard(ctx, async () => {
      await ack(ctx);
      await_(ctx.from!.id, 'promo');
      await ctx.reply('🎟 Отправьте промокод одним сообщением:', { reply_markup: new InlineKeyboard().text('Отмена', 'menu') });
    }),
  );
  bot.callbackQuery(/^plan:(.+)$/, (ctx) => guard(ctx, async () => { await ack(ctx); await showMethods(ctx, ctx.match[1]!); }));
  bot.callbackQuery(/^pay:([^:]+):(.+)$/, (ctx) => guard(ctx, async () => { await ack(ctx); await pay(ctx, ctx.match[1]!, ctx.match[2]!); }));

  bot.callbackQuery('wallet', (ctx) => guard(ctx, async () => { await ack(ctx); await showWallet(ctx); }));
  bot.callbackQuery('addons', (ctx) => guard(ctx, async () => { await ack(ctx); await showAddons(ctx); }));
  bot.callbackQuery('quests', (ctx) => guard(ctx, async () => { await ack(ctx); await showQuests(ctx); }));
  bot.callbackQuery('admin', (ctx) => guard(ctx, async () => { pendingBc.delete(ctx.from.id); await ack(ctx); await showAdmin(ctx); }));
  bot.callbackQuery(/^tp:(\d+)$/, (ctx) => guard(ctx, async () => { await ack(ctx); await showTopupMethods(ctx, Number(ctx.match[1])); }));
  bot.callbackQuery('tpc', (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await_(ctx.from!.id, 'topup');
    const cfg = await getConfig(ctx);
    await ctx.reply(`✏️ Введите сумму пополнения в рублях (от ${formatRub(cfg.topup?.min ?? 10000)} до ${formatRub(cfg.topup?.max ?? 10_000_000)}):`, { reply_markup: new InlineKeyboard().text('Отмена', 'wallet') });
  }));
  bot.callbackQuery(/^tpm:(\d+):(\d+)$/, (ctx) => guard(ctx, async () => { await ack(ctx); await topupWith(ctx, Number(ctx.match[1]), Number(ctx.match[2])); }));
  bot.callbackQuery(/^ar:([01])$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    const on = ctx.match[1] === '1';
    await api.call(ctx.from!, 'POST', '/subscription/auto-renew', { enabled: on });
    await showWallet(ctx, on ? '✅ Автопродление включено.' : '✅ Автопродление выключено.');
  }));
  bot.callbackQuery(/^ad:(.+)$/, (ctx) => guard(ctx, async () => { await ack(ctx); await showBuy(ctx, 'a', ctx.match[1]!); }));
  bot.callbackQuery(/^adb:(.+)$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await purchase(ctx, { addonId: ctx.match[1], method: 'balance' });
    await ctx.reply('✅ Докупка применена! Изменения уже действуют, переподключаться не нужно.', { reply_markup: new InlineKeyboard().text('➕ Ещё докупки', 'addons').text('⬅️ Меню', 'menu') });
  }));
  bot.callbackQuery(/^c([pa]):([^:]+):(\d+)$/, (ctx) => guard(ctx, async () => { await ack(ctx); await cart(ctx, ctx.match[1] as 'p' | 'a', ctx.match[2]!, Number(ctx.match[3])); }));
  bot.callbackQuery(/^qc:(.+)$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    const r = await api.call<{ rewardType: 'days' | 'balance'; rewardValue: number; streak?: number }>(ctx.from!, 'POST', `/quests/${ctx.match[1]}/claim`);
    await showQuests(ctx, `🎁 Награда получена: ${r.rewardType === 'days' ? `+${r.rewardValue} ${pluralDays(r.rewardValue)} подписки` : `+${formatRub(r.rewardValue)} на баланс`}`);
  }));

  // админ
  bot.callbackQuery('ad_net', (ctx) => guard(ctx, async () => { await ack(ctx); await adminNetwork(ctx); }));
  bot.callbackQuery('ad_wd', (ctx) => guard(ctx, async () => { await ack(ctx); await adminWithdrawals(ctx); }));
  bot.callbackQuery(/^wd([pr]):([0-9a-f-]{36})$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    const paid = ctx.match[1] === 'p';
    await adm(ctx, 'POST', `/withdrawals/${ctx.match[2]}/${paid ? 'paid' : 'reject'}`, paid ? {} : { note: 'Заявка отклонена администратором' });
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
    await ctx.reply(paid ? '✅ Отмечено как выплаченное, пользователь уведомлён.' : '❌ Заявка отклонена, деньги вернулись на реферальный счёт.');
  }));
  bot.callbackQuery(/^refmode:(days|balance)$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await api.call(ctx.from!, 'POST', '/referrals/mode', { mode: ctx.match[1] });
    await showRef(ctx, ctx.match[1] === 'balance' ? '✅ Теперь вы получаете деньги с оплат друзей.' : '✅ Теперь вы получаете бесплатные дни за друзей.');
  }));
  bot.callbackQuery('refmove', (ctx) => guard(ctx, async () => {
    await ack(ctx);
    const r = await api.call<{ moved: number; bonus: number }>(ctx.from!, 'POST', '/referrals/transfer', {});
    await showRef(ctx, `✅ На баланс зачислено ${formatRub(r.moved + r.bonus)}${r.bonus ? ` (включая бонус ${formatRub(r.bonus)})` : ''}.`);
  }));
  bot.callbackQuery('ad_rf', (ctx) => guard(ctx, async () => { await ack(ctx); await adminRefFeed(ctx); }));
  bot.callbackQuery(/^arf:([0-9a-f-]{36})$/, (ctx) => guard(ctx, async () => { await ack(ctx); await adminRefTree(ctx, ctx.match[1]!); }));
  bot.callbackQuery('wheel', (ctx) => guard(ctx, async () => { await ack(ctx); await showWheel(ctx); }));
  bot.callbackQuery('wspin', (ctx) => guard(ctx, async () => { await ack(ctx); await spinWheelBot(ctx); }));
  bot.command('wheel', (ctx) => guard(ctx, () => showWheel(ctx)));
  bot.callbackQuery('ad_act', (ctx) => guard(ctx, async () => { await ack(ctx); await adminActivity(ctx); }));
  bot.callbackQuery('ad_stats', (ctx) => guard(ctx, async () => { await ack(ctx); await adminStats(ctx); }));
  bot.callbackQuery('ad_mon', (ctx) => guard(ctx, async () => { await ack(ctx); await adminMonitoring(ctx); }));
  bot.callbackQuery('ad_monrun', (ctx) => guard(ctx, async () => { await ack(ctx); await adminMonitoring(ctx, true); }));
  bot.callbackQuery('ad_find', (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    await_(ctx.from!.id, 'find');
    await ctx.reply('🔎 Отправьте @username, Telegram ID или имя пользователя:', { reply_markup: new InlineKeyboard().text('Отмена', 'admin') });
  }));
  bot.callbackQuery('ad_bc', (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    await_(ctx.from!.id, 'bc');
    await ctx.reply('📣 Отправьте текст рассылки одним сообщением (поддерживается HTML-разметка Telegram):', { reply_markup: new InlineKeyboard().text('Отмена', 'admin') });
  }));
  bot.callbackQuery(/^bcg:(\w+)$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    const text = pendingBc.get(ctx.from!.id);
    if (!text) return void (await ctx.reply('Текст рассылки потерян — начните заново.', { reply_markup: new InlineKeyboard().text('📣 Рассылка', 'ad_bc') }));
    pendingBc.delete(ctx.from!.id);
    await adm(ctx, 'POST', '/broadcasts', { text, segment: ctx.match[1] });
    await ctx.reply('✅ Рассылка поставлена в очередь. Прогресс виден в веб-админке.', { reply_markup: new InlineKeyboard().text('⬅️ Назад', 'admin') });
  }));
  bot.callbackQuery(/^ad_mt:([01])$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    await adm(ctx, 'POST', '/maintenance', { enabled: ctx.match[1] === '1' });
    await showAdmin(ctx);
  }));
  bot.callbackQuery(/^au:(.+)$/, (ctx) => guard(ctx, async () => { await ack(ctx); await adminUserCard(ctx, ctx.match[1]!); }));
  bot.callbackQuery(/^ax:([^:]+):(\d+)$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    await adm(ctx, 'POST', `/users/${ctx.match[1]}/extend`, { days: Number(ctx.match[2]) });
    await adminUserCard(ctx, ctx.match[1]!, `✅ Выдано +${ctx.match[2]} дн.`);
  }));
  bot.callbackQuery(/^abal:([^:]+):(\d+)$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    await adm(ctx, 'POST', `/users/${ctx.match[1]}/balance`, { amount: Number(ctx.match[2]), note: 'Начислено из бота' });
    await adminUserCard(ctx, ctx.match[1]!, `✅ Баланс пополнен на ${formatRub(Number(ctx.match[2]))}`);
  }));
  bot.callbackQuery(/^ab:([^:]+):([01])$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    await adm(ctx, 'POST', `/users/${ctx.match[1]}/ban`, { banned: ctx.match[2] === '1' });
    await adminUserCard(ctx, ctx.match[1]!, ctx.match[2] === '1' ? '🚫 Пользователь заблокирован' : '✅ Пользователь разблокирован');
  }));
  bot.callbackQuery(/^arl:(.+)$/, (ctx) => guard(ctx, async () => {
    await ack(ctx);
    await needAdmin(ctx);
    await adm(ctx, 'POST', `/users/${ctx.match[1]}/reset-link`);
    await ctx.reply('🔗 Ссылка подписки сброшена — пользователю нужно добавить новую ссылку в приложение.', { reply_markup: new InlineKeyboard().text('👤 К пользователю', `au:${ctx.match[1]}`).text('⬅️ Назад', 'admin') });
  }));

  bot.command('balance', (ctx) => guard(ctx, () => showWallet(ctx)));
  bot.command('quests', (ctx) => guard(ctx, () => showQuests(ctx)));
  bot.command('admin', (ctx) => guard(ctx, () => showAdmin(ctx)));

  bot.on('message:text', (ctx) =>
    guard(ctx, async () => {
      const w = awaiting.get(ctx.from.id);
      const text = ctx.message.text.trim();
      if (w && w.exp > Date.now() && !text.startsWith('/')) {
        awaiting.delete(ctx.from.id);
        if (w.kind === 'promo') {
          if (text.length > PROMO_MAX_LENGTH) {
            await_(ctx.from.id, 'promo');
            return void (await ctx.reply(`Промокод слишком длинный — не больше ${PROMO_MAX_LENGTH} символов. Отправьте промокод ещё раз:`, { reply_markup: new InlineKeyboard().text('Отмена', 'menu') }));
          }
          const r = await api.call<{ type: 'days' | 'balance'; value: number }>(ctx.from, 'POST', '/promo/redeem', { code: text });
          await ctx.reply(r.type === 'days' ? `✅ Промокод активирован: +${r.value} ${pluralDays(r.value)} подписки.` : `✅ Промокод активирован: +${formatRub(r.value)} на баланс.`, { reply_markup: menuRow() });
        } else if (w.kind === 'topup') {
          const cfg = await getConfig(ctx);
          const min = cfg.topup?.min ?? 10000;
          const max = Math.min(cfg.topup?.max ?? MAX_TOPUP_KOPECKS, MAX_TOPUP_KOPECKS);
          const cleaned = text.replace(/\s/g, '').replace(',', '.').replace(/(руб\.?|р\.?|₽)$/i, '');
          const rub = /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : NaN;
          const kop = Math.round(rub * 100);
          const retry = new InlineKeyboard().text('Отмена', 'wallet');
          if (!Number.isFinite(rub) || rub <= 0) {
            await_(ctx.from.id, 'topup');
            return void (await ctx.reply('Введите сумму числом, например 500', { reply_markup: retry }));
          }
          if (kop < min || kop > max) {
            await_(ctx.from.id, 'topup');
            return void (await ctx.reply(`Сумма должна быть от ${formatRub(min)} до ${formatRub(max)}. Введите другую сумму:`, { reply_markup: retry }));
          }
          await showTopupMethods(ctx, kop);
        } else if (w.kind === 'find') {
          await adminFind(ctx, text.replace(/^@/, ''));
        } else if (w.kind === 'bc') {
          await needAdmin(ctx);
          pendingBc.set(ctx.from.id, text);
          const kb = new InlineKeyboard()
            .text('Всем', 'bcg:all').text('С подпиской', 'bcg:active').row()
            .text('Истёкшие', 'bcg:expired').text('Без подписки', 'bcg:no_sub').row()
            .text('Отмена', 'admin');
          try {
            await ctx.reply(`📣 Предпросмотр:\n\n${text}\n\nКому отправить?`, { parse_mode: 'HTML', reply_markup: kb });
          } catch (e) {
            if (!isParseEntitiesError(e)) throw e;
            pendingBc.delete(ctx.from.id);
            await_(ctx.from.id, 'bc');
            await ctx.reply(
              '⚠️ Telegram не смог разобрать HTML-разметку в тексте. Проверьте, что все теги закрыты (например, <b>…</b>) и поддерживаются Telegram (b, i, u, s, a, code, pre, blockquote). Если нужен символ «<» или «&» как обычный текст — пишите &lt; и &amp;.\n\nОтправьте исправленный текст рассылки:',
              { reply_markup: new InlineKeyboard().text('Отмена', 'admin') },
            );
          }
        }
        return;
      }
      await showMenu(ctx);
    }),
  );

  bot.catch((e) => console.error('[bot] unhandled', e.error));
  return bot;
}
