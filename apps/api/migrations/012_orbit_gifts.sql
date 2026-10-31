alter table payments add column request_key text;
alter table payments add column request_hash text;
create unique index payments_request_uidx on payments (user_id, request_key) where request_key is not null;

create table gifts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references payments(id) on delete cascade,
  buyer_id uuid not null references users(id) on delete cascade,
  code_hash text not null unique,
  code_encrypted text not null,
  plan jsonb not null,
  redeemed_by uuid references users(id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index gifts_buyer_idx on gifts (buyer_id, created_at desc);
