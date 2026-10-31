#!/usr/bin/env bash
# Автоустановка панели Remnawave (Docker) на чистый Ubuntu/Debian.
#
#   sudo bash install-remnawave.sh --panel-domain panel.example.com --sub-domain sub.example.com
#
# Режимы reverse-proxy (--proxy):
#   caddy  (по умолчанию) — ставит собственный Caddy на 80/443 с автоматическим HTTPS
#   none   — без прокси: панель слушает только 127.0.0.1:3000, подписки — 127.0.0.1:3010.
#            Нужен, когда прокси уже есть (в том числе в установщике VPN-проекта: он сам
#            проксирует panel.* и sub.* и подключается к сети remnawave-network).
set -Eeuo pipefail
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
  for c in curl openssl; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
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

DIR=/opt/remnawave
PANEL_DOMAIN=""
SUB_DOMAIN=""
PROXY=caddy
ADMIN_USER="admin"
ADMIN_PASS=""
NON_INTERACTIVE=0
OUT_FILE=""
GIVEN_TOKEN=""
RAW=https://raw.githubusercontent.com/remnawave/backend/refs/heads/main
# Адрес панели для API-запросов самого установщика (до настройки прокси)
LOCAL_API="${REMNAWAVE_LOCAL_API:-http://127.0.0.1:3000}"

usage() {
  cat <<USAGE
Использование: sudo bash install-remnawave.sh [опции]
  --panel-domain DOMAIN   домен панели (panel.example.com)
  --sub-domain DOMAIN     домен страницы подписок (sub.example.com)
  --proxy caddy|none      reverse-proxy (по умолчанию caddy)
  --dir PATH              каталог установки (по умолчанию /opt/remnawave)
  --admin-user NAME       логин администратора панели (по умолчанию admin)
  --admin-pass PASS       пароль (>=24 символов, A-Z a-z 0-9). По умолчанию генерируется
  --api-token TOKEN       готовый API-токен панели (пропустить создание админа и токена)
  --output FILE           сохранить данные доступа в файл (формат KEY=VALUE)
  --yes                   без вопросов
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --panel-domain) PANEL_DOMAIN="${2:-}"; shift 2 ;;
    --sub-domain) SUB_DOMAIN="${2:-}"; shift 2 ;;
    --proxy) PROXY="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
    --admin-pass) ADMIN_PASS="${2:-}"; shift 2 ;;
    --api-token) GIVEN_TOKEN="${2:-}"; shift 2 ;;
    --output) OUT_FILE="${2:-}"; shift 2 ;;
    --yes|-y) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Неизвестный параметр: $1" ;;
  esac
done

need_root
check_os
case "$PROXY" in caddy|none) ;; *) die "--proxy должен быть caddy или none" ;; esac

if [ -z "$PANEL_DOMAIN" ]; then PANEL_DOMAIN="$(ask 'Домен панели Remnawave (например panel.example.com)')"; fi
if [ -z "$SUB_DOMAIN" ]; then SUB_DOMAIN="$(ask 'Домен страницы подписок (например sub.example.com)')"; fi
valid_domain "$PANEL_DOMAIN" || die "Некорректный домен панели: '$PANEL_DOMAIN'"
valid_domain "$SUB_DOMAIN" || die "Некорректный домен подписок: '$SUB_DOMAIN'"
[ "$PANEL_DOMAIN" != "$SUB_DOMAIN" ] || die "Домены панели и подписок должны отличаться"
[[ "$ADMIN_USER" =~ ^[A-Za-z0-9_.-]{3,32}$ ]] || die "Логин: 3–32 символа (латиница, цифры, _ . -)"
if [ -z "$ADMIN_PASS" ]; then ADMIN_PASS="$(rand_pass)"; fi
if [ "${#ADMIN_PASS}" -lt 24 ] || ! [[ "$ADMIN_PASS" =~ [a-z] ]] || ! [[ "$ADMIN_PASS" =~ [0-9] ]] || ! [[ "$ADMIN_PASS" =~ [A-Z] ]]; then
  die "Пароль панели: минимум 24 символа, с заглавной, строчной буквой и цифрой"
fi

install_base_packages
install_docker
if [ "$PROXY" = caddy ]; then check_dns "$PANEL_DOMAIN"; check_dns "$SUB_DOMAIN"; fi

# ---------------------------------------------------------------- панель
mkdir -p "$DIR"
cd "$DIR"
if [ -f .env ] && [ -f docker-compose.yml ]; then
  warn "В $DIR уже есть установка. Секреты в .env сохраняю, обновляю только домены."
else
  info "Скачиваю docker-compose и .env с GitHub"
  curl -fsSL -o docker-compose.yml "$RAW/docker-compose-prod.yml" || die "Не удалось скачать docker-compose-prod.yml (нет доступа к GitHub?)"
  curl -fsSL -o .env "$RAW/.env.sample" || die "Не удалось скачать .env.sample"
  chmod 600 .env
  set_env .env APP_SECRET "$(rand_hex 64)"
  set_env .env METRICS_PASS "$(rand_hex 32)"
  set_env .env WEBHOOK_SECRET_HEADER "$(rand_hex 64)"
  pw="$(rand_hex 24)"
  set_env .env POSTGRES_PASSWORD "$pw"
  sed -i "s|^\(DATABASE_URL=\"postgresql://postgres:\)[^@]*\(@.*\)|\1${pw}\2|" .env
  ok "Секреты сгенерированы"
fi
set_env .env FRONT_END_DOMAIN "$PANEL_DOMAIN"
set_env .env SUB_PUBLIC_DOMAIN "$SUB_DOMAIN"

ensure_remnawave_network
info "Запускаю панель"
docker compose up -d >/dev/null
info "Жду готовности панели (до 3 минут)"
ready=0
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'x-forwarded-for: 127.0.0.1' -H 'x-forwarded-proto: https' "$LOCAL_API/api/auth/status" || true)"
  if [ "$code" = 200 ]; then ready=1; break; fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  docker compose logs --tail 40 remnawave || true
  die "Панель не запустилась. Логи выше; смотрите: docker compose -f $DIR/docker-compose.yml logs"
fi
ok "Панель отвечает"

api() { # api METHOD PATH [JSON] [TOKEN]
  local m="$1" p="$2" body="${3:-}" tok="${4:-}"
  local args=(-sS -X "$m" -H 'content-type: application/json' -H 'x-forwarded-for: 127.0.0.1' -H 'x-forwarded-proto: https' -w '\n%{http_code}')
  [ -n "$tok" ] && args+=(-H "authorization: Bearer $tok")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" "$LOCAL_API$p"
}
http_code() { tail -n1 <<<"$1"; }
http_body() { sed '$d' <<<"$1"; }

# ---------------------------------------------------------------- суперадмин + API-токен
CRED="$DIR/credentials.env"
PASS_VALID=0
API_TOKEN=""
ACCESS=""
if [ -n "$GIVEN_TOKEN" ]; then
  API_TOKEN="$GIVEN_TOKEN"
  ok "Использую переданный API-токен"
else
if [ -f "$CRED" ] && [ -n "$(get_env "$CRED" REMNAWAVE_ADMIN_PASSWORD)" ]; then
  ADMIN_USER="$(get_env "$CRED" REMNAWAVE_ADMIN_USER)"; ADMIN_PASS="$(get_env "$CRED" REMNAWAVE_ADMIN_PASSWORD)"
  info "Найдены ранее сохранённые данные администратора — выполняю вход"
  r="$(api POST /api/auth/login "$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" '{username:$u,password:$p}')")"
  if [ "$(http_code "$r")" = 200 ]; then ACCESS="$(http_body "$r" | jq -r '.response.accessToken')"; PASS_VALID=1; fi
else
  info "Создаю суперадминистратора панели"
  r="$(api POST /api/auth/register "$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" '{username:$u,password:$p}')")"
  if [ "$(http_code "$r")" = 200 ] || [ "$(http_code "$r")" = 201 ]; then
    ACCESS="$(http_body "$r" | jq -r '.response.accessToken')"
    PASS_VALID=1
    (umask 077; { echo "REMNAWAVE_ADMIN_USER=$ADMIN_USER"; echo "REMNAWAVE_ADMIN_PASSWORD=$ADMIN_PASS"; } > "$CRED")
  else
    warn "Регистрация не удалась (HTTP $(http_code "$r")): $(http_body "$r" | head -c 300)"
    warn "Возможно, администратор уже создан ранее. Войдите в панель вручную и создайте API-токен (Настройки → API-токены)."
  fi
fi

if [ -n "$ACCESS" ] && [ "$ACCESS" != null ]; then
  info "Создаю API-токен для VPN-проекта"
  for body in \
    '{"name":"vpn-platform","expiresInDays":3650,"scopes":["*"]}' \
    '{"name":"vpn-platform","expiresInDays":3650}' \
    '{"tokenName":"vpn-platform"}'; do
    r="$(api POST /api/tokens "$body" "$ACCESS")"
    if [ "$(http_code "$r")" = 200 ] || [ "$(http_code "$r")" = 201 ]; then
      API_TOKEN="$(http_body "$r" | jq -r '.response.token // empty')"
      [ -n "$API_TOKEN" ] && break
    fi
  done
  if [ -n "$API_TOKEN" ]; then ok "API-токен создан"; else warn "Не удалось создать API-токен автоматически: создайте его в панели (Настройки → API-токены)."; fi
fi

fi

# ---------------------------------------------------------------- профиль Xray + сквад для VPN-проекта
x25519_keys() { # печатает "private public" (base64url без =)
  local tmp priv pub
  tmp="$(mktemp)"
  openssl genpkey -algorithm X25519 -outform DER -out "$tmp" 2>/dev/null
  priv="$(tail -c 32 "$tmp" | base64 | tr '+/' '-_' | tr -d '=\n')"
  pub="$(openssl pkey -in "$tmp" -inform DER -pubout -outform DER 2>/dev/null | tail -c 32 | base64 | tr '+/' '-_' | tr -d '=\n')"
  rm -f "$tmp"
  printf '%s %s' "$priv" "$pub"
}

PROFILE_UUID=""; INBOUND_UUID=""; SQUAD_UUID=""
provision_vpn() {
  local tok="$1" r keys priv sid cfg
  info "Создаю профиль Xray (VLESS + Reality, порт 443) и сквад VAYLO"
  r="$(api GET /api/config-profiles "" "$tok")"
  if [ "$(http_code "$r")" != 200 ]; then warn "Профили недоступны (HTTP $(http_code "$r")) — создайте профиль и сквад вручную."; return 0; fi
  PROFILE_UUID="$(http_body "$r" | jq -r '[.response.configProfiles[]? | select(.name=="VAYLO")][0].uuid // empty')"
  if [ -z "$PROFILE_UUID" ]; then
    keys="$(x25519_keys)"; priv="${keys% *}"
    sid="$(rand_hex 8)"
    cfg="$(jq -n --arg priv "$priv" --arg sid "$sid" '{
      log:{loglevel:"warning"},
      inbounds:[{tag:"VLESS_REALITY",port:443,protocol:"vless",
        settings:{clients:[],decryption:"none"},
        sniffing:{enabled:true,destOverride:["http","tls","quic"]},
        streamSettings:{network:"tcp",security:"reality",
          realitySettings:{show:false,xver:0,target:"www.microsoft.com:443",
            serverNames:["www.microsoft.com"],privateKey:$priv,shortIds:[$sid]}}}],
      outbounds:[{tag:"DIRECT",protocol:"freedom"},{tag:"BLOCK",protocol:"blackhole"}],
      routing:{rules:[
        {ip:["geoip:private"],outboundTag:"BLOCK"},
        {protocol:["bittorrent"],outboundTag:"BLOCK"}]}}')"
    r="$(api POST /api/config-profiles "$(jq -n --argjson c "$cfg" '{name:"VAYLO",config:$c}')" "$tok")"
    if [ "$(http_code "$r")" != 200 ] && [ "$(http_code "$r")" != 201 ]; then
      warn "Не удалось создать профиль (HTTP $(http_code "$r")): $(http_body "$r" | head -c 300)"; return 0
    fi
    PROFILE_UUID="$(http_body "$r" | jq -r '.response.uuid')"
    INBOUND_UUID="$(http_body "$r" | jq -r '[.response.inbounds[]? | select(.tag=="VLESS_REALITY")][0].uuid // empty')"
    ok "Профиль VAYLO создан"
  else
    ok "Профиль VAYLO уже есть — использую его"
  fi
  if [ -z "$INBOUND_UUID" ]; then
    r="$(api GET "/api/config-profiles/$PROFILE_UUID" "" "$tok")"
    INBOUND_UUID="$(http_body "$r" | jq -r '[.response.inbounds[]? | select(.tag=="VLESS_REALITY")][0].uuid // .response.inbounds[0].uuid // empty')"
  fi
  [ -n "$INBOUND_UUID" ] || { warn "Не найден inbound профиля — создайте сквад вручную."; return 0; }
  r="$(api GET /api/internal-squads "" "$tok")"
  SQUAD_UUID="$(http_body "$r" | jq -r '[.response.internalSquads[]? | select(.name=="VAYLO")][0].uuid // empty')"
  if [ -z "$SQUAD_UUID" ]; then
    r="$(api POST /api/internal-squads "$(jq -n --arg i "$INBOUND_UUID" '{name:"VAYLO",inbounds:[$i]}')" "$tok")"
    if [ "$(http_code "$r")" = 200 ] || [ "$(http_code "$r")" = 201 ]; then
      SQUAD_UUID="$(http_body "$r" | jq -r '.response.uuid')"; ok "Сквад VAYLO создан"
    else
      warn "Не удалось создать сквад (HTTP $(http_code "$r")): $(http_body "$r" | head -c 300)"
    fi
  else
    ok "Сквад VAYLO уже есть"
  fi
}
if [ -n "${API_TOKEN:-$ACCESS}" ]; then provision_vpn "${API_TOKEN:-$ACCESS}"; fi

# ---------------------------------------------------------------- страница подписок
SUBDIR="$DIR/subscription"
mkdir -p "$SUBDIR"
if [ -n "$API_TOKEN" ]; then
  cat > "$SUBDIR/docker-compose.yml" <<YML
services:
  remnawave-subscription-page:
    image: remnawave/subscription-page:latest
    container_name: remnawave-subscription-page
    hostname: remnawave-subscription-page
    restart: always
    env_file:
      - .env
    ports:
      - '127.0.0.1:3010:3010'
    networks:
      - remnawave-network

networks:
  remnawave-network:
    name: remnawave-network
    driver: bridge
    external: true
YML
  (umask 077; cat > "$SUBDIR/.env" <<ENV
APP_PORT=3010
REMNAWAVE_PANEL_URL=http://remnawave:3000
REMNAWAVE_API_TOKEN=$API_TOKEN
ENV
  )
  info "Запускаю страницу подписок"
  if (cd "$SUBDIR" && docker compose up -d >/dev/null); then ok "Страница подписок запущена"; else warn "Страница подписок не запустилась: docker compose -f $SUBDIR/docker-compose.yml logs"; fi
else
  warn "Страница подписок не запущена: нужен API-токен. После его создания положите в $SUBDIR/.env (REMNAWAVE_API_TOKEN) и выполните docker compose up -d."
fi

# ---------------------------------------------------------------- прокси
if [ "$PROXY" = caddy ]; then
  CADDYDIR="$DIR/caddy"
  mkdir -p "$CADDYDIR"
  cat > "$CADDYDIR/Caddyfile" <<CADDY
$PANEL_DOMAIN {
	reverse_proxy remnawave:3000
}

$SUB_DOMAIN {
	reverse_proxy remnawave-subscription-page:3010
}
CADDY
  cat > "$CADDYDIR/docker-compose.yml" <<YML
services:
  caddy:
    image: caddy:2
    container_name: remnawave-caddy
    restart: always
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - remnawave-network

networks:
  remnawave-network:
    name: remnawave-network
    driver: bridge
    external: true

volumes:
  caddy-data:
  caddy-config:
YML
  info "Запускаю Caddy (HTTPS выпускается автоматически)"
  (cd "$CADDYDIR" && docker compose up -d >/dev/null) || die "Caddy не запустился. Не заняты ли порты 80/443?"
  ok "Caddy запущен"
fi

# ---------------------------------------------------------------- итог
if [ -n "$OUT_FILE" ]; then
  (umask 077; {
    echo "REMNAWAVE_PANEL_DOMAIN=$PANEL_DOMAIN"
    echo "REMNAWAVE_SUB_DOMAIN=$SUB_DOMAIN"
    if [ "$PASS_VALID" = 1 ]; then
      echo "REMNAWAVE_ADMIN_USER=$ADMIN_USER"
      echo "REMNAWAVE_ADMIN_PASSWORD=$ADMIN_PASS"
    fi
    echo "REMNAWAVE_URL=http://remnawave:3000"
    echo "REMNAWAVE_TOKEN=$API_TOKEN"
    echo "REMNAWAVE_PROFILE_UUID=$PROFILE_UUID"
    echo "REMNAWAVE_INBOUND_UUID=$INBOUND_UUID"
    echo "REMNAWAVE_SQUAD_UUID=$SQUAD_UUID"
  } > "$OUT_FILE")
fi

printf '\n%s================ Remnawave установлена ================%s\n' "$C_BOLD" "$C_OFF"
if [ "$PROXY" = caddy ]; then
  echo "Панель:        https://$PANEL_DOMAIN"
  echo "Подписки:      https://$SUB_DOMAIN"
else
  echo "Панель:        http://127.0.0.1:3000 (прокси не установлен — настройте его для $PANEL_DOMAIN)"
  echo "Подписки:      http://127.0.0.1:3010 (для $SUB_DOMAIN)"
fi
if [ "$PASS_VALID" = 1 ]; then
  echo "Логин:         $ADMIN_USER"
  echo "Пароль:        $ADMIN_PASS"
else
  echo "Логин/пароль:  не созданы автоматически (администратор уже существовал). Войдите своими данными."
fi
[ -n "$API_TOKEN" ] && echo "API-токен:     $API_TOKEN"
[ -n "$SQUAD_UUID" ] && echo "UUID сквада:   $SQUAD_UUID"
# Сохраняем всё в INSTALL-INFO.txt (права 600)
(umask 077; {
  echo "Панель: https://$PANEL_DOMAIN"; echo "Подписки: https://$SUB_DOMAIN"
  [ "$PASS_VALID" = 1 ] && { echo "Логин: $ADMIN_USER"; echo "Пароль: $ADMIN_PASS"; }
  echo "API-токен: $API_TOKEN"; echo "UUID сквада: $SQUAD_UUID"
} > "$DIR/INSTALL-INFO.txt")
echo "Все данные также в: $DIR/INSTALL-INFO.txt"
[ -f "$CRED" ] && echo "Данные доступа сохранены в: $CRED (права 600)"
# Лёгкая очистка мусора после установки (тома с данными не трогаем)
if docker info >/dev/null 2>&1; then
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --filter "until=72h" >/dev/null 2>&1 || true
fi
command -v apt-get >/dev/null 2>&1 && apt-get clean >/dev/null 2>&1 || true

cat <<NEXT

Дальше:
  1. В админке VAYLO → Настройки → Remnawave: URL = https://$PANEL_DOMAIN, токен и UUID сквада — из данных выше.
  2. Нажмите «Восстановить пользователей» (если переустанавливали панель) — пользователи создадутся заново.
  3. На каждом VPS для VPN выполните: bash install-node.sh --panel https://$PANEL_DOMAIN --token <API-токен> --name Finland --country FI
NEXT
