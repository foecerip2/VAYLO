# API входа по почте и паролю (для Android-приложения)

База: `https://<ваш-домен>/api/v1`. Тела и ответы: JSON. Ошибки: `{"error":{"message":"…","code":"…"}}`.
Авторизованные запросы: заголовок `Authorization: Bearer <accessToken>`. Токен живёт 30 дней.
План и решения: `.claude/PRPs/plans/vaylo-email-auth-server.plan.md`.

## Правила
- Почта хранится в нижнем регистре. Пароль: 8-128 символов, не равен почте.
- Писем нет. Сброс пароля и привязка Telegram подтверждаются в Telegram-боте.
- Аккаунт по почте **без Telegram** не получает пробный период и при включённом шлюзе канала получает ошибку `telegram_required`.
- Реферального кода при регистрации по почте нет.
- Смена и сброс пароля завершают все прежние сессии: старые токены дают `401`.

## Эндпоинты

| Метод и путь | Доступ | Тело → ответ |
|---|---|---|
| `POST /auth/email/register` | публичный, 10/час | `{email, password}` → `{accessToken}` · `409 email_taken` · `400` слабый пароль |
| `POST /auth/email/login` | публичный, 10/мин | `{email, password}` → `{accessToken}` · `401 invalid_credentials` · `429 locked` · `403` бан |
| `POST /auth/email/reset/start` | публичный, 5/мин | `{email}` → `{token, url, expiresInSec}` (одинаково для любой почты) |
| `GET /auth/email/reset/:token` | публичный | → `{status: "pending" \| "ok" \| "expired"}` |
| `POST /auth/email/reset/complete` | публичный, 10/мин | `{token, password}` → `{accessToken}` · `400 reset_expired` |
| `POST /me/credentials` | токен | `{email, password}` → `{email, hasPassword}` · `409 password_exists` · `409 email_taken` |
| `POST /me/password` | токен | `{currentPassword, newPassword}` → `{accessToken}` (прежние токены недействительны) |
| `POST /me/telegram/link/start` | токен | → `{token, url, expiresInSec}` · `409 already_linked` |
| `GET /me/telegram/link/:token` | токен | → `{status: "pending" \| "ok" \| "expired"}` |
| `POST /internal/account-action/confirm` | только бот | `{token}`; не для приложения |

Существующие эндпоинты, которые использует приложение: `GET /me` (теперь с `email` и `hasPassword`), `GET /subscription`, `POST /subscription/trial`, `GET /plans`, `GET /payment-methods`, `POST /payments`, `GET /payments/:id`, `POST /auth/tglink/start`, `GET /auth/tglink/:token`, `GET /config`.

## Коды ошибок
`invalid_credentials` · `locked` (15 минут после 5 неудач) · `email_taken` · `weak_password` · `password_exists` · `no_password` · `already_linked` · `reset_expired` · `telegram_required` (шлюз канала или пробный период) · `subscribe_required` (шлюз канала, Telegram привязан) · `unauthorized` (в т. ч. «Сессия завершена»).

## Сценарии приложения

**Регистрация / вход.** `register` или `login` → сохранить `accessToken` → `GET /me`.

**Вход через Telegram (для старых клиентов).** `POST /auth/tglink/start` → открыть `url` → опрашивать `GET /auth/tglink/:token` до `ok` → `accessToken`. После входа предложить добавить почту и пароль: `POST /me/credentials`.

**Привязка Telegram.** `POST /me/telegram/link/start` → открыть `url` (бот спросит подтверждение) → опрашивать `GET /me/telegram/link/:token` до `ok` → обновить `GET /me` (`tgId`).
Если Telegram уже принадлежит другому аккаунту с данными, бот ответит отказом и привязка не произойдёт (слияние аккаунтов не поддерживается). Пустой аккаунт, который бот создал при первом сообщении, объединяется автоматически.

**Сброс пароля.** `POST /auth/email/reset/start` → открыть `url` → опрашивать `GET /auth/email/reset/:token`; при `ok` показать форму нового пароля → `POST /auth/email/reset/complete` → `accessToken`. Если у аккаунта нет привязанного Telegram, бот откажет: восстановление только через поддержку.

**Шлюз и пробный период.** `GET /me` отдаёт `gate` (`needTelegram`) и `trialAvailable`. Пробный период и шлюз канала для аккаунта без Telegram блокируются кодом `telegram_required`: показать экран «Привяжите Telegram».

## Безопасность
- Пароли: scrypt. Подбор: лимиты запросов по IP, блокировка аккаунта на 15 минут после 5 неудач, одинаковые ответы и время для неизвестной почты.
- Токены сброса и привязки: одноразовые, 10 минут, подтверждаются только ботом по Telegram id.
- Не логировать токены и ссылки подписки.
