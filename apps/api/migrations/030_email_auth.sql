-- v66: вход клиентов по почте и паролю (Android-приложение)
alter table users
  add column if not exists password_hash text,
  add column if not exists session_epoch int not null default 0,
  add column if not exists failed_logins int not null default 0,
  add column if not exists locked_until  timestamptz;

-- одноразовые действия, подтверждаемые через Telegram-бота: привязка Telegram и сброс пароля
create table if not exists account_actions (
  token        text primary key,
  purpose      text not null check (purpose in ('tg_link','pw_reset')),
  user_id      uuid references users(id) on delete cascade, -- null: сброс для неизвестной почты (ответ API не должен её выдавать)
  confirmed_at timestamptz,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists account_actions_expires_idx on account_actions (expires_at);
