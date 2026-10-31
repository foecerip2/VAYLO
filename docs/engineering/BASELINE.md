# Baseline (PR-00)

Дата: 2026-10-30. Исходник: v57 (v56 network-probe + статус серверов).

| Проверка | Результат |
|---|---|
| `pnpm -r typecheck` | v58: без ошибок |
| `pnpm build` | v58: успешно |
| `pnpm --filter @vpn/api test` | до v58: 338 тестов; после v58: 23 файла, 380 тестов — зелёные (PostgreSQL 16 + Redis локально) |
| `pnpm --filter @vpn/bot test` | 48 тестов — зелёные |

Не выполнялось и почему: реальный Xray-core (бинарь не скачивался — сеть из песочницы), реальные SIM Билайн/другие операторы, Remnawave/Telegram/платёжные провайдеры (используются моки), staging-развёртывание, нагрузочные тесты, backup/restore на живой БД (RTO/RPO не измерены и не заявляются).

Расхождения с ТЗ: миграция `024` уже занята (`024_status_servers.sql`), поэтому новые миграции — `025_probe_security`, `026_network_intelligence`, `027_product_analytics`. База знаний ИИ зашита в код (`supportKnowledge.ts`), а не в `support/knowledge/*.md`: образ API копирует только `dist` и зависимости.
