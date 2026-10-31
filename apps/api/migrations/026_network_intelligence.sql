create table if not exists network_incidents (
  id            uuid primary key default gen_random_uuid(),
  scope_hash    text not null,
  target        text not null,
  operator      text not null,
  state         text not null check (state in ('suspected','confirmed','recovering','resolved')),
  severity      text not null default 'medium' check (severity in ('low','medium','high')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  evidence_count integer not null default 0,
  alerted_at    timestamptz,
  updated_at    timestamptz not null default now()
);
create unique index if not exists network_incidents_open_uidx on network_incidents (scope_hash) where state <> 'resolved';
create index if not exists network_incidents_state_idx on network_incidents (state, updated_at desc);
create table if not exists incident_events (
  id          bigserial primary key,
  incident_id uuid not null references network_incidents(id) on delete cascade,
  at          timestamptz not null default now(),
  transition  text not null,
  summary     text not null default '',
  author_type text not null default 'system' check (author_type in ('system','admin')),
  note        text
);
create index if not exists incident_events_idx on incident_events (incident_id, at);
