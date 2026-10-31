-- Daily counters contain categories only; no message text, gift codes or payment details.
create table bot_activity_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);
-- Event timestamps make reports correct for any configured timezone, including DST.
create index bot_activity_updates_created_idx on bot_activity_updates(created_at);
create table bot_activity_events (
  update_id bigint primary key references bot_activity_updates(update_id) on delete cascade,
  user_id uuid not null,
  category text not null,
  created_at timestamptz not null default now()
);
create index bot_activity_events_created_idx on bot_activity_events(created_at);
create table admin_daily_reports (
  day date not null,
  timezone text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key(day,timezone)
);
create table admin_report_deliveries (
  day date not null,
  timezone text not null,
  chat_id bigint not null,
  sent_at timestamptz,
  attempted_at timestamptz,
  attempts integer not null default 0,
  primary key(day,timezone,chat_id),
  foreign key(day,timezone) references admin_daily_reports(day,timezone) on delete cascade
);

create table trial_activations (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
create index trial_activations_created_idx on trial_activations(created_at);
