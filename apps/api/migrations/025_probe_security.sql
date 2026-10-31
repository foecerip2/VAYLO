-- Токены проб с ограниченными правами (хранится только хэш) и метаданные источника замеров
create table if not exists probe_tokens (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  token_hash   text not null unique,
  scopes       text[] not null default '{probe:write}',
  created_by   uuid references admins(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
alter table net_probes add column if not exists evidence text;
alter table net_probes add column if not exists probe_id uuid references probe_tokens(id) on delete set null;
alter table net_probes add column if not exists report_id text;
-- повторная отправка того же отчёта (ретраи) не дублирует замеры
create unique index if not exists net_probes_report_uidx on net_probes (probe_id, report_id, target) where report_id is not null;
create index if not exists net_probes_source_at_idx on net_probes (source, target, at desc);
update net_probes set evidence = case when source = 'probe' then 'real_xray_probe' else 'browser_heuristic' end where evidence is null;
