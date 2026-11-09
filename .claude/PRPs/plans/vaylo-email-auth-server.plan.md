# Plan: Серверный вход по почте и паролю (для Android-приложения VAYLO)

## Summary
Добавить в API VAYLO вход клиентов по почте и паролю: регистрация, вход, привязка почты к существующему Telegram-аккаунту, привязка Telegram к аккаунту по почте, смена пароля и сброс пароля через Telegram-бота (писем нет). Сервер уже умеет работать с пользователями без Telegram, поэтому основной объём: пароль и вход, защита от подбора и от злоупотреблений, два новых сценария в боте.

## User Story
As a клиент VAYLO на Android,
I want входить в приложение по почте и паролю,
So that мне не нужен Telegram для ежедневного пользования, а забытый пароль я могу сбросить через бота.

## Problem → Solution
У клиентов нет ни пароля, ни входа по почте (`apps/api/src/routes/public.ts:138-183` — только Telegram) → полноценная авторизация по почте с привязкой к Telegram и безопасным сбросом.

## Metadata
- **Complexity**: Large (миграция, 10 эндпоинтов, правки аутентификации, шлюза и пробного периода, бот, тесты)
- **Source PRD**: `.claude/PRPs/prds/vaylo-android-app.prd.md`
- **PRD Phase**: 2 — Серверный вход по почте (новая, добавлена по решению владельца)
- **Estimated Files**: ~14 (1 миграция, 1 сервис, 1 маршрутный файл, правки в jwt/auth/gate/subscriptions/users/types/shared/bot, 1 тестовый файл, документ API)

---

## Решения владельца (2026-11-09)
- Новые пользователи регистрируются по почте и паролю. Существующие (только Telegram) входят через Telegram и добавляют почту и пароль в профиле.
- Писем нет. Сброс пароля идёт через Telegram-бота. Почта не подтверждается.

## Следствия, которых нет в запросе (принято по умолчанию, можно изменить)
Без подтверждения почты регистрация бесплатна и анонимна, поэтому без мер аккаунты по почте обходили бы правила, которые сейчас держатся на Telegram. Найдено в коде:

| Что | Где | Проблема | Решение в плане |
|---|---|---|---|
| Обязательная подписка на канал (gate) | `apps/api/src/services/gate.ts` (`gateStatus`: `!user.tg_id` → пропуск) | Аккаунт без Telegram проходит мимо шлюза | Если шлюз включён, а у аккаунта с паролем нет Telegram, ответ `telegram_required`: нужно привязать Telegram |
| Пробный период | `apps/api/src/services/subscriptions.ts` (`startTrial`), `users.ts` (`trialAvailable`) | Бесконтрольное создание аккаунтов = бесконечные пробные периоды (защита `trial_cleanup_tombstones` работает по `tg_id`) | Пробный период только при привязанном Telegram |
| Рефералы | `users.ts` (`upsertTelegramUser`, `giveSignupBonuses`) | Фарм бонусов фиктивными аккаунтами | Регистрация по почте не принимает реферальный код |
| Сброс пароля | — | Без привязанного Telegram пароль не восстановить | Явные подсказки в приложении; резервный путь через поддержку остаётся процессом, а не кодом |
| Подбор пароля | — | Публичные эндпоинты | Лимиты запросов, блокировка аккаунта после 5 неудач на 15 минут, одинаковые ответы и время для неизвестной почты |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `apps/api/src/routes/public.ts` | 138-183 | Существующие потоки входа и токены (`/auth/miniapp`, `/auth/tglink/*`) |
| P0 | `apps/api/src/lib/auth.ts` | 20-50 | `requireUser`: JWT, бан, шлюз |
| P0 | `apps/api/src/lib/jwt.ts` | all | Подпись токенов; `verifyToken` уже читает `ep` (эпоха) |
| P0 | `apps/api/src/lib/crypto.ts` | 26-40 | `hashPassword`/`verifyPassword` (scrypt), `randomToken`, `safeEqual` |
| P0 | `apps/api/src/services/users.ts` | 16-60, 66+ | Создание пользователя, `toMe` |
| P0 | `apps/api/src/services/gate.ts` | 55-100 | Шлюз и `enforceGate` |
| P0 | `apps/api/src/services/subscriptions.ts` | 37-39, 157-185 | `rwUsernameFor` (поддерживает `tg_id = null`), `startTrial` |
| P1 | `apps/bot/src/bot.ts` | 720-780 | `/start auth_…`, подтверждение входа, паттерн callback |
| P1 | `apps/bot/src/api.ts` | all | Вызов API от имени Telegram-пользователя |
| P1 | `apps/api/migrations/001_init.sql` | 3-25, 171-177 | `users` (уже есть `email text unique`), `auth_links` |
| P1 | `apps/api/src/app.ts` | 18-70 | Ключ лимитов, глобальный лимит 240/мин, обработчик ошибок |
| P2 | `apps/api/test/appNotices.test.ts`, `closure.test.ts` | 1-30 | Образец тестов (`buildApp`, `app.inject`, моки) |
| P2 | `packages/shared/src/index.ts` | 49-82 | `MeDTO`, `GateDTO` |

## Patterns to Mirror

### PASSWORD_HASH
```ts
// SOURCE: apps/api/src/lib/crypto.ts:26-40
export async function hashPassword(password: string): Promise<string> { /* scrypt$salt$hash */ }
export async function verifyPassword(password: string, stored: string): Promise<boolean> { /* timingSafeEqual */ }
```

### ERRORS
```ts
// SOURCE: apps/api/src/lib/errors.ts:12-17
export const unauthorized = (m = 'Требуется авторизация', code = 'unauthorized') => new HttpError(401, m, code);
export const conflict = (m: string, code?: string) => new HttpError(409, m, code);
// ответ клиенту: { error: { message, code } } (apps/api/src/app.ts:77-80)
```

### TG_LINK_FLOW (поток для копирования)
```ts
// SOURCE: apps/api/src/routes/public.ts:153-182
// start: токен -> запись с TTL 10 минут, ссылка https://t.me/<bot>?start=auth_<token>
// confirm (бот, x-internal-key): помечает запись; клиент опрашивает GET и получает результат один раз
```

### RATE_LIMIT_PER_ROUTE
```ts
// SOURCE: apps/api/src/routes/public.ts:138
app.post('/auth/miniapp', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => { … })
```

### TEST_STRUCTURE
```ts
// SOURCE: apps/api/test/appNotices.test.ts:1-12
// vitest; drop/create schema + migrate() в beforeAll; app = await buildApp({ logger: false }); app.inject(...)
```

---

## Модель данных (миграция `030_email_auth.sql`)

```sql
alter table users
  add column password_hash  text,
  add column session_epoch  int not null default 0,
  add column failed_logins  int not null default 0,
  add column locked_until   timestamptz;

create table account_actions (
  token            text primary key,
  purpose          text not null check (purpose in ('tg_link','pw_reset')),
  user_id          uuid references users(id) on delete cascade,  -- null: сброс для неизвестной почты
  confirmed_at     timestamptz,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);
create index account_actions_expires_idx on account_actions (expires_at);
```
- `users.email` уже есть и уникален. В коде всегда хранится в нижнем регистре.
- `session_epoch`: меняется при смене и сбросе пароля, старые токены перестают работать (тот же приём, что у админов: `ep` в JWT).

## API (база `/api/v1`)

| Метод и путь | Доступ | Тело → ответ |
|---|---|---|
| `POST /auth/email/register` | публичный, лимит 10/час на IP | `{email, password}` → `{accessToken}`; 409 `email_taken` |
| `POST /auth/email/login` | публичный, лимит 10/мин на IP + блокировка аккаунта | `{email, password}` → `{accessToken}`; 401 `invalid_credentials`; 429 `locked` |
| `POST /auth/email/reset/start` | публичный, лимит 5/мин | `{email}` → `{token, url, expiresInSec}` (ответ одинаков для любой почты) |
| `GET /auth/email/reset/:token` | публичный | → `{status: 'pending'\|'confirmed'\|'expired'}` |
| `POST /auth/email/reset/complete` | публичный, лимит 10/мин | `{token, password}` → `{accessToken}`; токен одноразовый |
| `POST /me/credentials` | пользователь | `{email, password}` — добавить вход по почте к Telegram-аккаунту; 409 если уже есть пароль или почта занята |
| `POST /me/password` | пользователь | `{currentPassword, newPassword}` → `{accessToken}` (эпоха сессий растёт) |
| `POST /me/telegram/link/start` | пользователь (аккаунт по почте) | → `{token, url, expiresInSec}` |
| `GET /me/telegram/link/:token` | пользователь | → `{status}` |
| `POST /internal/account-action/confirm` | только бот (`x-internal-key` + `x-tg-user`) | `{token}`: привязка Telegram или подтверждение сброса |

Дополнения: `GET /me` возвращает `email` и `hasPassword`; шлюз и пробный период ведут себя, как описано в таблице выше.

Правила пароля: 8-128 символов, не равен почте. Почта: формат по `zod`, до 254 символов, нижний регистр.

## Сценарии бота (`apps/bot`)
- `/start link_<token>`: показывает подтверждение «Привязать этот Telegram к аккаунту?». Подтверждение вызывает `POST /internal/account-action/confirm`. Если этот Telegram уже принадлежит другому аккаунту, бот сообщает об этом (слияние аккаунтов вне объёма).
- `/start reset_<token>`: показывает подтверждение «Сбросить пароль для аккаунта?». При несовпадении Telegram с привязанным к аккаунту бот пишет одинаковое сообщение для всех причин: «Этот Telegram не привязан к этому аккаунту. Если не получается, напишите в поддержку».
- Пароль в бот не вводится никогда: бот только подтверждает личность, новый пароль задаётся в приложении.

## Files to Change

| File | Action | Justification |
|---|---|---|
| `apps/api/migrations/030_email_auth.sql` | CREATE | Колонки и таблица |
| `apps/api/src/services/emailAuth.ts` | CREATE | Регистрация, вход, блокировка, сброс, привязки |
| `apps/api/src/routes/emailAuth.ts` | CREATE | Маршруты |
| `apps/api/src/app.ts` | UPDATE | Регистрация маршрутов |
| `apps/api/src/lib/jwt.ts` | UPDATE | Эпоха в токене пользователя |
| `apps/api/src/lib/auth.ts` | UPDATE | Проверка эпохи |
| `apps/api/src/routes/public.ts` | UPDATE | Эпоха в существующих токенах |
| `apps/api/src/services/gate.ts` | UPDATE | `telegram_required` |
| `apps/api/src/services/subscriptions.ts` | UPDATE | Пробный период требует Telegram |
| `apps/api/src/services/users.ts` | UPDATE | `trialAvailable`, поля `email`, `hasPassword` в `toMe` |
| `apps/api/src/db/types.ts`, `packages/shared/src/index.ts` | UPDATE | Типы |
| `apps/bot/src/bot.ts` | UPDATE | Сценарии `link_` и `reset_` |
| `apps/api/test/emailAuth.test.ts` | CREATE | Тесты |
| `docs/android/API.md` | CREATE | Контракт для приложения |

## NOT Building
- Подтверждение почты и любые письма.
- Слияние двух существующих аккаунтов (Telegram-аккаунт и аккаунт по почте).
- Смена почты, удаление аккаунта, вход через Google/Apple.
- Реферальный код при регистрации по почте.
- Двухфакторная аутентификация клиентов.
- Изменения веб-кабинета (`apps/app`) и админки.

## Step-by-Step Tasks

### Task 1: Миграция и типы
- **ACTION**: Создать `030_email_auth.sql`, обновить `UserRow` и `MeDTO`.
- **MIRROR**: стиль `001_init.sql`, миграции применяются автоматически (`migrate()`).
- **GOTCHA**: `email` уже уникален, нормализация в нижний регистр только в коде; не менять старые строки.
- **VALIDATE**: `pnpm --filter @vpn/api test -- emailAuth` применяет миграцию без ошибок.

### Task 2: Эпоха сессий
- **ACTION**: `signUserToken(userId, epoch = 0)` пишет `ep`; `requireUser` сравнивает `v.ep` с `users.session_epoch`.
- **MIRROR**: `signAdminToken` и проверка в `requireAdmin` (`auth.ts`).
- **GOTCHA**: существующие токены и тесты не имеют `ep` → 0 и совпадают с эпохой 0 по умолчанию; не ломаем их. Оба production-вызова в `public.ts` передают текущую эпоху.
- **VALIDATE**: все существующие тесты проходят.

### Task 3: Сервис `emailAuth`
- **ACTION**: `register`, `login`, `startReset`, `resetStatus`, `completeReset`, `setCredentials`, `changePassword`, `startTelegramLink`, `confirmAction`.
- **IMPLEMENT**: login сравнивает с фиктивным хешем, если почты нет (одинаковое время ответа); после 5 неудач `locked_until = now() + 15 min`; успешный вход обнуляет счётчик; `completeReset` удаляет токен, меняет хеш, увеличивает `session_epoch`.
- **MIRROR**: PASSWORD_HASH, ERRORS, TG_LINK_FLOW; создание пользователя по образцу `upsertTelegramUser` (реферальный код через `randomCode(8)`, повтор при конфликте), `assertRegistrationOpen()`.
- **GOTCHA**: ответ на вход одинаков для «нет почты» и «неверный пароль»; заблокированный аккаунт отвечает 429 одинаково независимо от верности пароля; бан проверять после проверки пароля.
- **VALIDATE**: тесты Task 8.

### Task 4: Маршруты
- **ACTION**: Файл `routes/emailAuth.ts`, подключение в `app.ts`.
- **MIRROR**: RATE_LIMIT_PER_ROUTE; `zod`-схемы тела; публичные маршруты без `requireUser`, внутренний с `isInternal`.
- **GOTCHA**: внутренний эндпоинт НЕ вызывает `requireUser`, иначе он создал бы нового Telegram-пользователя (`upsertTelegramUser`); Telegram id берётся только из заголовка `x-tg-user`.
- **VALIDATE**: тесты Task 8.

### Task 5: Шлюз и пробный период
- **ACTION**: `gateStatus`: при включённом жёстком шлюзе и аккаунте с паролем без Telegram вернуть `required: true, ok: false, needTelegram: true`; `enforceGate` бросает код `telegram_required`. `startTrial` и `toMe.trialAvailable`: без Telegram пробного нет.
- **GOTCHA**: поведение для существующих пользователей без пароля не менять.
- **VALIDATE**: существующие тесты `closure`, `contests`, `trialCleanup` проходят, новые тесты на оба условия.

### Task 6: Бот
- **ACTION**: Обработать `link_` и `reset_`, добавить callback-кнопки.
- **MIRROR**: `/start auth_` и `al:`/`alk:` (`bot.ts:736-780`), ограничение длины `callback_data` (`CALLBACK_DATA_MAX`).
- **GOTCHA**: токен до 64 символов; при превышении лимита использовать тот же приём с коротким id, что у `alk:`.
- **VALIDATE**: `pnpm --filter @vpn/bot typecheck` и тесты бота, если есть.

### Task 7: Документ API
- **ACTION**: `docs/android/API.md` с таблицей эндпоинтов, кодов ошибок и сценариев приложения.

### Task 8: Тесты `emailAuth.test.ts`
- Регистрация, дубль почты, слабый пароль; вход (верный, неверный, неизвестная почта: одинаковый ответ), блокировка после 5 неудач; смена пароля и недействительность старого токена; привязка почты к Telegram-аккаунту; привязка Telegram и конфликт занятого `tg_id`; сброс (подтверждён нужным Telegram, чужой Telegram, неизвестная почта, повторное использование токена, истёкший токен); шлюз и пробный период для аккаунта без Telegram; внутренний эндпоинт без ключа даёт 401.

## Validation Commands

### Static Analysis
```bash
cd /home/user/VAYLO && pnpm -r typecheck
```
EXPECT: Zero type errors

### Tests
```bash
cd /home/user/VAYLO/apps/api && pnpm test
```
EXPECT: All tests pass (нужны PostgreSQL 16 и Redis, `TEST_DATABASE_URL`/`TEST_REDIS_URL` по умолчанию `127.0.0.1`)

## Acceptance Criteria
- [ ] Все эндпоинты работают, ответы как в таблице
- [ ] Старые токены и тесты не затронуты
- [ ] Неизвестная почта и неверный пароль неотличимы
- [ ] Шлюз и пробный период не обходятся аккаунтом по почте
- [ ] Сброс пароля работает только с привязанным Telegram и одноразовым токеном
- [ ] `pnpm -r typecheck` и все тесты проходят

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Массовая регистрация без подтверждения почты | H | Средний | Лимиты на IP; пробный и рефералы закрыты до привязки Telegram; при росте злоупотреблений добавить капчу или подтверждение |
| Забытый пароль без привязанного Telegram | H | Средний | Подсказки в приложении; процесс восстановления через поддержку |
| Утечка о существовании почты через регистрацию (`email_taken`) | M | Низкий | Принято: стандартный компромисс, лимиты на IP |
| Токены 30 дней без отзыва | M | Средний | `session_epoch` при смене и сбросе пароля |
| Конфликт при привязке Telegram, который уже принадлежит другому аккаунту | M | Низкий | Понятное сообщение; слияние отложено |

## Notes
- В проекте нет отправки писем, поэтому вся идентификация держится на Telegram. Это сознательное решение владельца.
- Для Android-приложения форма входа: почта и пароль; «Войти через Telegram» остаётся для существующих клиентов.
