-- Сессии админки: «Запомнить меня» и отзыв всех входов (смена пароля, «выйти везде»)
alter table admins add column if not exists session_epoch integer not null default 0;
