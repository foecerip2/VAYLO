-- Версия 7: приветствие бота — картинка, редактируемая из админки.
create table bot_media (
  key        text primary key,
  mime       text not null,
  data       bytea not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);
