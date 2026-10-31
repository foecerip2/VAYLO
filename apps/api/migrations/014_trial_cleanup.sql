create table trial_cleanup_tombstones (
  tg_id bigint primary key,
  cleaned_at timestamptz not null default now()
);
create table trial_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid,
  user_ids jsonb not null,
  state text not null default 'ready' check(state in ('ready','running','done','failed')),
  results jsonb not null default '[]',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  finished_at timestamptz
);
