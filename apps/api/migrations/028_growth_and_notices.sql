-- воронка сообщений бота и уведомления об инцидентах
create table if not exists bot_funnel_sent (
  user_id uuid not null references users(id) on delete cascade,
  step    text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, step)
);
alter table network_incidents add column if not exists users_notified_at timestamptz;
alter table network_incidents add column if not exists users_notified integer not null default 0;
alter table network_incidents add column if not exists recovery_notified_at timestamptz;
-- авто-акции, которыми управляет система (отличаются от ручных)
alter table campaigns add column if not exists auto_key text;
create unique index if not exists campaigns_auto_key_uidx on campaigns (auto_key) where auto_key is not null;
