# VAYLO VPN — Master Implementation Blueprint для AI-разработчика

**Версия плана:** 1.0 · **Дата:** 2026-10-29 · **Исходный релиз:** `vpn-platform-v56-network-probe.zip`  
**Назначение:** техническое задание для поэтапного внедрения шести направлений развития в существующую платформу VAYLO.  
**Достоверность:** выполнен статический обзор структуры и ряда ключевых исходников. Проект не запускался с PostgreSQL, Redis, Remnawave, Telegram и реальными SIM; эксплуатационная работоспособность новых функций не доказана. Все нижеописанные пути новых файлов — **предлагаемые к созданию**, а не утверждение, что они существуют.

## 0. Жёсткие ограничения

1. **Не переписывать платформу с нуля.** Сохранять Fastify + TypeScript, React/Vite, PostgreSQL, Redis/BullMQ, grammY, существующий pnpm-workspace и deployment через Docker Compose/Caddy.
2. Продакшен и секреты не трогать без отдельного разрешения владельца. Разрабатывать сначала локально/staging, за feature flags.
3. Не изменять логику списания средств, идемпотентность webhook, выдачу и продление Remnawave-доступа или выдаваемые клиентам ссылки без отдельного плана, регрессионных тестов и согласования.
4. **Никогда не обещать обход блокировок:** реальная доступность зависит от сети, оператора, устройства, клиента, времени и протокола; тесты из браузера не доказывают работу VLESS.
5. Не логировать секреты, приватные URL подписок, UUID, Reality private keys, платёжные токены, сообщения поддержки целиком, списки посещённых сайтов или содержимое VPN-трафика.
6. База данных: исключительно новые аддитивные миграции `024_...sql` и далее; миграции 001–023 не редактировать задним числом. Перед созданием убедиться, что номер не занят в актуальной ветке.
7. Любое автодействие с нодами только после явного подтверждения администратора на начальных этапах. На старте рекомендация ≠ автоматическое переключение.
8. Любое AI-решение, затрагивающее пользователя, оплаченные услуги или инфраструктуру, проверяется серверными ограничениями; AI не получает полномочия обходить права доступа.

## 1. Подтверждённая карта репозитория

```text
apps/api/src/app.ts                       # регистрация Fastify маршрутов /api/v1
apps/api/src/routes/public.ts             # публичные маршруты и приём проб
apps/api/src/routes/admin/index.ts        # существующий admin API /admin
apps/api/src/routes/support.ts            # API поддержки
apps/api/src/routes/webhooks.ts           # платёжные webhook: сохранить
apps/api/src/services/netprobe.ts         # сетевые пробы, ASN, статусы и алерты
apps/api/src/services/monitor.ts          # существующий мониторинг
apps/api/src/services/support.ts          # поддержка, существующий AI fallback
apps/api/src/services/stats.ts            # текущие агрегаты
apps/api/src/services/adminReports.ts     # текущая отчётность
apps/api/src/services/payments.ts         # критичный платёжный контур
apps/api/src/services/subscriptions.ts    # критичный контур подписок
apps/api/src/services/remnawave.ts        # интеграция Remnawave
apps/api/src/services/alerts.ts           # уведомления администраторов
apps/api/src/services/settings.ts         # система настроек
apps/api/src/db/migrate.ts                # runner миграций
apps/api/migrations/023_netprobe.sql      # последняя найденная миграция в архиве
apps/api/src/worker.ts                    # BullMQ, net-tick, monitor, отчёты
apps/admin/src/App.tsx                    # навигация админки
apps/admin/src/pages/Network.tsx          # существующий UI сети
apps/admin/src/pages/Monitoring.tsx       # существующий UI мониторинга
apps/admin/src/pages/Dashboard.tsx        # текущий обзор
apps/admin/src/pages/Nodes.tsx            # существующая страница нод
apps/admin/src/pages/Support.tsx          # поддержка
apps/app/src/App.tsx                      # роуты Mini App
apps/app/src/pages/Locations.tsx          # локации
apps/app/src/pages/Connect.tsx            # подключение
apps/app/src/pages/Help.tsx               # помощь
apps/app/src/lib/netprobe.ts              # браузерные эвристические тесты
packages/ui/src/components.tsx            # общие UI компоненты
packages/ui/src/styles.css                # общие стили
packages/ui/src/theme.ts                  # тема
packages/shared/src/index.ts             # общий код
scripts/vless-probe/probe.mjs             # реальный внешний Xray probe
.github/workflows/ci.yml                 # существующий CI
scripts/                                    # установщики/операционные скрипты
deploy/docker-compose.yml                 # контейнерный deployment
deploy/.env.example                       # шаблон окружения
SECURITY.md, INSTALL.md, README.md        # документация
NETWORK-PROBE-UPDATE.md                   # заметки текущей реализации v56
```

### Принцип модификаций

- Изменения в `app.ts` и `admin/index.ts` минимальны: подключение **новых автономных route plugins**, не превращать огромный файл в ещё больший.
- Не создавать дубли существующего `netprobe`, `monitor`, `stats`, `support`; выделять рядом небольшие сервисы, повторно использовать текущие таблицы и функции.
- Проверять в исходном коде действующие guard/auth, типы ответов, query layer, настройки и стандарты компонентов до написания новой логики. Имена новых API ниже — предложение, а не уже работающие эндпоинты.

## 2. Приоритизация: 6 направлений и этапы

| Фаза | Направление | Приоритет | Поставляемый результат | Зависит от |
|---|---|---|---|---|
| 0 | Baseline, контрактная инвентаризация | P0 | отчёт о текущем поведении, staging | — |
| 1 | Надёжность и безопасность | P0 | ограниченные probe-токены, алерты, секреты, восстановление | 0 |
| 2 | Умный мониторинг | P0 | надёжные измерения, инциденты, оператор × ОС × нода | 1 |
| 3 | Автоподбор ноды (сначала рекомендация) | P1 | объяснимый ранжировщик, ручной выбор, fallback | 2 |
| 4 | Бизнес-аналитика | P1 | события и финансовые метрики, воронка и когорты | 1 |
| 5 | AI-помощник | P1 | безопасная база знаний, подсказки, эскалация | 1,2 |
| 6 | Современный UI/UX | P1–P2 | единый дизайн, доступность, адаптивность, визуализации | 2–5 |
| 7 | Hardening, canary, rollout | P0 | нагрузочные/интеграционные тесты, playbook | все |

**Рекомендуемая последовательность PR:** PR-00 baseline → PR-01 probe auth/security → PR-02 retention/observability → PR-03 incident engine → PR-04 network dashboard → PR-05 node scoring → PR-06 node UX → PR-07 analytics events → PR-08 analytics dashboards → PR-09 AI support hardening → PR-10 UI design system → PR-11 regression/deploy. Не соединять все направления в один гигантский PR.

## 3. Фаза 0 — исходная проверка (обязательно)

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
# опционально: docker compose -f deploy/docker-compose.yml config
```

Дополнительно: собрать `git status`, `node --version`, версии pnpm/БД/Xray, список текущих feature flags, admin guards и API contracts. Посмотреть `NETWORK-PROBE-UPDATE.md` и `docs/SUPPORT-AI.md`. Зафиксировать baseline в **новом** `docs/engineering/BASELINE.md`: что прошло/упало, ошибки, ограничения окружения. Никаких фиктивных зелёных тестов. Отдельно прогнать проверку секретов на своей машине; **не загружать секреты в сторонний AI**.

## 4. Фаза 1 — безопасность, надёжность, наблюдаемость

### Изменяемые файлы

| Файл | Ожидаемое изменение |
|---|---|
| `apps/api/src/routes/public.ts` | Убрать зависимость endpoint `/net/probe-report` от широко привилегированного общего ключа; валидация отдельного ключа, scope, размера payload, rate limiting |
| `apps/api/src/services/netprobe.ts` | Нормализация и обрезка detail; изолированные доверенные источники; дедупликация событий |
| `scripts/vless-probe/probe.mjs` | Отдельный `NETPROBE_WRITE_TOKEN`, ретраи с jitter, bounded timeout, без логирования приватных подписок |
| `apps/api/src/config.ts`, `deploy/.env.example` | Новые секреты/feature flags с безопасными значениями по умолчанию |
| `apps/api/src/worker.ts` | Очередь incident reconciliation, retention task, worker health/heartbeat; без блокирующих длинных сетевых операций |
| `apps/api/src/services/alerts.ts` | Кулдаун и восстановление, уважение severity, дедупликация |
| `deploy/docker-compose.yml` | Healthchecks, restart policy, ограничения ресурсов по возможности, корректная зависимость сервисов |
| `.github/workflows/ci.yml` | Проверка миграций, dependency/secret checks, regression test jobs (без production credentials) |

**Новые файлы (предлагаемые):** `apps/api/src/lib/probeAuth.ts`, `apps/api/src/services/retention.ts`, `apps/api/src/services/workerHealth.ts`, `apps/api/migrations/024_probe_security.sql` (если нужна БД под токены; предпочтительны hashed scoped tokens), `docs/runbooks/INCIDENTS.md`, `docs/runbooks/RESTORE.md`.

### Security правила

- Хранить **хэш** probe-токена, `probe_id`, `scopes`, статус отзыва, срок действия, последнюю активность; показ значения только один раз при выпуске. Разрешены `probe:write`, `probe:read` только явно; никакого admin scope.
- Защититься от SSRF: probe target из server-maintained allowlist; не принимать от клиента произвольный URL для серверного fetch.
- Валидировать body через существующую Zod-практику, ограничить counts (например ≤30 результатов) и длины полей, допустимые `kind`, не позволять `NaN`, отрицательные тайминги или даты далеко в будущем.
- Минимизация персональных данных: согласие на клиентские замеры, TTL raw results (предварительный ориентир 14–30 дней, согласовать), более долгий TTL только обезличенных агрегатов; без полного IP. Экспорт/удаление по действующей политике.
- Логи: request-id, компонент, тип ошибки, без credentials; аудировать выдачу/отзыв токенов.
- Секреты из `env`/secret store; обновить инструкции по ротации и процедуру инцидента.

### Приёмка PR-01/02

1. Старый общий `INTERNAL_KEY` **не принимается** в новом контуре probe, другие legacy endpoint не ломаются.
2. Недействительный/отозванный/истёкший ключ: 401 или 403; без секретов в ответе/логе.
3. Попытки отправить произвольный URL, чрезмерный массив, malformed fields: 4xx без side effects.
4. Рабочая probe с новым токеном успешно записывает допустимую пробу в staging; audit содержит факт приёма, не токен.
5. Проверка backup/restore выполнена в изолированном staging, задокументированы фактические RTO/RPO (не выдуманы).
6. Если Redis/Remnawave недоступны, финансовые операции не повреждаются; worker восстанавливается после перезапуска.

## 5. Фаза 2 — умный мониторинг VPN (Network Intelligence)

### Источники и их доказательность

- `browser_heuristic`: быстрый HTTPS fetch, доступность API/сайта, **не** подтверждает работу VLESS.
- `real_xray_probe`: настоящий тест подключения через Xray-core с зафиксированной версией/конфигурацией; наиболее весомый источник для данного маршрута и данной сети.
- `client_report`: добровольное сообщение пользователя, полезно для диагностики, но не является автоматическим измерением.

Разделять источники в API, БД, графиках, SLA. В агрегате считать отдельно success_rate и confidence; не объединять источник с принципиально другой семантикой.

### Новые файлы

```text
apps/api/src/services/networkIncidents.ts
apps/api/src/services/networkAggregates.ts
apps/api/src/services/networkHealthScore.ts
apps/api/src/routes/admin/networkIntelligence.ts
apps/api/src/routes/networkStatus.ts             # ограниченный user-facing read-only API
apps/api/migrations/025_network_intelligence.sql
apps/admin/src/components/network/HealthMatrix.tsx
apps/admin/src/components/network/IncidentTimeline.tsx
apps/admin/src/components/network/ProbeEvidence.tsx
apps/admin/src/components/network/NetworkFilters.tsx
apps/admin/src/pages/NetworkIntelligence.tsx
apps/api/src/services/networkIncidents.test.ts
apps/api/src/services/networkAggregates.test.ts
```

Изменить: `apps/api/src/services/netprobe.ts`, `apps/api/src/worker.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/admin/index.ts` (только register), `apps/admin/src/App.tsx`, `apps/admin/src/pages/Network.tsx` (ссылка/совместимость), `apps/app/src/lib/netprobe.ts` (явная подпись эвристики).

### Модель данных (дизайн, согласовать с 023_netprobe.sql)

- `probe_agents`: id, public label, operator claim, region bucket, platform, xray_version, status, last_seen_at, created_at. **Не доверять** self-reported оператору без аттестации/подтверждения источника.
- `network_samples_v2`: probe_id, source, node_ref, transport, fingerprint_hint (без секретов), os, operator, region_bucket, success, connect_ms, duration_ms, failure_class, collected_at, received_at. Не дублировать необоснованно `net_probes`; возможно расширение текущей таблицы аддитивными nullable полями и `source`-маппинг.
- `network_incidents`: id, scope_hash, scope JSONB, state (`suspected`,`confirmed`,`recovering`,`resolved`), severity, started_at, ended_at, evidence_count, updated_at.
- `incident_events`: incident_id, time, transition, evidence_summary, author_type, note; аудит ручных решений.
- `network_rollups_hourly`: окна/разрезы, sample count, success count, p50/p95, updated_at, evidence_source.

Учитывать индексы по `(collected_at, source, node_ref)` и `(operator, os, collected_at)`; retention партиционирование — только если оправдано объёмом. `node_ref` — безопасный внутренний идентификатор, не раскрывать IP/host пользователю. Никакие новые поля не должны требовать изменения старых строк (nullable/backfill).

### Контракты API (новые, предлагаемые)

- `GET /api/v1/admin/network-intelligence/summary?window=24h&operator=beeline&os=ios` — агрегаты + `sample_count`, `confidence`, `updated_at`.
- `GET /api/v1/admin/network-intelligence/incidents?state=active` — список инцидентов, сортировка.
- `GET /api/v1/admin/network-intelligence/incidents/:id` — evidence timeline и операции read-only.
- `POST /api/v1/admin/network-intelligence/incidents/:id/ack` — ручное подтверждение с audit и RBAC.
- `GET /api/v1/network/status` — **только публичные безопасные статусы** без inventory адресов нод, приватных ключей и подробностей блокировок.

Права: использовать действующий guard админки; client status должен быть ограничен текущим пользователем и доступными ему локациями. Пагинация, капы диапазонов и серверное кэширование обязательны.

### Инциденты и алерты

1. Новое `suspected` при ≥3 отрицательных *независимых* Xray измерениях от зарегистрированного источника в заданном rolling window (значения вынести в конфиг).
2. `confirmed` только после независимого подтверждения из 2 разных проб/каналов или с ручным подтверждением оператора. Для сети с одной SIM — оставлять `suspected`.
3. `recovering` при последовательно успешных результатах; `resolved` после порога устойчивого восстановления.
4. Гистерезис, дедупликация по node/operator/OS/transport, cooldown уведомлений, контроль качества свежести.
5. **Не** считать отсутствие проб за успех; показывать `unknown`/`stale`.

### UI

Админка: переключатели 30 мин / 24 ч / 7 дней, матрица оператор × ОС, разрез нода × транспорт, график успешности, severity, последние события, список проб, timestamp и **размер выборки**. Для малых выборок (`n<10` как стартовый UI-порог) явно показывать «Недостаточно данных». Никаких псевдоточных процентов без доказательства.

### Приёмка PR-03/04

- Unit: пороги, гистерезис, одинаковые report-id, stale/unknown, смешение browser/Xray исключено.
- Integration: миграции на пустой и существующей БД, права админа, запросы с диапазонами, TTL.
- E2E: реальная Xray probe в staging + тест с Beeline iPhone и как минимум другой независимой сетью; если SIM нет — статус «не проверено», не «работает».
- Дашборд при нуле проб показывает empty state; 500 при плохой записи не допускается; API не раскрывает токены/приватные ноды.

## 6. Фаза 3 — автоподбор лучшей ноды (recommender, не скрытый автосвитч)

### Дизайн

Алгоритм получает **только допустимые пользователю** ноды по действующей Remnawave/подписочной логике. Сначала фильтрует `active`, `entitled`, `not in confirmed incident`, затем оценивает:

```text
score = 0.45 * availability_evidence
      + 0.20 * latency_score
      + 0.15 * stability_score
      + 0.10 * freshness_score
      + 0.10 * load_score
      - penalties(stale, low_samples, incidents)
```

Веса **стартовая гипотеза**, не эмпирически оптимальные. Нормировать все компоненты в [0,1], документировать fallback; `unknown` не интерпретировать как 100% доступность. Персонализировать лишь с согласия, по оператору/платформе/разрешённой coarse region; не привязываться к истории сайтов. Показать объяснение: «Рекомендуем: последние успешные проверки из сети X, n=..., измерено ...». Без надёжных данных отдавать обычный список локаций без победителя.

### Файлы

**Создать:**

```text
apps/api/src/services/nodeRanking.ts
apps/api/src/services/nodeRanking.test.ts
apps/api/src/routes/nodeRecommendations.ts
apps/app/src/components/locations/RecommendedNode.tsx
apps/app/src/components/locations/NodeHealthHint.tsx
apps/app/src/components/locations/NodeCompare.tsx
apps/admin/src/pages/NodeRecommendations.tsx
```

**Изменить:** `apps/api/src/app.ts`, `apps/api/src/services/remnawave.ts` (read-only адаптер при необходимости), `apps/app/src/pages/Locations.tsx`, `apps/app/src/pages/Connect.tsx`, `apps/admin/src/App.tsx`, `apps/admin/src/pages/Nodes.tsx` (наблюдаемость модели). БД необязательна для MVP; параметры хранить в существующих settings, если поддерживается безопасная миграция типов.

### API

`GET /api/v1/nodes/recommendations?os=ios` → `{ recommendedNodeId?: string, ranked: [{ nodeId, label, quality: 'high'|'medium'|'unknown', confidence, evidenceCount, checkedAt, reasons: string[] }], mode: 'evidence'|'fallback' }`. На сервере авторизация и entitlement-filter, клиент не передаёт произвольные права/список нод. `nodeId` opaque; в ответе нет server IP или секретов.

### Приёмка PR-05/06

- Никогда не рекомендует недоступную по тарифу/отключённую ноду.
- Не рекомендует «лучшую» при устаревших/скудных или только браузерных результатах.
- Подделка `operator/os` не даёт доступа к чужим подпискам/нодам.
- С отключённым flag старая страница выбора работает без изменений.
- Есть ручной выбор, объяснение рекомендаций, снижение трафика запросов, состояния offline/empty/error.
- Ни одна операция не меняет Xray конфигурацию автоматически.

## 7. Фаза 4 — бизнес-аналитика

### Единые определения, которые утверждает владелец

- Воронка: `bot_start → miniapp_open → trial_started → checkout_started → payment_succeeded → access_fulfilled → renewed`.
- `gross_revenue` = сумма подтверждённых входящих платежей за период до refunds/fees; `net_revenue` = учитывает refunds и применимые fees (если достоверно доступны).
- `MRR` только как нормализованная **оценка периодической выручки** из действующих платных подписок; не выдавать за бухгалтерскую выручку и не смешивать с денежными поступлениями.
- `ARPPU` = периодическая выручка / число платящих пользователей в периоде; если пользователь хочет ARPU — / всех активных пользователей, явно определить активность.
- Cohort retention / churn: определить от paid-first или trial-first, учитывать renewals и отмены.
- Атрибуция по Telegram campaign/referral — только когда первоисточник действительно известен, иначе `unknown`.

### Создать

```text
apps/api/migrations/026_product_analytics.sql
apps/api/src/services/analyticsEvents.ts
apps/api/src/services/analyticsFunnel.ts
apps/api/src/services/analyticsRevenue.ts
apps/api/src/services/analyticsCohorts.ts
apps/api/src/routes/admin/analytics.ts
apps/admin/src/pages/Analytics.tsx
apps/admin/src/components/analytics/FunnelChart.tsx
apps/admin/src/components/analytics/RevenueTrend.tsx
apps/admin/src/components/analytics/CohortHeatmap.tsx
apps/api/src/services/analyticsRevenue.test.ts
```

**Изменить минимально:** `apps/api/src/services/payments.ts`, `apps/api/src/services/subscriptions.ts`, `apps/api/src/services/stats.ts`, `apps/api/src/services/adminReports.ts`, `apps/api/src/routes/admin/index.ts`, `apps/admin/src/App.tsx`, `apps/admin/src/pages/Dashboard.tsx`, при необходимости bot handlers (найти по `apps/bot/src` и зарегистрированным обработчикам), `apps/app/src/main.tsx` (только событие запуска с consent/легальным основанием).

`product_events`: `event_id` idempotency, `event_name`, `user_id` nullable, `session_id` pseudonymous, `source`, `campaign_id` nullable, `occurred_at`, `received_at`, `properties` allowlisted JSONB. Финансовые факты считать из **платежных таблиц** как источника истины, а не из клиентских событий. Не писать в product_events ни реквизиты, ни IP, ни содержимое посещённых страниц.

### API / интерфейс

- `GET /api/v1/admin/analytics/overview?from=&to=`: counts, revenue definitions, freshness, timezone.
- `GET /api/v1/admin/analytics/funnel?from=&to=&campaign=`: стадии и denominator.
- `GET /api/v1/admin/analytics/cohorts?period=month`: retention matrix с n, методикой.
- `GET /api/v1/admin/analytics/revenue?granularity=day`: суммы с валютой и статусами, не суммировать разную валюту без заданного курса.
- Фильтры периода, тарифов, источников, экспорт CSV с admin guard и rate limiting.

### Приёмка PR-07/08

- Повторный webhook/дубль события не удваивает оплату/конверсию.
- Сверка итогов аналитики с выборкой текущей таблицы payments за тестовый период в пределах обусловленного округления.
- Refund, failed, trial, promo, нулевые платежи, смена тарифа, timezone, мультивалютность обработаны согласно документированным определениям.
- Пользователь без admin role не может получить аналитические данные.
- Нет tracking пользователей VPN-трафика; честный empty state, n и `data_as_of`.

## 8. Фаза 5 — AI-помощник поддержки

**Не строить второй чат с нуля:** в `apps/api/src/services/support.ts` уже есть существующая AI-логика и fallback; `docs/SUPPORT-AI.md` описывает текущую схему. Доработать существующий контур.

### Файлы

**Создать:**

```text
apps/api/src/services/supportKnowledge.ts
apps/api/src/services/supportSafety.ts
apps/api/src/services/supportTriage.ts
apps/api/src/services/supportAiEval.test.ts
apps/api/src/routes/admin/supportKnowledge.ts
apps/admin/src/pages/SupportKnowledge.tsx
support/knowledge/troubleshooting.md
support/knowledge/payment-faq.md
support/knowledge/ios-clients.md
support/knowledge/network-status.md
```

**Изменить:** `apps/api/src/services/support.ts`, `apps/api/src/routes/support.ts`, `apps/api/src/routes/admin/support.ts`, `apps/admin/src/pages/Support.tsx`, `apps/app/src/pages/Support.tsx`/`SupportThread.tsx`, `apps/api/src/services/netprobe.ts` только через безопасный read-only status adapter.

### Поведение

1. Использовать существующую модель/провайдера AI, а не добавлять дорогую новую зависимость без обоснования.
2. Отвечать на основе allowlisted FAQ/runbooks, актуального состояния сервиса; показывать ограничение «не могу подтвердить» при отсутствии данных.
3. При симптомах обрыва через 10–15 минут: уточнить ОС/приложение/оператор/время; дать диагностические действия без сбора приватных ключей и URLs.
4. Уметь классифицировать `network`, `subscription`, `payment`, `app`, `unknown` и предлагать оператору краткое резюме с PII-redaction.
5. Для платежных спорных случаев, запроса рефанда, блокировки, доступа к аккаунту или изменения ноды — эскалация человеку; **AI не выполняет** платежных операций и изменение инфраструктуры.
6. Prompt injection: сообщения клиентов и результаты tools — недоверенные данные, не системные инструкции. Не выполнять команды и HTTP URL из чата.
7. Consent и retention для истории разговоров; ограничение токенов/скорости/затрат, fallback на человека при ошибках AI.

### Приёмка PR-09

- Набор ≥30 проверочных сценариев: нормальные FAQ, несвязанные вопросы, русская речь, ошибки оплаты, падение сети, jailbreak/prompt injection, просьбы раскрыть админский API key, ошибочные уверенные ответы.
- 0 раскрытий секретов в тестах, 0 неавторизованных действий, корректная передача оператору и отсутствие ложного «исправлено».
- Отказ AI-провайдера не ломает создание обычного тикета.
- Логи/трассы не содержат необработанных токенов и полного содержания диалогов.

## 9. Фаза 6 — современный UI/UX

### Визуальное направление

Сохранить узнаваемый VAYLO / neon / orbit, но усилить функциональность. На мобильных сначала читабельные короткие карточки; в админке — плотная аналитика, фильтры, chart drill-down. Не замедлять подключение тяжёлыми 3D-анимациями; учитывать `prefers-reduced-motion`. Контраст WCAG AA как целевое требование, касания ≥44x44 CSS px, корректные safe-area в Telegram WebView.

### Карта экранов

| Раздел | Изменить/создать | Показать |
|---|---|---|
| Mini App Home | `apps/app/src/pages/Home.tsx` | состояние подписки + рекомендация + один CTA |
| Mini App Locations | `apps/app/src/pages/Locations.tsx` | список локаций, badges доказанной доступности, объяснение |
| Mini App Connect | `apps/app/src/pages/Connect.tsx` | 3-шаговое подключение, fallback, приложения iOS/Android |
| Mini App Help | `apps/app/src/pages/Help.tsx` | мастер диагностики + эскалация |
| Admin Dashboard | `apps/admin/src/pages/Dashboard.tsx` | здоровье сервиса + деньги + инциденты |
| Admin Network | `apps/admin/src/pages/Network.tsx`, новая `NetworkIntelligence.tsx` | тепловая матрица/фильтры/таймлайн |
| Admin Analytics | новая `apps/admin/src/pages/Analytics.tsx` | финансовые KPI, cohorts, funnel |
| Admin Support | `apps/admin/src/pages/Support.tsx` | AI summary, SLA, очередь операторов |
| UI kit | `packages/ui/src/components.tsx`, `styles.css`, `theme.ts` | tokens, skeleton, empty/error, accessible components |

**Создать:** `packages/ui/src/status-components.tsx`, `packages/ui/src/chart-components.tsx` (только при оправданной общей повторяемости), `docs/design/VAYLO-DESIGN-SYSTEM.md`, `apps/app/src/components/ConnectionWizard.tsx`. Подключать новую библиотеку графиков только после проверки существующих зависимостей и bundle size.

### UX критерии

- Все шесть экранов: loading / success / empty / stale / error / offline.
- iPhone Safari/Telegram WebView, Android WebView, desktop admin; тест минимум 360px и 390px ширины + desktop.
- Навигация не ломает открытые мини-приложения; Telegram back button, safe-area, dark/light.
- Core Web Vitals и размер JS измерить **до/после**, пороги установить по baseline; без обещаний конкретных миллисекунд заранее.
- Параметр reduced-motion фактически отключает параллакс/интенсивные анимации; клавиатура и screen reader проходят сквозные сценарии.

## 10. Миграции и совместимость

Порядок миграций предполагаемый: `024_probe_security.sql` → `025_network_intelligence.sql` → `026_product_analytics.sql`. Сначала прочитать `apps/api/src/db/migrate.ts` и структуру 023, проверить поддержку SQL транзакций, индексов, существующих constraints и lock budget. Только add columns/tables/indexes, concurrent indexes — отдельно, если runner поддерживает. Old build + new schema должны работать во время canary. Обратимый rollback в первую очередь флагом/кодом; **не делать автоматический DROP** данных при откате версии. Написать `docs/runbooks/MIGRATIONS.md` с forward-fix и безопасным восстановлением.

## 11. Матрица feature flags (по умолчанию OFF)

```text
NETPROBE_SCOPED_AUTH=true             # включать в staging сначала, legacy-ключ выводить отдельно
NETWORK_INTELLIGENCE_ENABLED=false
NETWORK_INCIDENT_ALERTS_ENABLED=false
NODE_RECOMMENDATIONS_ENABLED=false
PRODUCT_ANALYTICS_ENABLED=false
SUPPORT_AI_KNOWLEDGE_ENABLED=false
UI_V2_ENABLED=false
```

Названия конфигурационных ключей — предложения. Проверить существующий settings API и избегать дублирования. Реальный список секретов и их значения **никогда** не добавлять в .md, кроме безопасных заглушек. Каждый флаг должен быть проверен тестом: OFF действительно возвращает старое поведение.

## 12. Тестовая стратегия и релизный gate

### Тесты

- Unit: оператор/ASN, stale confidence, ranking fallback, incident state machine, идемпотентные analytics, prompt safety.
- API integration: RBAC, authorization, malformed inputs, token expiry/revoke, payload caps, idempotency, пагинация и rate limit.
- DB integration: чистая БД; upgrade от миграции 023; сохранение старых запросов; конкурентная запись проб; retention.
- E2E: Telegram login → trial → checkout (тестовый провайдер) → payment webhook → Remnawave provision (sandbox/stub) → connect; support ticket; network probe; admin issue acknowledgement.
- Network real-world: Xray-core actual binary, iOS Beeline и ещё одна реальная сеть. Сбор краткосрочных и 15–30 минут стабильностных окон. Запись версий клиента/Xray и времени; при отсутствии оборудования — явно «not executed».
- Security: OWASP-class negative tests, секреты, RBAC, SSRF, rate limit, prompt injection.
- Reliability: рестарт API/worker, отсутствие Redis/БД/Remnawave, истёкшие auth токены, backup/restore. Платёжная идемпотентность — release blocker.
- UI: responsive, reduced-motion, iOS/Android WebView, accessibility, loading/empty/error.

### Release gates

1. `pnpm typecheck`, `pnpm test`, `pnpm build` успешны в чистом CI, исключения задокументированы и согласованы.
2. Нет новых critical/high уязвимостей в изменениях; миграции прошли staging.
3. Пробная оплата, выдача доступа и renewal в staging прошли; прежние маршруты/клиенты работают.
4. Отдельный dashboard: error rate, probe ingestion, queue backlog, support latency, analytics refresh; пороги основаны на baseline.
5. Runbook отката проверен; в canary флаги отключаемы без опасной миграции данных.
6. Только после approval → rollout 5% → 25% → 100% (при наличии механизма сегментации; иначе staging → ограниченная группа → все).

## 13. Что должно быть в каждом AI PR

```text
PR: <номер, название>
Цель и причина
Что уже реализовано / что отсутствует (со ссылками на конкретные строки)
Изменённые файлы и новые файлы
Публичные и приватные API contracts (JSON примеры + auth)
Миграция / обратная совместимость
Секреты / права / приватность
Feature flag и default OFF
Проверки: команды + фактический результат + ограничения
Скриншоты экрана и mobile/desktop states
Staging deployment и rollback
Критерии приёмки (проверяемые)
Известные проблемы и последующие PR
```

**Запрещено:** «всё готово» без команд/логов; массовый refactor не по теме; скрыто менять цены и платёжный workflow; изменять существующие миграции; запускать SQL и update скрипты на production без разрешения; сообщать AI личные данные клиентов или ключи.

## 14. Главный промпт для AI-разработчика (копировать целиком)

```text
Ты — senior full-stack engineer + security engineer + SRE проекта VAYLO VPN.

Исходники: текущий репозиторий, развернутый из vpn-platform-v56-network-probe.zip.
Основное техническое задание: docs/VAYLO_AI_MASTER_IMPLEMENTATION.md.

ПЕРЕД НАПИСАНИЕМ КОДА:
1. Прочитай ТЗ, README.md, INSTALL.md, SECURITY.md, NETWORK-PROBE-UPDATE.md,
   docs/SUPPORT-AI.md, apps/api/src/app.ts, apps/api/src/worker.ts,
   apps/api/src/routes/public.ts, apps/api/src/routes/admin/index.ts,
   apps/api/src/services/netprobe.ts, apps/api/src/services/monitor.ts,
   apps/api/src/services/support.ts, apps/api/migrations/023_netprobe.sql,
   файлы затрагиваемых экранов и авторизации.
2. Зафиксируй baseline в docs/engineering/BASELINE.md. Запусти по возможности:
   pnpm install --frozen-lockfile; pnpm typecheck; pnpm test; pnpm build.
   Явно перечисли, какие тесты не удалось запустить и почему.
3. Проверь, какие функции и API уже есть. Не дублируй действующую логику.
4. Запланируй ОДИН PR из roadmap (начни PR-00, затем PR-01).
   Для PR дай точный diff plan: старые/новые файлы, API, SQL, tests, flags.
5. Не трогай production, платежи, Remnawave provision или секреты без
   отдельного подтверждения владельца. Не печатай токены и приватные URL.

РЕАЛИЗАЦИЯ:
6. Пиши маленький, обратносуместимый код с тестами, миграциями и flag OFF.
7. Используй действующие кодовые стандарты, guard, Zod validators и
   существующие компоненты/зависимости. Отдельный API route plugin вместо
   увеличения большого admin/index.ts, если это не нарушает архитектуру.
8. Не смешивай browser heuristic с real Xray evidence.
9. Для AI-помощника включай adversarial tests, эскалацию человеку и redaction.
10. Для аналитики источником денег служат payments, client event — не деньги.

ПОСЛЕ:
11. Запусти команды проверки, покажи результат и ограничения.
12. Обнови changelog, README и runbook затронутой функции.
13. Дай полный список изменённых файлов и пошаговый staging deploy/rollback.
14. Остановись перед merge и production rollout, запроси approval.

Сейчас выполните только PR-00 (baseline и конкретный план PR-01),
не внедряйте все шесть модулей одновременно.
```

## 15. Шаблон краткого задания на каждый последующий PR

```text
Выполни PR-<NN> из docs/VAYLO_AI_MASTER_IMPLEMENTATION.md.
Сначала проверь текущее состояние репозитория и зависимости от предыдущих PR.
Дай план точных файлов и API, затем реализуй на отдельной ветке.
Все изменения строго за feature flag; staging, не prod.
Запусти unit/integration/typecheck/build; перечисли реально выполненное.
Не нарушай платежи, Remnawave, авторизацию, Telegram, существующие URL.
В конце: diff summary, test matrix, migration notes, rollback, request approval.
```

## 16. Нерешённые продуктовые решения (defaults, которые можно уточнить позднее)

1. Для авто-подбора: рекомендовать узел визуально или разрешить автоматическую установку ссылки в клиент? **Default:** рекомендовать, не менять профиль.
2. Какие сети тестировать первыми? **Default:** Beeline iPhone + независимая мобильная/домашняя сеть, по мере доступности проб.
3. Частота и хранение проб? **Default:** ограниченный sampling с TTL raw 30 дней (требует проверки правовых требований), агрегаты дольше.
4. AI-модель и бюджет? **Default:** повторно использовать текущую интеграцию с лимитами, без новой платной зависимости.
5. MRR и churn? **Default:** показывать с явными вычислительными определениями, не заменяя бухгалтерский учёт.
6. Визуальный стиль? **Default:** развитие текущего neon/orbit, не тотальный редизайн.
7. Политика rollout? **Default:** staging → ограниченный canary → полный rollout после approve.

## 17. Definition of Done всей программы

Проект считается обновлённым только если: мониторинг отделяет сетевые гипотезы от подтверждённой VLESS доступности; инциденты воспроизводимы и не флудят; рекомендации не выходят за права пользователя и не предполагают данных, которых нет; аналитика финансов сходится с платежами; AI-поддержка не получает опасных полномочий и передаёт спорные случаи оператору; UI адаптивен и доступен; recovery и безопасное обновление документированы; все критические workflow оплаты, выдачи и подключения прошли регрессии в staging; владелец утвердил production rollout.

---

**Следующий практический шаг:** поместить этот файл в `docs/VAYLO_AI_MASTER_IMPLEMENTATION.md` внутри рабочего репозитория и отправить AI-разработчику главный промпт из §14. Сначала выполнить PR-00, а не все шесть направлений разом.
