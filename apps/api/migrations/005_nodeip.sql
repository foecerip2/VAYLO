-- Версия 5: автоперенастройка нод при смене IP сервера (блокировки ТСПУ).
create table node_agents (
  node_uuid  text primary key,
  node_name  text,
  token_hash text not null unique,
  last_ip    text,
  last_seen  timestamptz,
  dns_name   text,
  created_at timestamptz not null default now()
);
create table node_ip_changes (
  id         bigserial primary key,
  node_uuid  text not null,
  node_name  text,
  old_ip     text,
  new_ip     text not null,
  source     text not null,
  ok         boolean not null default true,
  detail     text,
  created_at timestamptz not null default now()
);
create index node_ip_changes_idx on node_ip_changes (created_at desc);
