-- Версия 6: реферальная программа с выбором награды (дни / деньги), отдельный реферальный счёт и заявки на вывод.
alter table users add column referral_mode text not null default 'days' check (referral_mode in ('days','balance'));
alter table users add column ref_balance  bigint not null default 0 check (ref_balance >= 0);

create table ref_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  type          text not null check (type in ('reward','transfer','withdraw','withdraw_refund')),
  amount        bigint not null,
  balance_after bigint not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index ref_ledger_user_idx on ref_ledger (user_id, created_at desc);

create table withdrawals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  amount       bigint not null check (amount > 0),
  fee          bigint not null default 0,
  method       text not null default '',
  details      text not null,
  status       text not null default 'pending' check (status in ('pending','paid','rejected')),
  admin_note   text,
  processed_by text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index withdrawals_status_idx on withdrawals (status, created_at desc);
create index withdrawals_user_idx on withdrawals (user_id, created_at desc);

-- если процент с оплат друзей был 0, включаем разумное значение — иначе режим «деньги» ничего не давал бы
update settings set value = jsonb_set(value, '{percent}', '20') where key = 'referral' and coalesce((value->>'percent')::int, 0) = 0;
