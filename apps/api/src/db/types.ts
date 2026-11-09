export interface UserRow {
  id: string;
  tg_id: number | null;
  username: string | null;
  first_name: string | null;
  lang: string;
  email: string | null;
  referral_code: string;
  referrer_id: string | null;
  balance: number;
  status: 'active' | 'banned';
  trial_used: boolean;
  bot_blocked: boolean;
  rw_id: number | null;
  rw_short_uuid: string | null;
  rw_username: string | null;
  created_at: Date;
  last_seen_at: Date;
  auto_renew: boolean;
  channel_ok_at: Date | null;
  partner_link_id: string | null;
  discount_pct: number;
  checkin_streak: number;
  last_checkin: string | null;
  signup_bonus_done: boolean;
  referral_mode: 'days' | 'balance';
  ref_balance: number;
  password_hash: string | null;
  session_epoch: number;
  failed_logins: number;
  locked_until: Date | null;
}

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  duration_days: number;
  traffic_limit_gb: number;
  device_limit: number;
  price: number;
  old_price: number | null;
  badge: string | null;
  sort: number;
  is_active: boolean;
  created_at: Date;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string | null;
  plan_name: string | null;
  is_trial: boolean;
  expires_at: Date;
  started_at: Date;
  traffic_limit_bytes: number;
  traffic_used_bytes: number;
  device_limit: number;
  extra_devices: number;
  extra_traffic_bytes: number;
  sub_url: string | null;
  notified: Record<string, boolean>;
  updated_at: Date;
}

export interface PaymentRow {
  id: string;
  user_id: string;
  provider: string;
  method: string | null;
  external_id: string | null;
  purpose: 'plan' | 'topup' | 'addon';
  plan_id: string | null;
  plan_name: string | null;
  amount: number;
  discount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'canceled' | 'refunded' | 'expired';
  promo_id: string | null;
  pay_url: string | null;
  payload: Record<string, any>;
  fulfilled_at: Date | null;
  request_key?: string | null;
  request_hash?: string | null;
  fulfill_error: string | null;
  fulfill_failed_at: Date | null;
  refunded_to_balance: boolean;
  refunded_at: Date | null;
  created_at: Date;
  paid_at: Date | null;
}

export interface PromoRow {
  id: string;
  code: string;
  type: 'percent' | 'fixed' | 'days' | 'balance';
  value: number;
  max_uses: number | null;
  used: number;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
}

export interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'owner' | 'admin' | 'support' | 'analyst';
  totp_secret: string | null;
  totp_enabled: boolean;
  tg_id: number | null;
  created_at: Date;
  last_login_at: Date | null;
  session_epoch: number;
}
