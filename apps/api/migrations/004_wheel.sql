-- Версия 4: колесо удачи — один бесплатный прокрут в сутки (по московскому времени).
create table wheel_spins (
  user_id     uuid not null references users(id) on delete cascade,
  day         text not null,
  prize_id    text not null,
  prize_label text not null,
  prize_type  text not null check (prize_type in ('days','balance')),
  prize_value bigint not null check (prize_value > 0),
  created_at  timestamptz not null default now(),
  primary key (user_id, day)
);
create index wheel_spins_created_idx on wheel_spins (created_at desc);
