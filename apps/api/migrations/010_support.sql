-- Поддержка: ИИ-чат и тикеты, сообщения, шаблоны ответов, лимиты и «страйки» за нарушения
create table if not exists support_tickets (
  id            uuid primary key default gen_random_uuid(),
  number        bigserial,
  user_id       uuid not null references users(id) on delete cascade,
  kind          text not null default 'ticket' check (kind in ('chat','ticket')),
  subject       text not null default '',
  priority      text not null default 'normal' check (priority in ('normal','important','urgent')),
  status        text not null default 'open' check (status in ('open','answered','closed')),
  mode          text not null default 'human' check (mode in ('ai','human')),
  ai_off        boolean not null default false,
  escalated     boolean not null default false,
  unread_admin  boolean not null default false,
  unread_user   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists support_tickets_user_idx on support_tickets (user_id, updated_at desc);
create index if not exists support_tickets_queue_idx on support_tickets (status, priority, updated_at desc);

create table if not exists support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references support_tickets(id) on delete cascade,
  author     text not null check (author in ('user','ai','admin','system')),
  admin_id   uuid,
  body       text not null,
  rating     smallint check (rating in (-1, 1)),
  flagged    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on support_messages (ticket_id, created_at);

create table if not exists support_templates (
  id    uuid primary key default gen_random_uuid(),
  title text not null,
  body  text not null,
  sort  integer not null default 0
);

create table if not exists support_usage (
  user_id  uuid not null references users(id) on delete cascade,
  day      date not null,
  ai_count integer not null default 0,
  primary key (user_id, day)
);

alter table users add column if not exists support_strikes integer not null default 0;
alter table users add column if not exists support_muted_until timestamptz;
