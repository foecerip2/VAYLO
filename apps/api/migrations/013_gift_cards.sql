alter table gifts
  add column recipient_name text not null default '',
  add column sender_name text not null default '',
  add column message text not null default '',
  add column theme text not null default 'orbit' check (theme in ('orbit','aurora','pearl')),
  add column version integer not null default 1,
  add column redeemed_expires_at timestamptz,
  add column redeemed_plan_name text,
  add column redeemed_keeps_current_plan boolean not null default false;
create index gifts_recipient_idx on gifts (redeemed_by, redeemed_at desc) where redeemed_at is not null;
