#!/usr/bin/env bash
# Резервная копия проекта: sudo bash scripts/backup.sh [каталог]   (по умолчанию <проект>/backups)
#
# Создаёт (права 600):
#   vpn-ДАТА.sql.gz          — дамп БД проекта (обязательно; при ошибке скрипт завершается с ошибкой)
#   vpn-config-ДАТА.tar.gz   — deploy/.env, deploy/*.env, deploy/caddy.d/*.caddy, CREDENTIALS.txt,
#                              а также .env/credentials/compose-файлы Remnawave из /opt/remnawave (если есть)
#   remnawave-db-ДАТА.sql.gz — дамп БД панели Remnawave (если она стоит на этом сервере; ошибки — только предупреждения)
# Файлы пишутся во временные, проверяются (gzip -t) и только потом переименовываются.
# Хранятся последние BACKUP_KEEP (14) корректных копий каждого вида.
#
# Переменные окружения:
#   BACKUP_KEEP=14         сколько копий каждого вида хранить
#   BACKUP_TAG=pre-update  метка в имени файла (буквы, цифры, - и _)
#   BACKUP_NO_ROTATE=1     не удалять старые копии (так делает restore.sh)
#   REMNAWAVE_DIR=/opt/remnawave
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/backups}"
KEEP="${BACKUP_KEEP:-14}"
RW_DIR="${REMNAWAVE_DIR:-/opt/remnawave}"
TAG="$(printf '%s' "${BACKUP_TAG:-}" | tr -cd 'A-Za-z0-9_-')"
[[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 1 ] || KEEP=14

warn() { echo "Предупреждение: $*" >&2; }
err()  { echo "Ошибка: $*" >&2; }

mkdir -p "$OUT"
chmod 700 "$OUT" 2>/dev/null || true
OUT="$(cd "$OUT" && pwd)"

# Не даём двум бэкапам (cron и ручной/обновление) идти одновременно
if command -v flock >/dev/null 2>&1; then
  exec 9>"$OUT/.backup.lock"
  flock -w 600 9 || { err "другой бэкап выполняется слишком долго (блокировка $OUT/.backup.lock)"; exit 1; }
fi

STAMP="$(date +%Y%m%d-%H%M%S)${TAG:+-$TAG}"
TMP_FILES=()
cleanup() {
  local f
  for f in ${TMP_FILES[@]+"${TMP_FILES[@]}"}; do rm -f -- "$f"; done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

new_tmp() { # new_tmp ИМЯ -> путь временного файла в каталоге бэкапов
  local t="$OUT/.$1.tmp"
  TMP_FILES+=("$t")
  : > "$t"
  printf '%s' "$t"
}

# finalize TMP ИТОГ — проверяет архив и атомарно переносит под итоговым именем
finalize() {
  local tmp="$1" final="$2"
  [ -s "$tmp" ] || { err "файл пустой: $final"; return 1; }
  gzip -t "$tmp" 2>/dev/null || { err "архив повреждён: $final"; return 1; }
  chmod 600 "$tmp"
  mv -f -- "$tmp" "$final"
  echo "Бэкап: $final ($(du -h "$final" | cut -f1))"
}

get_env() { # get_env ФАЙЛ КЛЮЧ
  grep -E "^[[:space:]]*$2=" "$1" 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

status=0

# ---------------------------------------------------------------- 1. БД проекта (обязательно)
DB_FILE="$OUT/vpn-$STAMP.sql.gz"
tmp="$(new_tmp "vpn-$STAMP.sql.gz")"
if ! docker exec vpn-postgres pg_dump -U vpn -d vpn --no-owner | gzip -9 > "$tmp"; then
  err "pg_dump не удался (запущен ли контейнер vpn-postgres?). Бэкап БД НЕ создан."
  exit 1
fi
if ! gunzip -c "$tmp" 2>/dev/null | tail -n 20 | grep -q 'PostgreSQL database dump complete'; then
  err "дамп БД неполный — бэкап БД НЕ создан."
  exit 1
fi
finalize "$tmp" "$DB_FILE" || exit 1

# ---------------------------------------------------------------- 2. Настройки (.env, caddy.d, CREDENTIALS)
cfg=()
add_cfg() { [ -f "$1" ] && [ -r "$1" ] && cfg+=("${1#/}"); return 0; }
[ -f "$ROOT/deploy/.env" ] || warn "нет $ROOT/deploy/.env — сохранять нечего (это нормально только для dev-окружения)"
for f in "$ROOT"/deploy/.env "$ROOT"/deploy/*.env "$ROOT"/deploy/.*.env "$ROOT"/deploy/caddy.d/*.caddy \
         "$ROOT"/deploy/docker-compose.override.yml "$ROOT"/CREDENTIALS.txt; do
  add_cfg "$f"
done
if [ -d "$RW_DIR" ]; then
  for f in "$RW_DIR"/.env "$RW_DIR"/*.env "$RW_DIR"/docker-compose.yml "$RW_DIR"/*/.env "$RW_DIR"/*/*.env "$RW_DIR"/*/docker-compose.yml; do
    add_cfg "$f"
  done
fi
if [ "${#cfg[@]}" -gt 0 ]; then
  CFG_FILE="$OUT/vpn-config-$STAMP.tar.gz"
  tmp="$(new_tmp "vpn-config-$STAMP.tar.gz")"
  # пути сохраняются относительно / (например opt/vpn-platform/deploy/.env), чтобы было понятно, куда класть при восстановлении
  if tar -C / -czf "$tmp" -- "${cfg[@]}" && finalize "$tmp" "$CFG_FILE"; then :; else
    err "не удалось сохранить настройки (.env и др.) — без deploy/.env восстановить проект из дампа БД будет нельзя"
    status=1
  fi
fi

# ---------------------------------------------------------------- 3. БД Remnawave (необязательно)
if [ -d "$RW_DIR" ]; then
  if [ "$(docker inspect -f '{{.State.Running}}' remnawave-db 2>/dev/null || true)" = true ]; then
    rw_user="$(get_env "$RW_DIR/.env" POSTGRES_USER)"; rw_user="${rw_user:-postgres}"
    rw_db="$(get_env "$RW_DIR/.env" POSTGRES_DB)"; rw_db="${rw_db:-postgres}"
    RW_FILE="$OUT/remnawave-db-$STAMP.sql.gz"
    tmp="$(new_tmp "remnawave-db-$STAMP.sql.gz")"
    if docker exec remnawave-db pg_dump -U "$rw_user" -d "$rw_db" | gzip -9 > "$tmp" \
       && gunzip -c "$tmp" 2>/dev/null | tail -n 20 | grep -q 'PostgreSQL database dump complete' \
       && finalize "$tmp" "$RW_FILE"; then :; else
      warn "не удалось сделать дамп БД Remnawave (контейнер remnawave-db, пользователь $rw_user, база $rw_db). Бэкап проекта при этом сделан."
    fi
  else
    warn "контейнер remnawave-db не запущен — дамп БД Remnawave пропущен"
  fi
fi

# ---------------------------------------------------------------- 4. Ротация: оставляем KEEP последних КОРРЕКТНЫХ копий
rotate() { # rotate МАСКА
  local f kept=0
  # shellcheck disable=SC2012
  # «|| true»: если файлов такого вида нет (например, Remnawave не на этом сервере), ls вернёт ошибку и set -e оборвал бы бэкап
  { ls -1t "$OUT"/$1 2>/dev/null || true; } | while IFS= read -r f; do
    [ -f "$f" ] || continue
    if ! gzip -t "$f" 2>/dev/null; then
      warn "удаляю повреждённую копию: $f"; rm -f -- "$f"; continue
    fi
    kept=$((kept + 1))
    # именно if, а не «[ ] && rm»: иначе последняя проверка вернёт 1 и set -e оборвёт скрипт после успешного бэкапа
    if [ "$kept" -gt "$KEEP" ]; then rm -f -- "$f"; fi
  done
  return 0
}
if [ "${BACKUP_NO_ROTATE:-0}" != 1 ]; then
  rotate 'vpn-[0-9]*.sql.gz'
  rotate 'vpn-config-*.tar.gz'
  rotate 'remnawave-db-*.sql.gz'
  # хвосты от прерванных запусков (kill -9 и т.п.)
  find "$OUT" -maxdepth 1 -type f -name '.*.tmp' -mmin +1440 -delete 2>/dev/null || true
fi

[ "$status" = 0 ] || exit "$status"
echo "Готово. Скопируйте папку $OUT на другой сервер или в облако: копия на том же диске не спасёт при потере VPS."
