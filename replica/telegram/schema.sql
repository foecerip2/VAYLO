-- Messenger schema (Postgres / Supabase). Times are timestamptz (UTC).
-- Access rules: row level security. Users see only chats they are a member of.
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  username text unique check (username ~ '^[a-z0-9_]{5,32}$'),
  display_name text not null,
  photo_key text,
  two_step_hash text,
  privacy jsonb not null default '{"phone":"contacts","last_seen":"everyone"}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device text not null,
  push_token text,
  last_ip inet,
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on sessions (user_id);

create table login_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on login_codes (phone, created_at desc);

create table contacts (
  owner_id uuid not null references users(id) on delete cascade,
  contact_user_id uuid not null references users(id) on delete cascade,
  display_name text not null,
  primary key (owner_id, contact_user_id)
);
create index on contacts (contact_user_id);

create table chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group','channel')),
  title text,
  photo_key text,
  owner_id uuid references users(id) on delete set null,
  direct_key text unique, -- sorted "userA:userB" so a direct chat exists once
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type <> 'direct' or direct_key is not null)
);
create index on chats (owner_id);

create table members (
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','subscriber')),
  permissions jsonb not null default '{}',
  last_read_seq bigint not null default 0,
  muted_until timestamptz,
  pinned boolean not null default false,
  archived boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index on members (user_id, archived, pinned);

-- seq is per chat, gapless ordering key used for sync and read state.
create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  seq bigint not null,
  sender_id uuid references users(id) on delete set null,
  client_msg_id uuid not null, -- idempotency key from the sender device
  body text check (char_length(body) <= 4096),
  entities jsonb not null default '[]',
  reply_to_id uuid references messages(id) on delete set null,
  forwarded_from_id uuid references messages(id) on delete set null,
  scheduled_for timestamptz,
  expires_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  sent_at timestamptz not null default now(),
  unique (chat_id, seq),
  unique (sender_id, client_msg_id)
);
create index on messages (chat_id, seq desc);
create index on messages (reply_to_id);
create index on messages using gin (to_tsvector('simple', coalesce(body,'')));

create table attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  kind text not null check (kind in ('photo','video','file','voice')),
  storage_key text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 2147483648),
  duration_ms int,
  created_at timestamptz not null default now()
);
create index on attachments (message_id);

create table reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  position int not null default 0
);
create index on folders (user_id);
create table folder_chats (
  folder_id uuid not null references folders(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  primary key (folder_id, chat_id)
);

-- Per-user update log: devices ask "give me updates after pts N".
create table updates (
  user_id uuid not null references users(id) on delete cascade,
  pts bigint not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, pts)
);

-- RLS (enable on every table; examples)
alter table messages enable row level security;
create policy msg_read on messages for select using (
  exists (select 1 from members m where m.chat_id = messages.chat_id and m.user_id = auth.uid()));
create policy msg_insert on messages for insert with check (
  sender_id = auth.uid() and exists (select 1 from members m where m.chat_id = messages.chat_id
  and m.user_id = auth.uid() and (select type from chats c where c.id = messages.chat_id) <> 'channel' or m.role in ('owner','admin')));
alter table members enable row level security;
create policy mem_read on members for select using (
  user_id = auth.uid() or exists (select 1 from members m2 where m2.chat_id = members.chat_id and m2.user_id = auth.uid()));
