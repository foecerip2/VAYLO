-- Акции: компенсации всем (дни/баланс), скидка на тарифы, бонус к пополнению
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  kind        text not null check (kind in ('days','balance','plan_discount','topup_bonus')),
  value       integer not null check (value > 0),
  audience    text not null default 'all',
  plan_ids    uuid[],
  message     text not null default '',
  notify      boolean not null default true,
  is_active   boolean not null default true,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  -- для компенсаций: draft → running → done
  status      text not null default 'draft',
  total       integer not null default 0,
  granted     integer not null default 0,
  failed      integer not null default 0,
  started_at  timestamptz,
  finished_at timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);
create table if not exists campaign_grants (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
