import { z } from 'zod';
import { DESIGN_CONCEPT_IDS, MINIAPP_DESIGN_IDS } from '@vpn/shared';
import { sql } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { log } from '../lib/log.js';

/** Строгий UUID (как z.uuid() в zod 4 у панели Remnawave). Дублируется здесь, чтобы не было циклического импорта. */
const UUID_RE = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/;

export const MASK = '********';

const generalSchema = z.object({
  brand_name: z.string().min(1).max(40).default('VPN'),
  support_url: z.string().max(300).default(''),
  channel_url: z.string().max(300).default(''),
  terms_url: z.string().max(300).default(''),
  maintenance: z.boolean().default(false),
  maintenance_text: z.string().max(300).default('Идут технические работы. Скоро всё заработает.'),
  welcome_text: z.string().max(600).default(''),
  support_username: z.string().max(64).default(''),
  currency_note: z.string().max(100).default(''),
});
const trialSchema = z.object({
  enabled: z.boolean().default(true),
  days: z.number().int().min(1).max(365).default(3),
  traffic_gb: z.number().int().min(0).max(100000).default(5),
  device_limit: z.number().int().min(0).max(100).default(1),
  require_channel: z.boolean().default(false),
});
const referralSchema = z.object({
  /** награда 1 уровня за первую оплату друга */
  days: z.number().int().min(0).max(365).default(7),
  percent: z.number().int().min(0).max(100).default(20),
  /** пользователь сам выбирает награду: дни подписки ИЛИ деньги на реферальный счёт. Выключено — начисляются и дни, и деньги на основной баланс (как раньше) */
  choice_enabled: z.boolean().default(true),
  /** процент с каждой следующей оплаты друга (а не только первой) */
  recurring: z.boolean().default(false),
  /** процент 2 уровня (друзья друзей) */
  level2_percent: z.number().int().min(0).max(100).default(0),
  /** бонусные дни 2 уровня за первую оплату друга друга (режим «дни»), 0 — не начислять */
  level2_days: z.number().int().min(0).max(365).default(0),
  /** бонус на баланс (коп.) сразу при регистрации: приглашённому и пригласившему */
  signup_bonus_invitee: z.number().int().min(0).max(10_000_00).default(0),
  signup_bonus_referrer: z.number().int().min(0).max(10_000_00).default(0),
  enabled: z.boolean().default(true),
});
const DEFAULT_DESCRIPTION = `🔒 Ваш надёжный помощник для безопасного и анонимного интернета.

✨ Что мы предлагаем:
• ⚡ Высокая скорость без ограничений по трафику
• 🚫 Полное отсутствие рекламы
• 🛡 Защита данных и конфиденциальности
• 💰 Доступные цены
• 🆓 Бесплатный тестовый период
• 🌍 Работает по всему миру

🎯 Подключение нескольких устройств одновременно!

👉 Нажмите «Запустить бота»`;
const botWelcomeSchema = z.object({
  /** Текст «Что умеет этот бот?» до нажатия Start (Telegram: до 512 символов) */
  description: z.string().max(512).default(DEFAULT_DESCRIPTION),
  /** Короткое описание в профиле бота (до 120 символов) */
  short_description: z.string().max(120).default('Быстрый и безопасный VPN. Бесплатный тест!'),
  /** Приветствие после /start (с картинкой, если она загружена). Пусто — стандартное меню. Можно {brand} и {name} */
  start_text: z.string().max(900).default('Добро пожаловать в {brand}, {name}!\n\nВаш интернет. Ваши правила.\n\nОткройте кабинет, выберите тариф или подключите устройство.'),
});
const withdrawSchema = z.object({
  enabled: z.boolean().default(true),
  /** минимальная сумма вывода, копейки */
  min: z.number().int().min(100).max(100_000_00).default(500_00),
  /** комиссия вывода, % */
  fee_percent: z.number().int().min(0).max(50).default(0),
  /** бонус при переводе реферального счёта на основной баланс (для оплаты подписки), % */
  transfer_bonus_percent: z.number().int().min(0).max(100).default(10),
  /** какие способы выплаты вы поддерживаете — показывается пользователю при выводе */
  methods: z.string().max(200).default('Банковская карта РФ, СБП, USDT (TRC20)'),
});
const gateSchema = z.object({
  enabled: z.boolean().default(false),
  /** soft — канал только предлагается (бонус/пробный период), вход в бота не блокируется; hard — без подписки ничего не работает */
  mode: z.enum(['soft', 'hard']).default('soft'),
  /** @username или числовой id канала/чата; бот должен быть администратором */
  chats: z
    .array(
      z.object({
        chat: z.string().trim().min(2, 'Укажите @username или ID канала').max(64),
        title: z.string().max(60).default(''),
        url: z
          .string()
          .trim()
          .max(200)
          .refine((v) => v === '' || /^(https?|tg):\/\/\S+$/i.test(v), 'Ссылка на канал должна начинаться с https://, http:// или tg://')
          .default(''),
      }),
    )
    .max(5)
    .default([]),
  text: z.string().max(400).default('Чтобы пользоваться сервисом, подпишитесь на наш канал.'),
});
const topupSchema = z.object({
  min: z.number().int().min(100_00 / 10).max(10_000_000).default(100_00),
  max: z.number().int().min(100_00).max(100_000_000).default(10_000_000),
  presets: z.array(z.number().int().min(1000).max(10_000_000)).max(8).default([10000, 30000, 50000, 100000]),
  /** бонус к пополнению: [{from: копейки, percent}] */
  bonuses: z.array(z.object({ from: z.number().int().min(100), percent: z.number().int().min(1).max(100) })).max(6).default([]),
});
const questsSchema = z.object({
  enabled: z.boolean().default(true),
  /** надбавка к ежедневному бонусу за каждый день серии (коп.), максимум 7 дней */
  streak_step: z.number().int().min(0).max(100_00).default(100),
  /** достижения с бонусными днями за выполнение заданий */
  achievements: z.boolean().default(true),
});
const supportSchema = z.object({
  /** раздел «Поддержка» в приложении и боте (чат и тикеты); выключено — старая ссылка на аккаунт поддержки */
  enabled: z.boolean().default(true),
  /** ИИ-помощник отвечает в чатах. Выключено — все обращения идут людям */
  ai_enabled: z.boolean().default(false),
  /** адрес API, совместимого с OpenAI (…/v1), например https://openrouter.ai/api/v1 */
  ai_base_url: z.string().max(200).default(''),
  ai_model: z.string().max(100).default(''),
  ai_key: z.string().max(300).default(''),
  /** запасной провайдер: включается, если основной не ответил (лимит бесплатного тарифа, сбой) */
  ai_fallback_base_url: z.string().max(200).default(''),
  ai_fallback_model: z.string().max(100).default(''),
  ai_fallback_key: z.string().max(300).default(''),
  ai_max_tokens: z.number().int().min(100).max(1500).default(450),
  /** сообщений к ИИ в сутки от одного человека / всего за сутки (защита от расходов и спама) */
  ai_daily_limit: z.number().int().min(1).max(500).default(30),
  ai_global_limit: z.number().int().min(10).max(100_000).default(2000),
  /** дополнительные знания о сервисе: известные проблемы, правила, нюансы — ИИ учитывает их в ответах */
  knowledge: z.string().max(6000).default(''),
  filter_profanity: z.boolean().default(true),
  auto_escalate: z.boolean().default(true),
  /** на сколько минут блокировать чат после 3 нарушений (мат, попытки обойти бота) */
  mute_minutes: z.number().int().min(1).max(1440).default(15),
  notify_admins: z.boolean().default(true),
});
const wheelPrize = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,24}$/),
  label: z.string().min(1).max(24),
  type: z.enum(['days', 'balance']),
  /** days — дни; balance — копейки */
  value: z.number().int().min(1).max(100_000),
  weight: z.number().int().min(1).max(1000),
});
const wheelSchema = z.object({
  enabled: z.boolean().default(true),
  prizes: z
    .array(wheelPrize)
    .min(2)
    .max(12)
    .default([
      { id: 'd1', label: '+1 день', type: 'days', value: 1, weight: 30 },
      { id: 'b3', label: '+3 ₽', type: 'balance', value: 300, weight: 26 },
      { id: 'd2', label: '+2 дня', type: 'days', value: 2, weight: 18 },
      { id: 'b5', label: '+5 ₽', type: 'balance', value: 500, weight: 14 },
      { id: 'd3', label: '+3 дня', type: 'days', value: 3, weight: 7 },
      { id: 'b10', label: '+10 ₽', type: 'balance', value: 1000, weight: 3 },
      { id: 'd7', label: '+7 дней', type: 'days', value: 7, weight: 1 },
      { id: 'b30', label: '+30 ₽', type: 'balance', value: 3000, weight: 1 },
    ]),
});
const addonsSchema = z.object({
  enabled: z.boolean().default(true),
  auto_renew_enabled: z.boolean().default(true),
});
const monitoringSchema = z.object({
  interval_seconds: z.number().int().min(60).max(3600).default(60),
  enabled: z.boolean().default(true),
  /** админы получают уведомления в Telegram (по tg_id из раздела администраторов) */
  alerts: z.boolean().default(true),
  extra_chat_id: z.string().max(40).default(''),
  /** после стольких подряд неудач проверка считается упавшей */
  fail_threshold: z.number().int().min(1).max(10).default(2),
  /** автоматически включать техработы, когда Remnawave недоступна */
  auto_maintenance: z.boolean().default(false),
});
const appearanceSchema = z.object({
  miniapp_design: z.enum(MINIAPP_DESIGN_IDS).default('orbit-signature'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  logo_url: z.string().max(300).default(''),
  banner_text: z.string().max(200).default(''),
  design_shortlist: z.array(z.enum(DESIGN_CONCEPT_IDS)).max(6).refine(ids=>new Set(ids).size===ids.length,'Выберите каждый дизайн только один раз').default([]),
});
const yookassaSchema = z.object({
  enabled: z.boolean().default(false),
  shop_id: z.string().max(64).default(''),
  secret_key: z.string().max(200).default(''),
  send_receipt: z.boolean().default(false),
  receipt_email: z.string().max(200).default(''),
  vat_code: z.number().int().min(1).max(6).default(1),
});
const plategaSchema = z.object({
  enabled: z.boolean().default(false),
  merchant_id: z.string().max(100).default(''),
  secret: z.string().max(300).default(''),
  methods: z.array(z.enum(['sbp', 'cards_rub', 'card_acquiring', 'international', 'crypto'])).default(['sbp', 'card_acquiring']),
});
const rollypaySchema = z.object({
  enabled: z.boolean().default(false),
  /** API-ключ кассы (заголовок X-API-Key), вида rpk_live_… */
  api_key: z.string().max(300).default(''),
  /** Terminal ID кассы (раздел «Интеграция» в кабинете RollyPay) */
  terminal_id: z.string().max(100).default(''),
  /** signing_secret кассы — для проверки подписи callback */
  signing_secret: z.string().max(300).default(''),
  /** тестовые платежи (в запрос уходит test: true) */
  test_mode: z.boolean().default(false),
  /** адрес API, если RollyPay выдала другой; по умолчанию https://api.rollypay.io/api/v1 */
  api_base: z.string().max(200).default(''),
  methods: z.array(z.enum(['any', 'sbp', 'card', 'crypto'])).min(1).default(['any']),
});
const nodeipSchema = z.object({
  enabled: z.boolean().default(true),
  /** заодно заменять старый IP в хостах Remnawave */
  update_hosts: z.boolean().default(true),
  /** перезапускать ноду после смены адреса */
  restart_node: z.boolean().default(false),
  cloudflare_token: z.string().max(300).default(''),
  cloudflare_zone_id: z.string().max(64).default(''),
});
const remnawaveSchema = z.object({
  url: z.string().max(300).default(''),
  token: z.string().max(2000).default(''),
  /** '' — выбрать автоматически (сквад «Default» или первый в панели) */
  squad_uuid: z
    .string()
    .trim()
    .max(64)
    .refine((v) => v === '' || UUID_RE.test(v), 'UUID сквада указан неверно: скопируйте его из панели Remnawave (формат xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) или оставьте поле пустым')
    .default(''),
});

const adminNotificationsSchema = z.object({
  payments_enabled: z.boolean().default(true),
  balance_purchases_enabled: z.boolean().default(true),
  daily_enabled: z.boolean().default(true),
  daily_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время ЧЧ:ММ').default('09:00'),
  timezone: z.string().max(80).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Неизвестный часовой пояс').default('Europe/Moscow'),
  extra_chat_id: z.string().trim().refine(v => v === '' || /^-?[1-9]\d{0,14}$/.test(v), 'Укажите числовой Telegram ID').default(''),
});

const clientAppsSchema = z.object({entries:z.array(z.object({
  id:z.enum(['happ','incy','karing','hiddify','streisand']),os:z.enum(['ios','android','windows','macos','linux']),
  status:z.enum(['unknown','available','regional','removed']).default('unknown'),recommended:z.boolean().default(false),note:z.string().trim().max(300).default('')
})).max(25).default([])}).superRefine((v,ctx)=>{
 const keys=new Set<string>();for(const e of v.entries){const k=e.os+':'+e.id;if(keys.has(k))ctx.addIssue({code:'custom',message:'Приложение для этой платформы уже добавлено'});keys.add(k);if(e.status==='removed'&&e.recommended)ctx.addIssue({code:'custom',message:'Недоступное приложение нельзя рекомендовать для установки'});}
});
const netprobeSchema = z.object({
  /** клиентские проверки из Mini App (оператор определяется по IP, сам IP не сохраняется) */
  enabled: z.boolean().default(true),
  /** минимум замеров за 30 минут, чтобы считать проблему реальной */
  min_samples: z.number().int().min(2).max(100).default(5),
  /** ниже какого процента успешных замеров поднимать тревогу */
  alert_below_pct: z.number().int().min(5).max(90).default(40),
});
const autodiscountSchema = z.object({
  /** автоматические скидки на продление: управляют «акциями» на основе состояния подписки, цены считает существующий механизм акций */
  enabled: z.boolean().default(false),
  /** скидка тем, у кого подписка скоро закончится */
  expiring_pct: z.number().int().min(0).max(90).default(10),
  expiring_days: z.number().int().min(1).max(30).default(5),
  /** скидка тем, кто не продлил после окончания (win-back) */
  expired_pct: z.number().int().min(0).max(90).default(20),
  expired_days: z.number().int().min(1).max(90).default(14),
});
const contestsSchema = z.object({
  enabled: z.boolean().default(false),
  /** канал для постов: @username или -100… (бот должен быть админом). Пусто — первый канал из «Обязательной подписки» */
  channel: z.string().trim().max(100).default(''),
  publish_results: z.boolean().default(true),
});
const closureSchema = z.object({
  /** проект закрывается: продажи и регистрация закрыты, таймер идёт */
  active: z.boolean().default(false),
  announced_at: z.string().max(40).default(''),
  /** итоговая дата закрытия (ISO). Считается как конец подписки последнего оплатившего через ЮKassa или задаётся вручную */
  ends_at: z.string().max(40).default(''),
  ends_mode: z.enum(['auto', 'manual']).default('auto'),
  /** пользователи, которых пропускаем при поиске последнего оплатившего */
  skip_user_ids: z.array(z.string().uuid()).max(100).default([]),
  reason: z.string().max(1200).default('😔 Нам очень тяжело об этом писать…\n\nПроект оказался слишком затратным: серверы, поддержка и разработка стоят дорого, а доходов не хватает, чтобы покрывать расходы 📉 Он не приносит прибыли и не окупается, а конкуренция на рынке огромная 🥀\n\nМы долго пытались его спасти, но, к сожалению, вынуждены принять решение о закрытии 💔\n\nСпасибо, что были с нами 🕊'),
  alt_text: z.string().max(600).default(''),
  alt_url: z.string().max(300).default(''),
  remind_days: z.array(z.number().int().min(1).max(60)).max(8).default([14, 7, 3, 1]),
  farewell: z.boolean().default(true),
});
const funnelSchema = z.object({
  /** воронка сообщений в боте: старт → пробный период → оплата */
  enabled: z.boolean().default(false),
  start_nudge_hours: z.number().int().min(1).max(72).default(2),
  trial_tips: z.boolean().default(true),
  trial_ended_offer: z.boolean().default(true),
});

const statuspageSchema = z.object({
  /** страница «Статус серверов» в боте и автоматические оповещения о простоях */
  enabled: z.boolean().default(true),
  /** рассылать пользователям, когда сервер недоступен */
  notify_users: z.boolean().default(true),
  /** кому: all — всем, кто писал боту; active — только с действующей подпиской. Для серверов с выбранными тарифами — только владельцы этих тарифов */
  notify_audience: z.enum(['all', 'active']).default('all'),
  /** сколько минут сервер должен быть недоступен, прежде чем разослать оповещение (защита от «морганий») */
  notify_after_minutes: z.number().int().min(1).max(120).default(3),
  notify_recovery: z.boolean().default(true),
  /** автоматически продлять подписки, если простой затянулся */
  compensate: z.boolean().default(true),
  compensate_after_hours: z.number().int().min(1).max(72).default(5),
  compensate_days: z.number().int().min(1).max(30).default(1),
  /** подпись раздела LTE в статусе, например «LTE для белых списков (только в тарифе PURPLE)» */
  lte_note: z.string().max(160).default('LTE для белых списков'),
});
export const GROUPS = {
  client_apps:{schema:clientAppsSchema,secrets:[] as string[]},
  admin_notifications: { schema: adminNotificationsSchema, secrets: [] as string[] },
  general: { schema: generalSchema, secrets: [] as string[] },
  trial: { schema: trialSchema, secrets: [] as string[] },
  referral: { schema: referralSchema, secrets: [] as string[] },
  bot_welcome: { schema: botWelcomeSchema, secrets: [] as string[] },
  withdraw: { schema: withdrawSchema, secrets: [] as string[] },
  gate: { schema: gateSchema, secrets: [] as string[] },
  topup: { schema: topupSchema, secrets: [] as string[] },
  quests: { schema: questsSchema, secrets: [] as string[] },
  statuspage: { schema: statuspageSchema, secrets: [] as string[] },
  autodiscount: { schema: autodiscountSchema, secrets: [] as string[] },
  funnel: { schema: funnelSchema, secrets: [] as string[] },
  closure: { schema: closureSchema, secrets: [] as string[] },
  contests: { schema: contestsSchema, secrets: [] as string[] },
  netprobe: { schema: netprobeSchema, secrets: [] as string[] },
  support: { schema: supportSchema, secrets: ['ai_key', 'ai_fallback_key'] },
  wheel: { schema: wheelSchema, secrets: [] as string[] },
  addons: { schema: addonsSchema, secrets: [] as string[] },
  monitoring: { schema: monitoringSchema, secrets: [] as string[] },
  appearance: { schema: appearanceSchema, secrets: [] as string[] },
  yookassa: { schema: yookassaSchema, secrets: ['secret_key'] },
  platega: { schema: plategaSchema, secrets: ['secret'] },
  rollypay: { schema: rollypaySchema, secrets: ['api_key', 'signing_secret'] },
  nodeip: { schema: nodeipSchema, secrets: ['cloudflare_token'] },
  remnawave: { schema: remnawaveSchema, secrets: ['token'] },
} as const;

export type GroupName = keyof typeof GROUPS;
export type GroupValue<G extends GroupName> = z.infer<(typeof GROUPS)[G]['schema']>;

const cache = new Map<string, { at: number; value: any }>();
/** Значения из БД, не прошедшие валидацию при чтении (заменены дефолтами): group → { key: rawValue } */
const issues = new Map<string, Record<string, unknown>>();

export function settingsIssues(group: GroupName): Record<string, unknown> {
  return issues.get(group) ?? {};
}

/** Удаляет из объекта значение по пути (лист), чтобы при повторном разборе подставился дефолт */
function dropPath(obj: any, path: (string | number)[]): boolean {
  if (!path.length) return false;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur?.[path[i]!];
    if (cur == null || typeof cur !== 'object') return false;
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cur) && typeof last === 'number') cur.splice(last, 1);
  else delete cur[last];
  return true;
}
const TTL = 3000;

export function clearSettingsCache() {
  cache.clear();
}

/** Читает группу настроек (секреты расшифрованы). Пустые значения заменяются дефолтами схемы. */
export async function getSettings<G extends GroupName>(group: G): Promise<GroupValue<G>> {
  const hit = cache.get(group);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const [row] = await sql()`select value from settings where key = ${group}`;
  const raw: Record<string, unknown> = { ...((row?.value as Record<string, unknown>) ?? {}) };
  for (const f of GROUPS[group].secrets) {
    const v = raw[f];
    if (typeof v === 'string' && v.startsWith('enc:')) {
      try {
        raw[f] = decrypt(v.slice(4));
      } catch {
        raw[f] = '';
      }
    }
  }
  // Терпимое чтение: одно битое поле (например, значение, сохранённое до появления валидации)
  // не должно сбрасывать всю группу к дефолтам — заменяем дефолтом только его.
  const bad: Record<string, unknown> = {};
  const work = structuredClone(raw);
  let parsed = GROUPS[group].schema.safeParse(work);
  for (let i = 0; i < 10 && !parsed.success; i++) {
    let changed = false;
    for (const iss of parsed.error.issues) {
      const top = String(iss.path[0] ?? '');
      if (top && !(top in bad)) bad[top] = raw[top];
      // ссылка канала гейта и т.п. — убираем только лист; иначе — всё поле
      if (dropPath(work, iss.path.length > 1 ? iss.path : [top])) changed = true;
    }
    if (!changed) break;
    parsed = GROUPS[group].schema.safeParse(work);
  }
  if (Object.keys(bad).length) {
    issues.set(group, bad);
    log.warn('settings: invalid stored values replaced with defaults', { group, keys: Object.keys(bad) });
  } else issues.delete(group);
  const value = (parsed.success ? parsed.data : GROUPS[group].schema.parse({})) as GroupValue<G>;
  cache.set(group, { at: Date.now(), value });
  return value;
}

/** Для админки: секреты скрыты, но видно, заданы ли они. */
export async function getSettingsMasked(group: GroupName): Promise<Record<string, unknown>> {
  const v = { ...(await getSettings(group)) } as Record<string, unknown>;
  for (const f of GROUPS[group].secrets) {
    v[f] = v[f] ? MASK : '';
  }
  return v;
}

export async function setSettings(group: GroupName, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const current = (await getSettings(group)) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if ((GROUPS[group].secrets as string[]).includes(k) && (v === MASK || v === undefined)) continue;
    merged[k] = v;
  }
  const parsed = GROUPS[group].schema.parse(merged) as Record<string, unknown>;
  const toStore: Record<string, unknown> = { ...parsed };
  for (const f of GROUPS[group].secrets) {
    const v = toStore[f];
    toStore[f] = typeof v === 'string' && v ? 'enc:' + encrypt(v) : '';
  }
  await sql()`
    insert into settings (key, value, encrypted) values (${group}, ${sql().json(toStore as any)}, ${GROUPS[group].secrets.length > 0})
    on conflict (key) do update set value = excluded.value, encrypted = excluded.encrypted, updated_at = now()`;
  cache.delete(group);
  return getSettingsMasked(group);
}
