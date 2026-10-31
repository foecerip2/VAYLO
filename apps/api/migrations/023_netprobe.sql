-- Проверки доступности из сетей операторов (клиенты Mini App и пробы по ключу VLESS)
create table if not exists net_probes (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  source     text not null check (source in ('client','probe')),
  user_id    uuid references users(id) on delete set null,
  probe_name text,
  asn        integer,
  operator   text not null default 'other',
  os         text not null default 'other',
  target     text not null,
  kind       text not null default 'host',
  ok         boolean not null,
  ms         integer,
  detail     text
);
create index if not exists net_probes_at_idx on net_probes (at desc);
create index if not exists net_probes_group_idx on net_probes (operator, target, at desc);
-- кэш «IP-префикс → оператор» (сами IP пользователей не храним)
create table if not exists asn_cache (
  prefix     text primary key,
  asn        integer,
  holder     text not null default '',
  operator   text not null default 'other',
  fetched_at timestamptz not null default now()
);
-- активные проблемы: оператор × цель
create table if not exists net_issues (
  operator   text not null,
  target     text not null,
  since      timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  samples    integer not null default 0,
  ok_pct     integer not null default 0,
  active     boolean not null default true,
  alerted_at timestamptz,
  primary key (operator, target)
);
