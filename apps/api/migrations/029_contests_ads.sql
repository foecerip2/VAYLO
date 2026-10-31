-- v62: конкурсы, посты в канал, стоимость рекламных ссылок
create table if not exists contests (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  title          text not null,
  description    text not null default '',
  status         text not null default 'draft' check (status in ('draft','active','finished','cancelled')),
  prize_kind     text not null check (prize_kind in ('days','balance','discount','manual')),
  prize_value    bigint not null default 0 check (prize_value >= 0),
  prize_text     text not null default '',
  winners_count  integer not null default 1 check (winners_count between 1 and 100),
  require_channel boolean not null default true,
  starts_at      timestamptz,
  ends_at        timestamptz not null,
  post_text      text not null default '',
  finished_at    timestamptz,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists contests_status_idx on contests (status, ends_at);

create table if not exists contest_entries (
  contest_id uuid not null references contests(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contest_id, user_id)
);

create table if not exists contest_winners (
  contest_id uuid not null references contests(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  place      integer not null,
  prize_status text not null default 'pending' check (prize_status in ('paid','manual_pending','manual_issued','failed','pending')),
  note       text not null default '',
  notified_at timestamptz,
  primary key (contest_id, user_id)
);

create table if not exists channel_posts (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'custom' check (kind in ('custom','contest','contest_result','promo')),
  contest_id   uuid references contests(id) on delete set null,
  ad_id        uuid references partner_links(id) on delete set null,
  chat         text not null,
  text         text not null,
  image_url    text not null default '',
  button_text  text not null default '',
  button_url   text not null default '',
  scheduled_at timestamptz not null default now(),
  status       text not null default 'scheduled' check (status in ('scheduled','sent','failed','cancelled')),
  message_id   bigint,
  error        text not null default '',
  sent_at      timestamptz,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists channel_posts_due_idx on channel_posts (status, scheduled_at);

alter table partner_links add column if not exists cost_kop bigint not null default 0;
alter table partner_links add column if not exists source text not null default '';
alter table partner_links add column if not exists note text not null default '';
