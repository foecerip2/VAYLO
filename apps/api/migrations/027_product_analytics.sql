create table if not exists product_events (
  event_id    text primary key,
  event_name  text not null,
  user_id     uuid references users(id) on delete set null,
  session_id  text,
  source      text not null default 'miniapp',
  campaign_id text,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  properties  jsonb not null default '{}'::jsonb
);
create index if not exists product_events_name_idx on product_events (event_name, occurred_at);
