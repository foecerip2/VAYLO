-- Статус серверов для пользователей, оповещения о простоях и компенсация днями
create table if not exists status_servers (
  id         uuid primary key default gen_random_uuid(),
  node_uuid  text not null unique,
  title      text not null,
  grp        text not null default 'location' check (grp in ('location','bridge','lte')),
  sort       integer not null default 0,
  visible    boolean not null default true,
  -- null — касается всех; иначе только пользователей с этими тарифами (например, LTE только в PURPLE)
  plan_ids   uuid[],
  created_at timestamptz not null default now()
);
create table if not exists status_outages (
  id               uuid primary key default gen_random_uuid(),
  server_id        uuid not null references status_servers(id) on delete cascade,
  title            text not null,
  started_at       timestamptz not null,
  notified_at      timestamptz,
  notified_count   integer not null default 0,
  resolved_at      timestamptz,
  recovery_sent_at timestamptz,
  compensated_at   timestamptz,
  comp_done        boolean not null default false,
  comp_days        integer not null default 0,
  comp_users       integer not null default 0,
  comp_failed      integer not null default 0
);
create index if not exists status_outages_open_idx on status_outages (server_id) where resolved_at is null;
create table if not exists status_compensations (
  outage_id uuid not null references status_outages(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  at        timestamptz not null default now(),
  primary key (outage_id, user_id)
);
create index if not exists status_compensations_user_idx on status_compensations (user_id, at desc);
