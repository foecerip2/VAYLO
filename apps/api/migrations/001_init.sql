-- Базовая схема. Деньги — в копейках (bigint).

create table users (
  id               uuid primary key default gen_random_uuid(),
  tg_id            bigint unique,
  username         text,
  first_name       text,
  lang             text not null default 'ru',
  email            text unique,
  referral_code    text not null unique,
  referrer_id      uuid references users(id) on delete set null,
  balance          bigint not null default 0 check (balance >= 0),
  status           text not null default 'active' check (status in ('active','banned')),
  trial_used       boolean not null default false,
  bot_blocked      boolean not null default false,
  rw_id            integer unique,
  rw_short_uuid    text,
  rw_username      text unique,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create index users_created_idx on users (created_at);
create index users_referrer_idx on users (referrer_id);

create table plans (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text not null default '',
  duration_days    integer not null check (duration_days > 0),
  traffic_limit_gb integer not null default 0 check (traffic_limit_gb >= 0),
  device_limit     integer not null default 3 check (device_limit >= 0),
  price            bigint not null check (price >= 0),
  old_price        bigint,
  badge            text,
  sort             integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references users(id) on delete cascade,
  plan_id             uuid references plans(id) on delete set null,
  plan_name           text,
  is_trial            boolean not null default false,
  expires_at          timestamptz not null,
  started_at          timestamptz not null default now(),
  traffic_limit_bytes bigint not null default 0,
  traffic_used_bytes  bigint not null default 0,
  device_limit        integer not null default 3,
  sub_url             text,
  notified            jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);
create index subscriptions_expires_idx on subscriptions (expires_at);

create table promo_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  type        text not null check (type in ('percent','fixed','days','balance')),
  value       bigint not null check (value > 0),
  max_uses    integer,
  used        integer not null default 0,
  expires_at  timestamptz,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  provider      text not null,
  method        text,
  external_id   text,
  purpose       text not null check (purpose in ('plan','topup')),
  plan_id       uuid references plans(id) on delete set null,
  plan_name     text,
  amount        bigint not null check (amount >= 0),
  discount      bigint not null default 0,
  currency      text not null default 'RUB',
  status        text not null default 'pending' check (status in ('pending','succeeded','canceled','refunded','expired')),
  promo_id      uuid references promo_codes(id) on delete set null,
  pay_url       text,
  payload       jsonb not null default '{}'::jsonb,
  fulfilled_at  timestamptz,
  fulfill_error text,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
create unique index payments_provider_ext_uidx on payments (provider, external_id) where external_id is not null;
create index payments_user_idx on payments (user_id, created_at desc);
create index payments_status_idx on payments (status, created_at);

create table promo_uses (
  promo_id   uuid not null references promo_codes(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  payment_id uuid references payments(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (promo_id, user_id)
);

create table transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  type          text not null,
  amount        bigint not null,
  balance_after bigint not null,
  payment_id    uuid references payments(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index transactions_user_idx on transactions (user_id, created_at desc);

create table referral_rewards (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references users(id) on delete cascade,
  referee_id  uuid not null references users(id) on delete cascade,
  payment_id  uuid not null unique references payments(id) on delete cascade,
  days        integer not null default 0,
  balance     bigint not null default 0,
  created_at  timestamptz not null default now()
);
create index referral_rewards_referrer_idx on referral_rewards (referrer_id);

create table settings (
  key        text primary key,
  value      jsonb not null,
  encrypted  boolean not null default false,
  updated_at timestamptz not null default now()
);

create table admins (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  role          text not null default 'owner' check (role in ('owner','admin','support','analyst')),
  totp_secret   text,
  totp_enabled  boolean not null default false,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table audit_log (
  id          bigserial primary key,
  admin_id    uuid,
  admin_email text,
  action      text not null,
  entity      text,
  entity_id   text,
  data        jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);

create table broadcasts (
  id          uuid primary key default gen_random_uuid(),
  admin_email text,
  text        text not null,
  button_text text,
  button_url  text,
  segment     text not null default 'all',
  status      text not null default 'queued' check (status in ('queued','sending','done','failed')),
  total       integer not null default 0,
  sent        integer not null default 0,
  failed      integer not null default 0,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table auth_links (
  token      text primary key,
  ref_code   text,
  user_id    uuid references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
