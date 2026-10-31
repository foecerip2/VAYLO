#!/usr/bin/env bash
# Автоустановщик VPN-сервиса (API + воркер + Telegram-бот + Mini App + админка + шлюз с HTTPS).
#
#   sudo bash scripts/install.sh                      # интерактивно
#   sudo bash scripts/install.sh --domain example.com --bot-token 123:ABC --admin-email me@example.com --remnawave install --yes
#   sudo bash scripts/install.sh --update             # обновление после замены файлов проекта
#
# Домены (A-записи на IP сервера): app.<domain>, admin.<domain>, а при установке Remnawave — panel.<domain>, sub.<domain>.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# ---- общие функции (встроены, чтобы скрипт работал отдельным файлом) ----
# shellcheck disable=SC2034
# Общие функции для установщиков. Подключается через `source`.

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_OFF=''
fi

info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }
ok()   { printf '%s ✓%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%s !%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
die()  { printf '%s ✗ Ошибка:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

need_root() { [ "$(id -u)" -eq 0 ] || die "Запустите от root: sudo bash $0"; }

check_os() {
  [ -r /etc/os-release ] || die "Не удалось определить ОС"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) warn "Скрипт проверялся на Ubuntu 22.04/24.04 и Debian 12. У вас: ${PRETTY_NAME:-unknown}. Продолжаем на свой риск." ;;
  esac
}

rand_hex()  { openssl rand -hex "$1"; }
# Пароль, подходящий под требования Remnawave: >=24 символов, заглавная, строчная, цифра
rand_pass() { printf 'Aa1%s' "$(openssl rand -hex 16)"; }

install_base_packages() {
  local missing=()
  for c in curl openssl rsync; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
  command -v python3 >/dev/null 2>&1 || missing+=(python3)
  command -v jq >/dev/null 2>&1 || missing+=(jq)
  if [ "${#missing[@]}" -gt 0 ]; then
    info "Устанавливаю пакеты: ${missing[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq "${missing[@]}" ca-certificates >/dev/null
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker уже установлен ($(docker --version | cut -d, -f1))"
    return
  fi
  info "Устанавливаю Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "Не удалось установить Docker"
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Не найден docker compose plugin"
  ok "Docker установлен"
}

# Создаёт общую сеть так, чтобы docker compose проекта remnawave считал её своей (без предупреждений),
# а проект VPN мог подключаться к ней как к внешней.
ensure_remnawave_network() {
  if docker network inspect remnawave-network >/dev/null 2>&1; then return; fi
  docker network create \
    --label com.docker.compose.network=remnawave-network \
    --label com.docker.compose.project=remnawave \
    remnawave-network >/dev/null
}

# set_env FILE KEY VALUE — меняет или добавляет KEY=VALUE (значение без кавычек)
set_env() {
  local file="$1" key="$2" value="$3"
  python3 - "$file" "$key" "$value" <<'PY'
import sys, re
path, key, value = sys.argv[1:4]
try:
    lines = open(path, encoding="utf-8").read().split("\n")
except FileNotFoundError:
    lines = []
pat = re.compile(r"^\s*" + re.escape(key) + r"\s*=")
done = False
for i, l in enumerate(lines):
    if pat.match(l):
        lines[i] = f"{key}={value}"
        done = True
        break
if not done:
    while lines and lines[-1] == "":
        lines.pop()
    lines.append(f"{key}={value}")
    lines.append("")
open(path, "w", encoding="utf-8").write("\n".join(lines))
PY
}

get_env() { # get_env FILE KEY
  grep -E "^$2=" "$1" 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

valid_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }

public_ip() { curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || true; }

# Проверка, что домен смотрит на этот сервер (предупреждение, не ошибка)
check_dns() {
  local d="$1" ip resolved
  ip="$(public_ip)"
  resolved="$(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "$resolved" ]; then
    warn "Домен $d пока не резолвится. Создайте A-запись на ${ip:-IP сервера}, иначе HTTPS-сертификат не выпустится."
  elif [ -n "$ip" ] && [ "$resolved" != "$ip" ]; then
    warn "Домен $d указывает на $resolved, а IP этого сервера — $ip. Проверьте DNS (если используете Cloudflare — выключите проксирование, серое облако)."
  else
    ok "DNS: $d → $resolved"
  fi
}

ask() { # ask "Вопрос" "default" -> stdout
  local q="$1" def="${2:-}" ans
  if [ "${NON_INTERACTIVE:-0}" = "1" ]; then printf '%s' "$def"; return; fi
  if [ -n "$def" ]; then read -r -p "$q [$def]: " ans </dev/tty || true; else read -r -p "$q: " ans </dev/tty || true; fi
  printf '%s' "${ans:-$def}"
}

ask_yes() { # ask_yes "Вопрос" "y|n" -> returns 0 for yes
  local ans
  ans="$(ask "$1 (y/n)" "${2:-y}")"
  [[ "$ans" =~ ^[YyДд] ]]
}
# ---- конец общих функций ----

INSTALL_DIR=/opt/vpn-platform
DOMAIN=""
APP_DOMAIN=""
ADMIN_DOMAIN=""
PANEL_DOMAIN=""
SUB_DOMAIN=""
BOT_TOKEN=""
BOT_USERNAME=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
RW_MODE=""          # install | external | skip
RW_URL=""
RW_TOKEN=""
NON_INTERACTIVE=0
UPDATE=0
CLEANUP_ONLY=0
NO_BACKUP_CRON=0
TG_API="${TELEGRAM_API_ROOT:-https://api.telegram.org}"

usage() {
  cat <<USAGE
Использование: sudo bash scripts/install.sh [опции]
  --domain DOMAIN        базовый домен: будут app.DOMAIN, admin.DOMAIN, panel.DOMAIN, sub.DOMAIN
  --app-domain D         домен Mini App / личного кабинета (иначе app.<domain>)
  --admin-domain D       домен админки (иначе admin.<domain>)
  --panel-domain D       домен панели Remnawave (иначе panel.<domain>)
  --sub-domain D         домен страницы подписок (иначе sub.<domain>)
  --bot-token TOKEN      токен бота от @BotFather
  --admin-email EMAIL    email владельца админки
  --admin-password PASS  пароль владельца (иначе генерируется)
  --remnawave MODE       install — поставить Remnawave на этот сервер
                         external — Remnawave уже есть (нужны --rw-url и --rw-token)
                         skip — подключить позже в админке (Настройки → Remnawave)
  --rw-url URL           адрес панели для режима external (https://panel.example.com)
  --rw-token TOKEN       API-токен панели для режима external
  --dir PATH             каталог установки (по умолчанию /opt/vpn-platform)
  --update               обновить уже установленный проект (секреты и данные сохраняются)
  --cleanup              только очистить мусор (docker, кэш, логи, старые бэкапы) и выйти
  --no-backup-cron       не добавлять ежедневный бэкап БД в cron
  --yes                  не задавать вопросов (все обязательные значения — флагами)
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --app-domain) APP_DOMAIN="${2:-}"; shift 2 ;;
    --admin-domain) ADMIN_DOMAIN="${2:-}"; shift 2 ;;
    --panel-domain) PANEL_DOMAIN="${2:-}"; shift 2 ;;
    --sub-domain) SUB_DOMAIN="${2:-}"; shift 2 ;;
    --bot-token) BOT_TOKEN="${2:-}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --remnawave) RW_MODE="${2:-}"; shift 2 ;;
    --rw-url) RW_URL="${2:-}"; shift 2 ;;
    --rw-token) RW_TOKEN="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --update) UPDATE=1; shift ;;
    --cleanup) CLEANUP_ONLY=1; shift ;;
    --no-backup-cron) NO_BACKUP_CRON=1; shift ;;
    --yes|-y) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Неизвестный параметр: $1" ;;
  esac
done

need_root
if [ "$CLEANUP_ONLY" = 1 ]; then
  exec bash "$SCRIPT_DIR/cleanup.sh"
fi
check_os
# Часовой пояс сервера: Москва (можно переопределить: VPN_TZ=Europe/Berlin). Чтобы время в логах, бэкапах и отчётах было верным.
if command -v timedatectl >/dev/null 2>&1; then
  TZ_WANT="${VPN_TZ:-Europe/Moscow}"
  if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "$TZ_WANT" ]; then
    timedatectl set-timezone "$TZ_WANT" >/dev/null 2>&1 && ok "Часовой пояс: $TZ_WANT" || warn "Не удалось установить часовой пояс"
  fi
  timedatectl set-ntp true >/dev/null 2>&1 || true
fi
install_base_packages
install_docker

ENV_FILE="$INSTALL_DIR/deploy/.env"
PROJECT=vpn                      # = `name:` в deploy/docker-compose.yml
PGDATA_VOLUME="${PROJECT}_pgdata"
API_WAIT="${API_WAIT:-120}"      # сколько секунд ждать готовности API после обновления

pgdata_exists() { docker volume inspect "$PGDATA_VOLUME" >/dev/null 2>&1; }

# .env потерян, а база осталась: новые секреты не подойдут к существующей базе — отказываемся
refuse_missing_env() {
  die "Не найден $ENV_FILE, но на сервере есть том с базой данных проекта ($PGDATA_VOLUME).
   В .env хранятся пароль этой базы (DB_PASSWORD) и ключ шифрования настроек (APP_SECRET).
   Новая установка создала бы новые секреты: API не смог бы подключиться к базе,
   а сохранённые ключи платёжных систем перестали бы расшифровываться.
   Что делать: восстановите прежний .env из бэкапа (архив backups/vpn-config-ДАТА.tar.gz,
   см. INSTALL.md, раздел «Бэкап и восстановление») в $ENV_FILE
   и запустите: sudo bash scripts/install.sh --update"
}

# ------------------------------------------------------------ копирование файлов проекта
# rsync --delete: файлы, удалённые в новой версии (например, старые миграции), удаляются и в $INSTALL_DIR.
# Никогда не удаляются и не перезаписываются: deploy/.env*, deploy/*.env, сгенерированные deploy/caddy.d/*,
# deploy/data, docker-compose.override.yml, backups/, CREDENTIALS.txt, node_modules, dist.
sync_sources() {
  mkdir -p "$INSTALL_DIR"
  local src dst log deleted
  src="$(cd "$SRC_DIR" && pwd -P)"
  dst="$(cd "$INSTALL_DIR" && pwd -P)"
  if [ "$dst" != "$src" ]; then
    [ "$dst" != / ] || die "Каталог установки не может быть корнем файловой системы"
    case "$dst/" in "$src/"*) die "Каталог установки ($dst) находится внутри каталога с исходниками ($src). Укажите другой --dir." ;; esac
    case "$src/" in "$dst/"*) die "Новая версия распакована внутри каталога установки ($src). Распакуйте её в другое место (например, /root/vpn-platform) и запустите установщик оттуда." ;; esac
    { [ -f "$src/deploy/docker-compose.yml" ] && [ -f "$src/scripts/install.sh" ]; } || die "В $src нет файлов проекта (deploy/docker-compose.yml, scripts/install.sh)"
    if [ -n "$(ls -A "$dst" 2>/dev/null)" ] && [ ! -f "$dst/deploy/docker-compose.yml" ] && [ ! -f "$dst/scripts/install.sh" ]; then
      die "Каталог $dst не пуст и не похож на установку проекта — не трогаю его. Укажите другой --dir."
    fi
    command -v rsync >/dev/null 2>&1 || die "Не найден rsync (apt-get install rsync)"
    info "Синхронизирую файлы проекта в $dst (.env, бэкапы, настройки шлюза и CREDENTIALS.txt сохраняются)"
    log="$(mktemp)"
    if ! rsync -a --delete --itemize-changes \
        --include='/deploy/.env.example' \
        --exclude='/deploy/.env' --exclude='/deploy/.env.*' --exclude='/deploy/*.env' --exclude='/deploy/.*.env' \
        --exclude='/deploy/caddy.d/panel.caddy' --filter='P /deploy/caddy.d/*' \
        --exclude='/deploy/data/' \
        --exclude='/deploy/docker-compose.override.yml' --exclude='/deploy/compose.override.yml' \
        --exclude='/backups/' --exclude='/CREDENTIALS.txt' --exclude='/.env' --exclude='/.git/' \
        --exclude='node_modules/' --exclude='dist/' \
        "$src/" "$dst/" >"$log"; then
      rm -f "$log"
      die "Не удалось скопировать файлы проекта (rsync)"
    fi
    deleted="$(grep -c '^\*deleting' "$log" || true)"
    if [ "${deleted:-0}" -gt 0 ]; then
      info "Удалены файлы, которых нет в новой версии ($deleted):"
      grep '^\*deleting' "$log" | sed 's/^\*deleting */   /' | head -n 30
    fi
    rm -f "$log"
  fi
  mkdir -p "$INSTALL_DIR/deploy/caddy.d" "$INSTALL_DIR/backups"
  chmod 700 "$INSTALL_DIR/backups" 2>/dev/null || true
  chmod +x "$INSTALL_DIR"/scripts/*.sh 2>/dev/null || true
}

compose() { (cd "$INSTALL_DIR/deploy" && docker compose "$@"); }

install_cleanup_cron() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    bash "$INSTALL_DIR/scripts/cleanup.sh" --install --dir "$INSTALL_DIR"
    ok "Ежедневная очистка кэшей в 04:15 включена (systemd timer)"
  elif command -v crontab >/dev/null 2>&1; then
    ( crontab -l 2>/dev/null | grep -v 'vpn-platform-cleanup' ; echo "15 4 * * * bash '$INSTALL_DIR/scripts/cleanup.sh' --dir '$INSTALL_DIR' >/dev/null 2>&1 # vpn-platform-cleanup" ) | crontab -
    ok "Ежедневная очистка кэшей в 04:15 включена (cron)"
  fi
}

install_backup_cron() {
  command -v crontab >/dev/null 2>&1 || return 0
  ( crontab -l 2>/dev/null | grep -v 'vpn-platform-backup' ; echo "30 3 * * * bash '$INSTALL_DIR/scripts/backup.sh' >'$INSTALL_DIR/backups/last-backup.log' 2>&1 # vpn-platform-backup" ) | crontab -
  ok "Ежедневный бэкап в 03:30 (папка $INSTALL_DIR/backups, журнал последнего запуска: backups/last-backup.log)"
}

# api_status — статус healthcheck контейнера vpn-api (starting/healthy/unhealthy или пусто)
api_status() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' vpn-api 2>/dev/null || true; }

wait_api_healthy() { # wait_api_healthy СЕКУНДЫ
  local end=$((SECONDS + $1)) s
  while [ "$SECONDS" -lt "$end" ]; do
    s="$(api_status)"
    [ "$s" = healthy ] && return 0
    [ "$s" = unhealthy ] && return 1
    sleep 3
  done
  return 1
}

# Перед сборкой сохраняем образы работающей версии с тегом :prev — для отката
PREV_IMAGES=()
tag_prev_images() {
  local svc img src
  if [ "$(api_status)" != healthy ] && docker image inspect vpn-api:prev >/dev/null 2>&1; then
    warn "Текущий API не в статусе healthy — оставляю прежние образы :prev для отката как есть"
    for svc in api bot gateway; do docker image inspect "vpn-$svc:prev" >/dev/null 2>&1 && PREV_IMAGES+=("vpn-$svc"); done
    return 0
  fi
  for svc in api bot gateway; do
    img="vpn-$svc"
    src="$(docker inspect -f '{{.Image}}' "vpn-$svc" 2>/dev/null || true)"   # образ запущенного контейнера
    [ -n "$src" ] || src="$img:local"
    if docker image inspect "$src" >/dev/null 2>&1 && docker image tag "$src" "$img:prev"; then
      PREV_IMAGES+=("$img")
    fi
  done
  [ "${#PREV_IMAGES[@]}" -gt 0 ] && ok "Текущие образы сохранены с тегом :prev (${PREV_IMAGES[*]})"
  return 0
}

rollback_cmd() {
  local img cmd=""
  for img in "${PREV_IMAGES[@]}"; do cmd+="docker image tag $img:prev $img:local && "; done
  printf '%scd %s/deploy && docker compose up -d --no-build --force-recreate api worker bot gateway' "$cmd" "$INSTALL_DIR"
}

do_rollback() {
  local img
  info "Откатываю контейнеры на предыдущие образы (:prev)"
  for img in "${PREV_IMAGES[@]}"; do docker image tag "$img:prev" "$img:local" || return 1; done
  compose up -d --no-build --force-recreate api worker bot gateway || return 1
  wait_api_healthy "$API_WAIT"
}

# ------------------------------------------------------------ режим обновления
if [ "$UPDATE" = 1 ]; then
  if [ ! -f "$ENV_FILE" ]; then
    pgdata_exists && refuse_missing_env
    die "Не найдена установка в $INSTALL_DIR (нет deploy/.env). Запустите без --update."
  fi
  sync_sources

  backup_ok=0
  if [ -f "$INSTALL_DIR/scripts/backup.sh" ]; then
    info "Делаю резервную копию (БД и настройки) перед обновлением"
    if BACKUP_TAG=pre-update bash "$INSTALL_DIR/scripts/backup.sh"; then backup_ok=1; fi
  fi
  if [ "$backup_ok" != 1 ]; then
    warn "Резервная копия перед обновлением НЕ сделана (или сделана не полностью) — сообщения выше."
    warn "Если обновление испортит данные, вернуться к текущему состоянию будет нечем."
    if [ "$NON_INTERACTIVE" = 1 ]; then
      warn "Продолжаю без бэкапа (--yes)."
    else
      ask_yes "Продолжить обновление без резервной копии?" n || die "Обновление отменено. Контейнеры не тронуты."
    fi
  fi

  ensure_remnawave_network
  tag_prev_images
  info "Собираю новые образы (текущая версия пока работает)"
  compose build || die "Сборка не удалась (ошибки выше). Работающие контейнеры не тронуты."
  info "Перезапускаю контейнеры (миграции БД применятся автоматически)"
  compose up -d || warn "docker compose up завершился с ошибкой — проверяю состояние API"
  info "Жду готовности API (до $API_WAIT с)"
  if ! wait_api_healthy "$API_WAIT"; then
    warn "API не запустился после обновления (статус: $(api_status || true))."
    compose logs --tail=80 api worker || true
    echo
    if [ "${#PREV_IMAGES[@]}" -gt 0 ]; then
      if [ "$NON_INTERACTIVE" != 1 ] && ask_yes "Откатить контейнеры на предыдущую версию (образы :prev)?" n; then
        if do_rollback; then
          ok "Откат выполнен, API работает на предыдущей версии."
        else
          warn "После отката API тоже не готов. Логи: cd $INSTALL_DIR/deploy && docker compose logs --tail=80 api"
        fi
      else
        warn "Откат не выполнялся. Чтобы вернуть предыдущую версию, выполните:"
        printf '   %s\n' "$(rollback_cmd)"
      fi
    else
      warn "Образов предыдущей версии (:prev) нет — автоматический откат невозможен."
    fi
    if [ "$backup_ok" = 1 ]; then
      warn "Если новая версия успела изменить БД, данные до обновления — в бэкапе с меткой pre-update:"
      warn "   ls -t $INSTALL_DIR/backups/vpn-*-pre-update.sql.gz | head -1   →   sudo bash $INSTALL_DIR/scripts/restore.sh <файл>"
    fi
    die "Обновление не завершено."
  fi
  ok "API работает"

  # переписать строку бэкапа в cron в новом формате (bash <путь>), если бэкап был включён
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q 'vpn-platform-backup'; then install_backup_cron; fi
  install_cleanup_cron
  info "Чищу старые образы и мусор"
  bash "$INSTALL_DIR/scripts/cleanup.sh" || true
  ok "Готово. Состояние: docker compose -f $INSTALL_DIR/deploy/docker-compose.yml ps"
  exit 0
fi

# ------------------------------------------------------------ параметры
if [ -f "$ENV_FILE" ]; then
  die "Установка уже есть в $INSTALL_DIR. Для обновления используйте: sudo bash scripts/install.sh --update
   Не удаляйте $ENV_FILE: в нём пароль существующей базы данных и ключ шифрования настроек — без него данные станут недоступны."
fi
if pgdata_exists; then refuse_missing_env; fi

if [ -z "$DOMAIN" ] && [ -z "$APP_DOMAIN" ]; then DOMAIN="$(ask 'Базовый домен (например example.com)')"; fi
if [ -n "$DOMAIN" ]; then
  valid_domain "$DOMAIN" || die "Некорректный домен: '$DOMAIN'"
  : "${APP_DOMAIN:=app.$DOMAIN}"; : "${ADMIN_DOMAIN:=admin.$DOMAIN}"; : "${PANEL_DOMAIN:=panel.$DOMAIN}"; : "${SUB_DOMAIN:=sub.$DOMAIN}"
fi
valid_domain "${APP_DOMAIN:-}" || die "Некорректный домен приложения: '${APP_DOMAIN:-}'"
valid_domain "${ADMIN_DOMAIN:-}" || die "Некорректный домен админки (укажите --admin-domain): '${ADMIN_DOMAIN:-}'"

if [ -z "$BOT_TOKEN" ]; then BOT_TOKEN="$(ask 'Токен бота от @BotFather')"; fi
[[ "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || die "Токен бота выглядит неверно (ожидается вид 123456789:AAH...)"

info "Проверяю токен бота"
GETME="$(curl -fsS --max-time 15 "$TG_API/bot$BOT_TOKEN/getMe" 2>/dev/null || true)"
if [ "$(jq -r '.ok // false' <<<"$GETME" 2>/dev/null)" != true ]; then
  die "Telegram отклонил токен (getMe). Проверьте токен в @BotFather и доступ сервера к api.telegram.org"
fi
BOT_USERNAME="$(jq -r '.result.username' <<<"$GETME")"
ok "Бот: @$BOT_USERNAME"

if [ -z "$ADMIN_EMAIL" ]; then ADMIN_EMAIL="$(ask 'Email владельца админки')"; fi
[[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Некорректный email: '$ADMIN_EMAIL'"
if [ -n "$ADMIN_PASSWORD" ] && [ "${#ADMIN_PASSWORD}" -lt 10 ]; then die "Пароль администратора — минимум 10 символов"; fi

if [ -z "$RW_MODE" ]; then
  if [ "$NON_INTERACTIVE" = 1 ]; then RW_MODE=install; else
    echo "Remnawave — панель, которая выдаёт VPN-подписки."
    RW_MODE="$(ask 'Установить Remnawave на этот сервер? install / external / skip' install)"
  fi
fi
case "$RW_MODE" in install|external|skip) ;; *) die "--remnawave: install, external или skip" ;; esac

if [ "$RW_MODE" = install ]; then
  if [ -z "$PANEL_DOMAIN" ]; then PANEL_DOMAIN="$(ask 'Домен панели Remnawave' "panel.${APP_DOMAIN#*.}")"; fi
  if [ -z "$SUB_DOMAIN" ]; then SUB_DOMAIN="$(ask 'Домен страницы подписок' "sub.${APP_DOMAIN#*.}")"; fi
  valid_domain "$PANEL_DOMAIN" || die "Некорректный домен панели: '$PANEL_DOMAIN'"
  valid_domain "$SUB_DOMAIN" || die "Некорректный домен подписок: '$SUB_DOMAIN'"
fi
if [ "$RW_MODE" = external ]; then
  [ -n "$RW_URL" ] || RW_URL="$(ask 'Адрес панели Remnawave (https://panel.example.com)')"
  [ -n "$RW_TOKEN" ] || RW_TOKEN="$(ask 'API-токен Remnawave')"
  [[ "$RW_URL" =~ ^https?:// ]] || die "Адрес панели должен начинаться с http:// или https://"
  [ -n "$RW_TOKEN" ] || die "Нужен API-токен Remnawave"
fi

info "Проверяю DNS"
for d in "$APP_DOMAIN" "$ADMIN_DOMAIN"; do check_dns "$d"; done
if [ "$RW_MODE" = install ]; then for d in "$PANEL_DOMAIN" "$SUB_DOMAIN"; do check_dns "$d"; done; fi
if [ "$NON_INTERACTIVE" != 1 ]; then
  ask_yes "Продолжить установку?" y || die "Отменено"
fi

# Порты 80/443 должны быть свободны
for p in 80 443; do
  if (command -v ss >/dev/null 2>&1) && ss -ltn "( sport = :$p )" 2>/dev/null | grep -q LISTEN; then
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^vpn-gateway$'; then
      die "Порт $p уже занят другой программой (nginx/apache/другой Caddy?). Остановите её и запустите установщик снова."
    fi
  fi
done

# ------------------------------------------------------------ установка
sync_sources
ensure_remnawave_network

if [ "$RW_MODE" = install ]; then
  info "Устанавливаю Remnawave"
  RW_OUT="$INSTALL_DIR/deploy/.remnawave-install.env"
  bash "$SCRIPT_DIR/install-remnawave.sh" --proxy none --panel-domain "$PANEL_DOMAIN" --sub-domain "$SUB_DOMAIN" --output "$RW_OUT" --yes
  RW_URL="$(get_env "$RW_OUT" REMNAWAVE_URL)"
  RW_TOKEN="$(get_env "$RW_OUT" REMNAWAVE_TOKEN)"
  RW_ADMIN_USER="$(get_env "$RW_OUT" REMNAWAVE_ADMIN_USER)"
  RW_ADMIN_PASS="$(get_env "$RW_OUT" REMNAWAVE_ADMIN_PASSWORD)"
  cat > "$INSTALL_DIR/deploy/caddy.d/panel.caddy" <<CADDY
$PANEL_DOMAIN {
	reverse_proxy remnawave:3000
}

$SUB_DOMAIN {
	reverse_proxy remnawave-subscription-page:3010
}
CADDY
  [ -n "$RW_TOKEN" ] || warn "API-токен Remnawave не создан автоматически — укажите его в админке: Настройки → Remnawave."
elif [ "$RW_MODE" = external ]; then
  : # URL и токен уже заданы
else
  RW_URL=""; RW_TOKEN=""
fi

DB_PASSWORD="$(rand_hex 24)"
APP_SECRET="$(rand_hex 32)"
INTERNAL_KEY="$(rand_hex 24)"
WEBHOOK_SECRET="$(rand_hex 24)"
(umask 077; cat > "$ENV_FILE" <<ENV
# Создано scripts/install.sh $(date -u +%Y-%m-%dT%H:%M:%SZ). Не публикуйте этот файл.
APP_DOMAIN=$APP_DOMAIN
ADMIN_DOMAIN=$ADMIN_DOMAIN

DB_PASSWORD=$DB_PASSWORD
APP_SECRET=$APP_SECRET
INTERNAL_KEY=$INTERNAL_KEY
WEBHOOK_SECRET=$WEBHOOK_SECRET

BOT_TOKEN=$BOT_TOKEN
BOT_USERNAME=$BOT_USERNAME

API_URL=https://$APP_DOMAIN
APP_URL=https://$APP_DOMAIN
ADMIN_URL=https://$ADMIN_DOMAIN
WEBHOOK_URL=https://$APP_DOMAIN/tg/webhook

NODE_ENV=production
DATABASE_URL=postgres://vpn:$DB_PASSWORD@postgres:5432/vpn
REDIS_URL=redis://redis:6379
API_INTERNAL_URL=http://api:3000

REMNAWAVE_URL=$RW_URL
REMNAWAVE_TOKEN=$RW_TOKEN
REMNAWAVE_SQUAD_UUID=
ENV
)
ok "Файл настроек создан: $ENV_FILE"

info "Собираю образы и запускаю (первая сборка занимает 3–8 минут)"
compose up -d --build || { compose logs --tail 60 || true; die "Не удалось запустить контейнеры. Логи выше."; }

info "Жду готовности API"
ready=0
for _ in $(seq 1 90); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' vpn-api 2>/dev/null || true)" = healthy ]; then ready=1; break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then compose logs --tail 60 api || true; die "API не запустился. Логи выше."; fi
ok "API работает, миграции БД применены"

info "Создаю владельца админки"
if [ -z "$ADMIN_PASSWORD" ]; then
  CREATED="$(compose exec -T api node dist/cli.js create-admin "$ADMIN_EMAIL" | tail -n1)"
else
  CREATED="$(compose exec -T api node dist/cli.js create-admin "$ADMIN_EMAIL" "$ADMIN_PASSWORD" | tail -n1)"
fi
ADMIN_PASSWORD="$(jq -r '.password' <<<"$CREATED")"
[ -n "$ADMIN_PASSWORD" ] && [ "$ADMIN_PASSWORD" != null ] || die "Не удалось создать администратора: $CREATED"
ok "Владелец создан"

if [ "$NO_BACKUP_CRON" != 1 ]; then install_backup_cron; fi

install_cleanup_cron
bash "$INSTALL_DIR/scripts/cleanup.sh" >/dev/null 2>&1 || true

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ok "Порты 80/443 открыты в ufw"
fi

info "Проверяю, что сайты отвечают по HTTPS (сертификаты выпускаются до минуты)"
https_ok=0
for _ in $(seq 1 "${HTTPS_WAIT_TRIES:-30}"); do
  if curl -fsS --max-time 8 "https://$APP_DOMAIN/api/v1/health" >/dev/null 2>&1; then https_ok=1; break; fi
  sleep 4
done
if [ "$https_ok" = 1 ]; then ok "https://$APP_DOMAIN отвечает"; else warn "https://$APP_DOMAIN пока недоступен. Проверьте DNS-записи и логи: docker logs vpn-gateway"; fi

CREDS="$INSTALL_DIR/CREDENTIALS.txt"
(umask 077; {
  echo "VPN-сервис установлен $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Mini App / кабинет:  https://$APP_DOMAIN"
  echo "Админка:             https://$ADMIN_DOMAIN"
  echo "Логин админки:       $ADMIN_EMAIL"
  echo "Пароль админки:      $ADMIN_PASSWORD"
  echo "Бот:                 @$BOT_USERNAME"
  echo "Webhook ЮKassa:      https://$APP_DOMAIN/api/v1/webhooks/yookassa"
  echo "Callback Platega:    https://$APP_DOMAIN/api/v1/webhooks/platega"
  echo "Callback RollyPay:   https://$APP_DOMAIN/api/v1/webhooks/rollypay"
  if [ "$RW_MODE" = install ]; then
    echo "Панель Remnawave:    https://$PANEL_DOMAIN"
    echo "Логин панели:        $RW_ADMIN_USER"
    echo "Пароль панели:       $RW_ADMIN_PASS"
    echo "Подписки:            https://$SUB_DOMAIN"
  fi
} > "$CREDS")

printf '\n%s============== Установка завершена ==============%s\n' "$C_BOLD" "$C_OFF"
cat "$CREDS"
cat <<NEXT

Что дальше:
  1. Откройте админку → Настройки → Платежи: введите ключи ЮKassa, Platega и RollyPay, скопируйте адреса уведомлений в их кабинеты.
  2. В панели Remnawave добавьте ноду, создайте inbound и Internal Squad.
  3. Напишите боту @$BOT_USERNAME /start и проверьте покупку тарифа.
  4. Включите 2FA в админке: Настройки → Безопасность.
Эти данные сохранены в $CREDS (права 600). Сохраните пароли и удалите файл с сервера.
NEXT
