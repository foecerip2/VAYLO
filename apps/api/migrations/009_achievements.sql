-- Достижения: выдаются за выполнение заданий, у каждого — бонус-«плюшка» (дни подписки)
create table if not exists user_achievements (
  user_id uuid not null references users(id) on delete cascade,
  code text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, code)
);
