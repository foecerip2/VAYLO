#!/usr/bin/env bash
# Восстановление БД проекта из бэкапа:
#   sudo bash scripts/restore.sh backups/vpn-XXXX.sql.gz [--yes] [--keep-queues]
#
# Порядок работы:
#   1. проверяет архив (gzip -t) — до того, как что-либо трогать;
#   2. делает страховочный бэкап текущей БД (scripts/backup.sh, метка pre-restore);
#   3. останавливает api, worker, bot (и гарантированно запускает их обратно при любом исходе);
#   4. загружает дамп во временную базу vpn_restore одной транзакцией (ON_ERROR_STOP);
#      при ошибке текущая база остаётся нетронутой;
#   5. подменяет базу vpn восстановленной и очищает очереди BullMQ в Redis (задания ссылаются на
#      записи старой базы; периодические задания воркер создаёт заново при запуске).
#
#   --yes          не спрашивать подтверждение
#   --keep-queues  не очищать очереди BullMQ в Redis
# Настройки (deploy/.env и др.) этот скрипт не восстанавливает — см. INSTALL.md, раздел «Бэкап и восстановление».
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die()  { echo "Ошибка: $*" >&2; exit 1; }
info() { echo "==> $*"; }
warn() { echo "Предупреждение: $*" >&2; }

YES=0; KEEP_QUEUES=0; FILE=""
for a in "$@"; do
  case "$a" in
    --yes|-y) YES=1 ;;
    --keep-queues) KEEP_QUEUES=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) die "неизвестный параметр: $a" ;;
    *) [ -z "$FILE" ] || die "укажите только один файл бэкапа"; FILE="$a" ;;
  esac
done
[ -n "$FILE" ] || die "укажите файл бэкапа, например: sudo bash scripts/restore.sh backups/vpn-20250101-033000.sql.gz"

# Путь к файлу вычисляем ДО смены каталога (относительный путь считается от текущего каталога)
[ -f "$FILE" ] || die "файл не найден: $FILE"
FILE="$(realpath -e -- "$FILE")" || die "не удалось определить полный путь к файлу: $FILE"
[ -r "$FILE" ] || die "нет прав на чтение файла: $FILE"
case "$FILE" in
  *.tar.gz) die "это архив настроек, а не дамп БД. Нужен файл vpn-ДАТА.sql.gz (настройки восстанавливаются вручную, см. INSTALL.md)" ;;
  *remnawave-db-*) die "это дамп БД Remnawave, а не проекта. Его восстановление описано в INSTALL.md" ;;
esac

info "Проверяю архив $FILE"
gzip -t "$FILE" 2>/dev/null || die "архив повреждён (gzip -t): $FILE. Ничего не изменено."
gunzip -c "$FILE" | tail -n 20 | grep -q 'PostgreSQL database dump complete' \
  || die "дамп неполный (нет отметки об окончании pg_dump): $FILE. Ничего не изменено."

[ "$(docker inspect -f '{{.State.Running}}' vpn-postgres 2>/dev/null || true)" = true ] \
  || die "контейнер vpn-postgres не запущен. Запустите: cd $ROOT/deploy && docker compose up -d postgres redis"

if [ "$YES" != 1 ]; then
  echo "ВНИМАНИЕ: все текущие данные БД проекта будут заменены данными из"
  echo "  $FILE"
  echo "Перед этим будет сделан страховочный бэкап текущей БД. Сервис будет недоступен 1–2 минуты."
  ans=""
  if [ -t 0 ]; then read -r -p "Продолжить? Введите yes: " ans; else read -r -p "Продолжить? Введите yes: " ans </dev/tty || true; fi
  [ "$ans" = yes ] || die "отменено, ничего не изменено"
fi

info "Делаю страховочный бэкап текущей БД"
BACKUP_NO_ROTATE=1 BACKUP_TAG=pre-restore bash "$ROOT/scripts/backup.sh" \
  || die "страховочный бэкап не удался — восстановление отменено, ничего не изменено"

psql_admin() { docker exec -i vpn-postgres psql -X -q -v ON_ERROR_STOP=1 -U vpn -d postgres "$@"; }

STOPPED=0
restart_services() {
  local rc=$?
  if [ "$STOPPED" = 1 ]; then
    info "Запускаю api, worker, bot"
    (cd "$ROOT/deploy" && docker compose start api worker bot) \
      || warn "не удалось запустить сервисы. Выполните вручную: cd $ROOT/deploy && docker compose up -d"
  fi
  if [ "$rc" != 0 ]; then
    echo "Восстановление НЕ выполнено. Если база vpn была изменена — страховочный бэкап с меткой pre-restore лежит в $ROOT/backups" >&2
  fi
}
trap restart_services EXIT
trap 'exit 130' INT TERM

info "Останавливаю api, worker, bot"
STOPPED=1
(cd "$ROOT/deploy" && docker compose stop api worker bot) || die "не удалось остановить сервисы"

info "Загружаю дамп во временную базу vpn_restore"
psql_admin -c 'drop database if exists vpn_restore' -c 'create database vpn_restore owner vpn' \
  || die "не удалось создать временную базу vpn_restore"
if ! gunzip -c "$FILE" | docker exec -i vpn-postgres psql -X -q -v ON_ERROR_STOP=1 --single-transaction -U vpn -d vpn_restore >/dev/null; then
  psql_admin -c 'drop database if exists vpn_restore' || true
  die "ошибка при загрузке дампа (вывод psql выше). Текущая база vpn НЕ изменена."
fi

info "Подменяю базу vpn восстановленной"
psql_admin -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('vpn','vpn_restore') and pid <> pg_backend_pid()" >/dev/null || true
psql_admin -c 'drop database if exists vpn_before_restore' \
  || die "не удалось удалить старую базу vpn_before_restore"
psql_admin -c 'alter database vpn rename to vpn_before_restore' \
  || die "не удалось переименовать текущую базу (кто-то подключён?). Текущая база vpn НЕ изменена."
if ! psql_admin -c 'alter database vpn_restore rename to vpn'; then
  psql_admin -c 'alter database vpn_before_restore rename to vpn' || true
  die "не удалось подменить базу; возвращена прежняя база vpn"
fi
psql_admin -c 'drop database if exists vpn_before_restore' \
  || warn "не удалось удалить базу vpn_before_restore (старые данные). Удалите вручную позже."

if [ "$KEEP_QUEUES" != 1 ]; then
  info "Очищаю очереди BullMQ в Redis (ключи bull:*)"
  docker exec vpn-redis sh -c "redis-cli --scan --pattern 'bull:*' | xargs -r -n 200 redis-cli UNLINK >/dev/null" \
    || warn "не удалось очистить очереди в Redis — проверьте рассылки в админке после запуска"
fi

echo "Восстановлено из $FILE"
