-- Версия 2: админы в Telegram, гейт канала, докупки, локации, рефералы 2 уровня, квесты, мониторинг.

alter table admins add column tg_id bigint unique;

alter table users
  add column auto_renew        boolean not null default false,
  add column channel_ok_at     timestamptz,
  add column partner_link_id   uuid,
  add column discount_pct      integer not null default 0 check (discount_pct between 0 and 100),
  add column checkin_streak    integer not null default 0,
  add column last_checkin      date,
  add column signup_bonus_done boolean not null default false;

alter table subscriptions
  add column extra_devices       integer not null default 0,
  add column extra_traffic_bytes bigint  not null default 0;

alter table payments drop constraint payments_purpose_check;
alter table payments add constraint payments_purpose_check check (purpose in ('plan','topup','addon'));

-- Рефералы: несколько уровней на один платёж
alter table referral_rewards drop constraint referral_rewards_payment_id_key;
alter table referral_rewards add column level integer not null default 1;
alter table referral_rewards add column kind text not null default 'payment';
alter table referral_rewards alter column payment_id drop not null;
create unique index referral_rewards_payment_level_uidx on referral_rewards (payment_id, level) where payment_id is not null;

create table referral_ranks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  min_paid   integer not null default 0 check (min_paid >= 0),
  percent    integer not null default 0 check (percent between 0 and 100),
  extra_days integer not null default 0 check (extra_days >= 0),
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

create table partner_links (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  owner_user_id uuid references users(id) on delete set null,
  clicks        integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table users add constraint users_partner_link_fk foreign key (partner_link_id) references partner_links(id) on delete set null;
create index users_partner_idx on users (partner_link_id);

-- Квесты
create table quests (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text not null default '',
  type         text not null check (type in ('daily_checkin','join_channel','invite_friends','first_payment','topup_total','spend_total','have_subscription','traffic_used','open_link')),
  target       bigint not null default 1 check (target > 0),
  reward_type  text not null check (reward_type in ('days','balance')),
  reward_value bigint not null check (reward_value > 0),
  repeat       text not null default 'once' check (repeat in ('once','daily')),
  config       jsonb not null default '{}'::jsonb,
  sort         integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create table quest_claims (
  user_id    uuid not null references users(id) on delete cascade,
  quest_id   uuid not null references quests(id) on delete cascade,
  period     text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, quest_id, period)
);

-- Локации (премиум = отдельный сквад Remnawave) и докупки
create table locations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  country_code text,
  description  text not null default '',
  squad_uuid   text not null,
  is_active    boolean not null default true,
  sort         integer not null default 0,
  created_at   timestamptz not null default now()
);
create table addon_products (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('devices','traffic','location')),
  name          text not null,
  description   text not null default '',
  price         bigint not null check (price >= 0),
  qty           integer not null default 1 check (qty > 0),
  location_id   uuid references locations(id) on delete cascade,
  duration_days integer check (duration_days is null or duration_days > 0),
  is_active     boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);
create table user_locations (
  user_id     uuid not null references users(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  expires_at  timestamptz not null,
  primary key (user_id, location_id)
);

-- Мониторинг
create table monitor_state (
  target     text primary key,
  label      text not null,
  status     text not null default 'unknown' check (status in ('up','down','unknown')),
  fails      integer not null default 0,
  since      timestamptz not null default now(),
  checked_at timestamptz,
  detail     text
);
create table monitor_events (
  id         bigserial primary key,
  target     text not null,
  label      text not null,
  status     text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index monitor_events_created_idx on monitor_events (created_at desc);

-- Стартовые ранги и квесты
insert into referral_ranks (name, min_paid, percent, extra_days, sort) values
  ('Новичок', 0, 0, 0, 1), ('Друг', 3, 5, 0, 2), ('Амбассадор', 10, 10, 3, 3), ('Партнёр', 30, 15, 7, 4);
insert into quests (title, description, type, target, reward_type, reward_value, repeat, sort) values
  ('Ежедневный бонус', 'Заходите каждый день: серия увеличивает награду', 'daily_checkin', 1, 'balance', 500, 'daily', 1),
  ('Подпишитесь на канал', 'Новости и акции сервиса', 'join_channel', 1, 'balance', 1000, 'once', 2),
  ('Пригласите друга', 'Друг зарегистрируется по вашей ссылке', 'invite_friends', 1, 'days', 3, 'once', 3),
  ('Первая покупка', 'Оформите любой тариф', 'first_payment', 1, 'balance', 2000, 'once', 4),
  ('Пять друзей', 'Пригласите 5 друзей', 'invite_friends', 5, 'days', 14, 'once', 5);
