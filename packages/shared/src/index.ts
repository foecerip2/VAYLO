/** Общие типы и утилиты для API, бота и фронтендов. Деньги везде — в копейках (целые числа). */

export const PAYMENT_PROVIDERS = ['yookassa', 'platega', 'rollypay', 'balance'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'canceled', 'refunded', 'expired'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ADMIN_ROLES = ['owner', 'admin', 'support', 'analyst'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LEVEL: Record<AdminRole, number> = { analyst: 1, support: 2, admin: 3, owner: 4 };

export const PLATEGA_METHODS = {
  sbp: { id: 2, title: 'СБП (QR)' },
  cards_rub: { id: 10, title: 'Карты РФ' },
  card_acquiring: { id: 11, title: 'Банковская карта' },
  international: { id: 12, title: 'Международная карта' },
  crypto: { id: 13, title: 'Криптовалюта' },
} as const;
export type PlategaMethodKey = keyof typeof PLATEGA_METHODS;

/** RollyPay: «any» — не фиксировать способ, клиент выберет на платёжной странице RollyPay */
export const ROLLYPAY_METHODS = {
  any: { title: 'СБП · Карта · Крипта', api: null },
  sbp: { title: 'СБП (RollyPay)', api: 'sbp' },
  card: { title: 'Банковская карта (RollyPay)', api: 'card' },
  crypto: { title: 'Криптовалюта (RollyPay)', api: 'crypto' },
} as const;
export type RollypayMethodKey = keyof typeof ROLLYPAY_METHODS;

export type SubscriptionState = 'none' | 'trial' | 'active' | 'expiring' | 'expired';

export interface PlanDTO {
  id: string;
  name: string;
  description: string;
  durationDays: number;
  trafficLimitGb: number; // 0 = безлимит
  deviceLimit: number;
  price: number; // копейки
  oldPrice: number | null;
  badge: string | null;
  sort: number;
  isActive: boolean;
}

export interface LteQuotaDTO { usedBytes:number; baseBytes:number; extraBytes:number; limitBytes:number; remainingBytes:number; optedOut:boolean; nextExpiry:string|null }
export interface SubscriptionDTO {
  lte?: LteQuotaDTO | null;
  lteUnavailable?: boolean;
  state: SubscriptionState;
  planName: string | null;
  expiresAt: string | null;
  daysLeft: number;
  totalDays: number;
  trafficUsedBytes: number;
  trafficLimitBytes: number; // 0 = безлимит
  deviceLimit: number;
  extraDevices: number;
  extraTrafficBytes: number;
  subUrl: string | null;
  isTrial: boolean;
  autoRenew: boolean;
}

export interface MeDTO {
  avatarUrl?:string|null;
  id: string;
  tgId: number | null;
  /** Вход по почте и паролю (Android-приложение): почта аккаунта и наличие пароля */
  email?: string | null;
  hasPassword?: boolean;
  username: string | null;
  firstName: string | null;
  balance: number;
  referralCode: string;
  discountPct: number;
  checkinStreak: number;
  trialAvailable: boolean;
  subscription: SubscriptionDTO;
  gate?: GateDTO;
  adminRole?: AdminRole | null;
}

export interface PaymentMethodDTO {
  id: string; // 'yookassa' | 'platega:sbp' | 'rollypay:any' | 'balance'
  provider: PaymentProvider;
  method?: string;
  title: string;
  hint?: string;
}

export interface PaymentDTO {
  gift?: boolean;
  id: string;
  provider: string;
  purpose: 'plan' | 'topup' | 'addon';
  amount: number;
  status: PaymentStatus;
  planName: string | null;
  createdAt: string;
  paidAt: string | null;
}

/** Действующая акция, видимая пользователю (баннер в Mini App) */
export interface ActiveCampaignDTO {
  id: string;
  title: string;
  kind: 'plan_discount' | 'topup_bonus';
  value: number;
  endsAt: string | null;
  planIds: string[] | null;
}

export interface NodeDTO {
  id: string;
  name: string;
  countryCode: string | null;
  online: boolean;
  usersOnline: number;
  /** координаты точки на глобусе (определяются автоматически) */
  lat?: number | null;
  lng?: number | null;
  /** node — реальный сервер Remnawave, location — локация из каталога без ноды */
  kind?: 'node' | 'location';
  checkedAt?: string;
  stale?: boolean;
}

export interface GateChatDTO {
  chat: string;
  title: string;
  url: string;
  joined: boolean;
}
export interface GateDTO {
  required: boolean;
  ok: boolean;
  text: string;
  chats: GateChatDTO[];
  /** аккаунт по почте без Telegram: шлюз включён, а проверить подписку не на чем — нужно привязать Telegram */
  needTelegram?: boolean;
}

export interface ReferralStatsDTO {
  code: string;
  link: string | null;
  webLink: string;
  enabled: boolean;
  invited: number;
  invitedLevel2: number;
  paid: number;
  earnedDays: number;
  earnedBalance: number;
  earnedLevel2: number;
  /** выбранная награда: дни / деньги; both — выбор выключен админом (начисляется и то и другое) */
  mode: 'days' | 'balance' | 'both';
  choiceEnabled: boolean;
  /** реферальный счёт, копейки (можно вывести или перевести на баланс) */
  refBalance: number;
  withdrawPending: number;
  withdrawn: number;
  withdraw: { enabled: boolean; min: number; feePercent: number; transferBonusPercent: number; methods: string };
  rewardDays: number;
  rewardPercent: number;
  level2Percent: number;
  level2Days: number;
  recurring: boolean;
  signupBonus: number;
  rank: { name: string; percent: number; extraDays: number } | null;
  nextRank: { name: string; minPaid: number; left: number } | null;
  ranks: { name: string; minPaid: number; percent: number; extraDays: number }[];
  partnerLinks: { id: string; name: string; code: string; clicks: number; registrations: number; active: boolean; link: string | null; webLink: string }[];
}

export interface AddonProductDTO {
  available?: boolean;
  unavailableReason?: string | null;
  id: string;
  kind: 'devices' | 'traffic' | 'location' | 'lte';
  name: string;
  description: string;
  price: number;
  finalPrice: number;
  qty: number;
  durationDays: number | null;
  locationId: string | null;
  locationName: string | null;
  countryCode: string | null;
  owned: boolean;
}
export interface AddonCatalogDTO {
  enabled: boolean;
  unlimited?: boolean;
  active?: boolean;
  products: AddonProductDTO[];
  mine: { locationId: string; name: string; expiresAt: string | null }[];
}

export interface QuestDTO {
  id: string;
  title: string;
  description: string;
  type: string;
  target: number;
  progress: number;
  rewardType: 'days' | 'balance';
  rewardValue: number;
  repeat: 'once' | 'daily';
  claimed: boolean;
  claimable: boolean;
  url: string | null;
}

export interface AchievementDTO {
  code: string;
  title: string;
  text: string;
  icon: string;
  /** бонус в днях подписки */
  days: number;
  earned: boolean;
  earnedAt: string | null;
  progress: number;
  target: number;
}

export interface AppConfigDTO {
  clientApps?: ClientAppPolicy[];
  brandName: string;
  /** раздел «Поддержка» (чат с ИИ и тикеты) включён */
  supportInApp: boolean;
  supportUrl: string;
  channelUrl: string;
  termsUrl: string;
  maintenance: boolean;
  maintenanceText: string;
  welcomeText: string;
  /** приветствие после /start (шаблон с {brand} и {name}) и картинка к нему */
  startText?: string;
  startImageUrl?: string | null;
  botUsername: string | null;
  trial: { enabled: boolean; days: number; trafficGb: number; devices: number };
  referral: { enabled: boolean; days: number; percent: number; level2Percent: number; signupBonus: number };
  topup: { min: number; max: number; presets: number[]; bonuses: { from: number; percent: number }[] };
  addonsEnabled: boolean;
  autoRenewEnabled: boolean;
  questsEnabled: boolean;
  wheelEnabled?: boolean;
  contestsActive?: boolean;
  /** проект закрывается: таймер, продажи и регистрация закрыты */
  closure?: { active: false } | { active: true; endsAt: string | null; serverNow: string; reason: string; altText: string; altUrl: string };
  gateEnabled: boolean;
  appearance: { accent: string; logoUrl: string; banner: string; design?: import('./designs.js').MiniAppDesignId };
}

/** 29900 -> "299 ₽", 29950 -> "299,50 ₽" */
export function formatRub(kopecks: number): string {
  const rub = kopecks / 100;
  const whole = Number.isInteger(rub);
  return (
    rub.toLocaleString('ru-RU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }) + ' ₽'
  );
}

export function bytesToHuman(bytes: number): string {
  if (!bytes || bytes < 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.0', '')} ${units[i]}`;
}

export function pluralDays(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b > 1 && b < 5) return 'дня';
  if (b === 1) return 'день';
  return 'дней';
}

export function durationLabel(days: number): string {
  if (days % 30 === 0 && days >= 30) {
    const m = days / 30;
    const b = m % 10;
    const word = m > 10 && m < 20 ? 'месяцев' : b === 1 ? 'месяц' : b > 1 && b < 5 ? 'месяца' : 'месяцев';
    return `${m} ${word}`;
  }
  return `${days} ${pluralDays(days)}`;
}

export function subscriptionState(expiresAt: Date | null, isTrial: boolean, now = new Date()): SubscriptionState {
  if (!expiresAt) return 'none';
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return 'expired';
  if (isTrial) return 'trial';
  if (left < 3 * 86400_000) return 'expiring';
  return 'active';
}

// ---------- Человекочитаемые подписи и проверки (общие для бота, приложения и админки) ----------

export const FRIENDLY_ERROR = 'Что-то пошло не так. Попробуйте ещё раз или напишите в поддержку.';

/** Похоже ли сообщение об ошибке на техническое (не для глаз пользователя) */
export function isTechnicalMessage(msg: string | null | undefined): boolean {
  const m = (msg ?? '').trim();
  if (!m) return true;
  if (/remnawave/i.test(m)) return true;
  if (m.includes('/api/')) return true;
  if (m.includes('→')) return true;
  if (/fetch failed/i.test(m)) return true;
  if (/^Ошибка \d{3}$/.test(m)) return true; // голый HTTP-код без пояснения
  if (/^[A-Za-z0-9 .,:;!?'"()\[\]{}\/_\-=<>@#%&*+|\\]+$/.test(m)) return true; // только латиница — не перевод
  return false;
}

/** Безопасный текст ошибки для пользователя: технические сообщения заменяются на общий */
export function friendlyErrorMessage(msg: string | null | undefined, fallback = FRIENDLY_ERROR): string {
  return isTechnicalMessage(msg) ? fallback : (msg as string).trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | null | undefined): boolean => UUID_RE.test((s ?? '').trim());

/** «@name» / «t.me/name» → https://t.me/name; прочее — как есть (обрезанное) */
export function normalizeChannelUrl(raw: string): string {
  const s = raw.trim();
  const at = /^@([A-Za-z0-9_]{3,})$/.exec(s);
  if (at) return `https://t.me/${at[1]}`;
  if (/^(t\.me|telegram\.me)\//i.test(s)) return `https://${s}`;
  return s;
}
export const isValidChannelUrl = (s: string): boolean => /^(https?:\/\/[^\s]+\.[^\s]+|tg:\/\/[^\s]+)$/i.test(s.trim());

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Ожидает',
  succeeded: 'Оплачен',
  canceled: 'Отменён',
  expired: 'Истёк',
  refunded: 'Возврат',
};
export const paymentStatusLabel = (s: string): string => (PAYMENT_STATUS_LABELS as Record<string, string>)[s] ?? s;

export const PAYMENT_PURPOSE_LABELS: Record<PaymentDTO['purpose'], string> = { plan: 'Тариф', topup: 'Пополнение', addon: 'Докупка' };
export const paymentPurposeLabel = (s: string): string => (PAYMENT_PURPOSE_LABELS as Record<string, string>)[s] ?? s;

/** Лимит устройств: 0 = без ограничений */
export const deviceLimitLabel = (n: number | null | undefined): string => (!n ? 'без ограничений' : `до ${n}`);

/** Разумный предел суммы пополнения (копейки) — защита от «1e22» и подобного */
export const MAX_TOPUP_KOPECKS = 100_000_000; // 1 000 000 ₽
export const PROMO_MAX_LENGTH = 40;

export interface WheelPrizeDTO { id: string; label: string; type: 'days' | 'balance'; value: number }
export interface WheelDTO {
  enabled: boolean;
  canSpin: boolean;
  nextSpinAt: string | null;
  prizes: WheelPrizeDTO[];
  last: (WheelPrizeDTO & { at: string }) | null;
}
export interface WheelSpinResultDTO { prizeIndex: number; prize: WheelPrizeDTO; nextSpinAt: string }

export interface DeviceDTO { id: string; name: string; platform: string | null; addedAt: string | null; lastSeenAt: string | null }
export interface DevicesDTO { limit: number; extraDevices: number; used: number; devices: DeviceDTO[]; active: boolean }

export interface ActivityDTO {
  summary: { online1h: number; active1d: number; active7d: number; active30d: number; new1d: number; total: number; paying30d: number; activeSubs: number; vpnOnline: number | null };
  series: { day: string; signups: number; payments: number; engagement: number; visitors: number }[];
  events: { type: 'signup' | 'payment' | 'wheel' | 'quest'; at: string; userId: string; name: string; detail: string; amount?: number }[];
  recent: { id: string; name: string; tgId: number | null; lastSeenAt: string; createdAt: string; banned: boolean; subState: string }[];
}

export interface WithdrawalDTO {
  id: string;
  amount: number;
  fee: number;
  payout: number;
  method: string;
  details: string;
  status: 'pending' | 'paid' | 'rejected';
  note: string | null;
  createdAt: string;
  processedAt: string | null;
}

export const SUPPORT_STATUSES = ['open','in_progress','waiting_user','answered','closed'] as const;
export type SupportStatus = typeof SUPPORT_STATUSES[number];
export const SUPPORT_STATUS_LABEL: Record<SupportStatus,string> = {open:'Ждёт ответа',in_progress:'В работе',waiting_user:'Нужно уточнение',answered:'Есть ответ',closed:'Закрыто'};
export type SupportPriority = 'normal' | 'important' | 'urgent';
export const SUPPORT_PRIORITY: Record<SupportPriority, { label: string; hint: string; emoji: string }> = {
  normal: { label: 'Обычный', hint: 'Вопрос или небольшая проблема, подождёт', emoji: '🟢' },
  important: { label: 'Важный', hint: 'Мешает пользоваться, нужен ответ сегодня', emoji: '🟡' },
  urgent: { label: 'Срочный', hint: 'VPN не работает совсем или проблема с оплатой', emoji: '🔴' },
};
export interface SupportTicketDTO {
  id: string; number: number; kind: 'chat' | 'ticket'; subject: string; priority: SupportPriority; status: SupportStatus;
  mode: 'ai' | 'human'; escalated: boolean; unread: boolean; createdAt: string; updatedAt: string;
}
export interface SupportAttachmentDTO { id: string; name: string; mime: 'image/jpeg'; size: number; width: number; height: number }
export interface SupportPhotoUploadDTO { image: string; name?: string }
export interface SupportMessageDTO { id: string; author: 'user' | 'ai' | 'admin' | 'system'; body: string; rating: number | null; createdAt: string; attachments?: SupportAttachmentDTO[] }

export interface MyRefNodeDTO {
  id: string; name: string; handle: string | null; joinedAt: string; paid: boolean; sub: 'active' | 'trial' | 'expired' | 'none';
  earnedBalance: number; earnedDays: number; invited: number; children: MyRefNodeDTO[];
}
export interface MyRefTreeDTO {
  enabled: boolean;
  mode: 'days' | 'balance' | 'both';
  scheme: { days: number; percent: number; level2Days: number; level2Percent: number; recurring: boolean };
  totals: { level1: number; level2: number; paid: number; earnedBalance: number; earnedDays: number; earnedBalanceL2: number; earnedDaysL2: number };
  nodes: MyRefNodeDTO[];
}

export interface LteActivityUserDTO {
  id: number; rwId: number; rwUsername: string; localUserId: string | null;
  name: string | null; username: string | null; tgId: number | null;
  active: boolean | null; lastSeenAt: string | null; lastUsageDay: string | null;
  periodBytes: number; daysUsed: number; usedBytes: number; limitBytes: number; remainingBytes: number;
  inSquad: boolean; remoteStatus: string;
}
export interface LteActivityDTO {
  state: 'ready' | 'disabled' | 'unavailable'; checkedAt: string | null;
  precision: 'updated-at' | 'day'; nodeId: number; activeWindowSeconds: number;
  from: string | null; to: string | null; page: number; limit: number; total: number;
  stats: { activeUsers: number | null; periodUsers: number; periodBytes: number } | null;
  items: LteActivityUserDTO[];
}
export interface LteActivityHistoryDTO {
  state: LteActivityDTO['state']; checkedAt: string | null; precision: LteActivityDTO['precision'];
  nodeId: number; from: string | null; to: string | null; user: LteActivityUserDTO | null;
  page: number; limit: number; total: number;
  items: { day: string; bytes: number; lastSeenAt: string | null }[];
}
export * from './designs';

export const CLIENT_APP_IDS = ['happ','incy','karing','hiddify','streisand'] as const;
export const CLIENT_OS_IDS = ['ios','android','windows','macos','linux'] as const;
export const CLIENT_APP_NAMES:Record<string,string> = {happ:'Happ',incy:'Incy',karing:'Karing',hiddify:'Hiddify',streisand:'Streisand'};
export const CLIENT_APP_STATUS = {unknown:'Не проверено',available:'Доступно',regional:'Зависит от региона',removed:'Недоступно в магазине'} as const;
export interface ClientAppPolicy {id:typeof CLIENT_APP_IDS[number];os:typeof CLIENT_OS_IDS[number];status:keyof typeof CLIENT_APP_STATUS;recommended:boolean;note:string}

/** Что требует внимания администратора (красный индикатор) */
export interface AttentionItemDTO {
  key: 'down' | 'unfulfilled' | 'network' | 'support' | 'withdrawals';
  level: 'critical' | 'todo';
  count: number;
  title: string;
  web: string;
  mini: string;
}
export interface AttentionDTO { items: AttentionItemDTO[]; total: number; critical: number }

/** Статус серверов для пользователей (бот и Mini App) */
export interface ServerStatusDTO {
  overall: 'ok' | 'partial' | 'down' | 'unknown';
  summary: string;
  groups: { key: 'location' | 'bridge' | 'lte'; title: string; items: { id: string; title: string; status: 'up' | 'down' | 'unknown' }[] }[];
  compensate: { enabled: boolean; hours: number; days: number };
  updatedAt: string | null;
}
