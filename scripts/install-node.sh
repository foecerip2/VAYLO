#!/usr/bin/env bash
# Автоустановка VPN-ноды (remnanode) и регистрация её в панели Remnawave.
#
#   sudo bash install-node.sh --panel https://panel.example.com --token <API-токен> --name Finland --country FI
#
# Скрипт: ставит Docker, создаёт ноду и хост в панели, запускает remnanode, открывает порты в ufw.
set -Eeuo pipefail
if [ -t 1 ]; then C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'; C_OFF=$'\033[0m'; else C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_OFF=''; fi
info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }
ok()   { printf '%s ✓%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%s !%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
die()  { printf '%s ✗ Ошибка:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

PANEL=""; TOKEN=""; NAME=""; COUNTRY=""; ADDRESS=""; NODE_PORT=2222; VPN_PORT=443; DIR=/opt/remnanode; PROFILE_NAME=VAYLO; PROFILE_EXPLICIT=0; NODE_VERSION=""; SELFSTEAL=""; SELFSTEAL_PORT=9443
SKIP_DOCKER="${NODE_SKIP_INSTALL:-0}"; NON_INTERACTIVE=0
usage() { cat <<U
Использование: sudo bash install-node.sh --panel URL --token TOKEN [--name NAME] [--country CC] [--address IP|DOMAIN]
  --panel URL        адрес панели (https://panel.example.com)
  --token TOKEN      API-токен панели (из установщика панели / INSTALL-INFO.txt)
  --name NAME        имя ноды (3–30 символов), по умолчанию Node-<IP>
  --country CC       код страны из 2 букв (FI, DE, NL ...)
  --address ADDR     адрес ноды для клиентов (по умолчанию — публичный IP сервера)
  --profile NAME     имя профиля Xray в панели (по умолчанию VAYLO)
  --node-port PORT   порт связи панели с нодой (по умолчанию 2222)
  --version TAG      зафиксировать версию образа remnawave/node (например 3.4.1; должна совпадать с версией панели)
  --selfsteal DOMAIN поднять на ноде сайт-маску (Caddy на 127.0.0.1:9443) для Reality; DOMAIN — A-запись на этот сервер, без Cloudflare-прокси
  --yes              без вопросов
U
}
while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --country) COUNTRY="${2:-}"; shift 2 ;;
    --address) ADDRESS="${2:-}"; shift 2 ;;
    --profile) PROFILE_NAME="${2:-}"; PROFILE_EXPLICIT=1; shift 2 ;;
    --version) NODE_VERSION="${2:-}"; shift 2 ;;
    --selfsteal) SELFSTEAL="${2:-}"; shift 2 ;;
    --node-port) NODE_PORT="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --yes|-y) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Неизвестный параметр: $1" ;;
  esac
done
ask() { local q="$1" def="${2:-}" a; if [ "$NON_INTERACTIVE" = 1 ]; then printf '%s' "$def"; return; fi; read -r -p "$q${def:+ [$def]}: " a </dev/tty || true; printf '%s' "${a:-$def}"; }

[ "$(id -u)" -eq 0 ] || [ "$SKIP_DOCKER" = 1 ] || die "Запустите от root: sudo bash $0"
[ -n "$PANEL" ] || PANEL="$(ask 'Адрес панели (https://panel.example.com)')"
[ -n "$TOKEN" ] || TOKEN="$(ask 'API-токен панели')"
PANEL="${PANEL%/}"
[[ "$PANEL" =~ ^https?:// ]] || PANEL="https://$PANEL"
[ -n "$TOKEN" ] || die "Нужен API-токен панели"

if [ "$SKIP_DOCKER" != 1 ]; then
  export DEBIAN_FRONTEND=noninteractive
  for c in curl jq openssl; do command -v "$c" >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl jq openssl ca-certificates >/dev/null; break; }; done
  if ! { command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }; then
    info "Устанавливаю Docker"
    curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "Не удалось установить Docker"
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
fi

if [ -z "$ADDRESS" ]; then ADDRESS="$(curl -fsS4 --max-time 6 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 6 https://ifconfig.me 2>/dev/null || true)"; fi
[ -n "$ADDRESS" ] || ADDRESS="$(ask 'Не удалось определить IP. Адрес ноды')"
[ -n "$ADDRESS" ] || die "Нужен адрес ноды (--address)"
[ -z "$SELFSTEAL" ] || ADDRESS="$SELFSTEAL"
[ -n "$NAME" ] || NAME="$(ask 'Имя ноды' "Node-${ADDRESS//./-}")"
NAME="${NAME:0:30}"; [ "${#NAME}" -ge 3 ] || NAME="Node-$NAME"
[ -n "$COUNTRY" ] || COUNTRY="$(ask 'Код страны (2 буквы, например FI)' XX)"
COUNTRY="$(printf '%s' "${COUNTRY:-XX}" | tr '[:lower:]' '[:upper:]' | cut -c1-2)"

api() { # api METHOD PATH [JSON]
  local args=(-sS -X "$1" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -w '\n%{http_code}')
  [ -n "${3:-}" ] && args+=(-d "$3")
  curl "${args[@]}" "$PANEL$2"
}
code() { tail -n1 <<<"$1"; }
body() { sed '$d' <<<"$1"; }
ok2() { [ "$(code "$1")" = 200 ] || [ "$(code "$1")" = 201 ]; }

[[ -z "$NODE_VERSION" || "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version: ожидается вид 3.4.1"
[[ -z "$SELFSTEAL" || "$SELFSTEAL" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]] || die "--selfsteal: ожидается домен вида nl1.example.com"
[ -n "$NODE_VERSION" ] || warn "Версия образа не зафиксирована (latest): на разных серверах версии нод могут разойтись. Лучше указать --version как у панели."
info "Проверяю доступ к панели"
r="$(api GET /api/config-profiles)" || die "Панель недоступна: $PANEL"
case "$(code "$r")" in 200) ;; 401|403) die "Панель отклонила токен (HTTP $(code "$r"))" ;; *) die "Панель ответила HTTP $(code "$r"): $(body "$r" | head -c 200)" ;; esac
if [ "$PROFILE_EXPLICIT" = 1 ]; then
  # профиль указан явно — никакой подмены другим профилем (иначе новая нода получила бы чужой конфиг)
  PROFILE_UUID="$(body "$r" | jq -r --arg n "$PROFILE_NAME" '[.response.configProfiles[]? | select(.name==$n)][0].uuid // empty')"
  [ -n "$PROFILE_UUID" ] || die "Профиль «$PROFILE_NAME» не найден в панели. Создайте его (Config Profiles) и запустите скрипт снова."
else
  PROFILE_UUID="$(body "$r" | jq -r --arg n "$PROFILE_NAME" '([.response.configProfiles[]? | select(.name==$n)][0] // .response.configProfiles[0]).uuid // empty')"
fi
[ -n "$PROFILE_UUID" ] || die "В панели нет профиля Xray. Сначала запустите install-remnawave.sh (он создаёт профиль VAYLO)."
INBOUND_UUID="$(body "$r" | jq -r --arg u "$PROFILE_UUID" '[.response.configProfiles[]? | select(.uuid==$u)][0].inbounds[0].uuid // empty')"
[ -n "$INBOUND_UUID" ] || die "В профиле нет inbound"
ok "Профиль найден"

info "Регистрирую ноду «$NAME» ($ADDRESS) в панели"
r="$(api GET /api/nodes)"
NODE_UUID=""
if [ "$(code "$r")" = 200 ]; then
  NODE_UUID="$(body "$r" | jq -r --arg a "$ADDRESS" '[(.response | if type=="array" then . else (.nodes // []) end)[] | select(.address==$a)][0].uuid // empty')"
fi
if [ -n "$NODE_UUID" ]; then
  ok "Нода с таким адресом уже есть — использую её"
else
  payload="$(jq -n --arg name "$NAME" --arg addr "$ADDRESS" --arg cc "$COUNTRY" --argjson port "$NODE_PORT" --arg p "$PROFILE_UUID" --arg i "$INBOUND_UUID" \
    '{name:$name,address:$addr,port:$port,countryCode:$cc,isTrafficTrackingActive:false,configProfile:{activeConfigProfileUuid:$p,activeInbounds:[$i]}}')"
  r="$(api POST /api/nodes "$payload")"
  ok2 "$r" || die "Не удалось создать ноду (HTTP $(code "$r")): $(body "$r" | head -c 300)"
  NODE_UUID="$(body "$r" | jq -r '.response.uuid')"
  ok "Нода создана"
fi

r="$(api GET /api/keygen)"
ok2 "$r" || die "Не удалось получить ключ ноды (HTTP $(code "$r"))"
SECRET="$(body "$r" | jq -r '.response.secretKey // .response.pubKey // empty')"
[ -n "$SECRET" ] || die "Панель не вернула ключ ноды"

if [ -n "$SELFSTEAL" ] && [ "$SKIP_DOCKER" != 1 ]; then
  info "Поднимаю сайт-маску для Reality ($SELFSTEAL → 127.0.0.1:$SELFSTEAL_PORT)"
  myip="$(curl -fsS4 --max-time 6 https://api.ipify.org 2>/dev/null || true)"
  dnsip="$(getent ahostsv4 "$SELFSTEAL" 2>/dev/null | awk '{print $1; exit}' || true)"
  [ -n "$dnsip" ] || die "Домен $SELFSTEAL не резолвится. Создайте A-запись на IP этого сервера (без Cloudflare-прокси) и повторите."
  [ -z "$myip" ] || [ "$dnsip" = "$myip" ] || die "$SELFSTEAL указывает на $dnsip, а этот сервер — $myip. Исправьте A-запись и повторите."
  SS=/opt/selfsteal; mkdir -p "$SS/site"
  [ -f "$SS/site/index.html" ] || cat > "$SS/site/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Welcome</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem"><h1>Welcome</h1><p>This server is up and running.</p></body></html>
HTML
  cat > "$SS/Caddyfile" <<CADDY
{
	https_port $SELFSTEAL_PORT
	default_bind 127.0.0.1
	auto_https disable_redirects
}

http://$SELFSTEAL {
	bind 0.0.0.0
	redir https://$SELFSTEAL{uri} permanent
}

https://$SELFSTEAL {
	root * /srv/site
	file_server
}
CADDY
  cat > "$SS/docker-compose.yml" <<'YML'
services:
  caddy:
    image: caddy:2
    container_name: selfsteal
    restart: always
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./site:/srv/site:ro
      - caddy-data:/data
volumes:
  caddy-data:
YML
  (cd "$SS" && docker compose up -d >/dev/null) || die "selfsteal не запустился: docker compose -f $SS/docker-compose.yml logs"
  ok "Сайт-маска запущена (сертификат Let's Encrypt выпустится при первом обращении; порт 80 должен быть открыт)"
fi

info "Запускаю remnanode"
mkdir -p "$DIR"
(umask 077; cat > "$DIR/docker-compose.yml" <<YML
services:
  remnanode:
    image: remnawave/node:${NODE_VERSION:-latest}
    container_name: remnanode
    hostname: remnanode
    restart: always
    network_mode: host
    cap_add:
      - NET_ADMIN
    ulimits:
      nofile:
        soft: 1048576
        hard: 1048576
    environment:
      - NODE_PORT=$NODE_PORT
      - SECRET_KEY=$SECRET
YML
)
if [ "$SKIP_DOCKER" != 1 ]; then
  (cd "$DIR" && docker compose up -d >/dev/null) || die "remnanode не запустился: docker compose -f $DIR/docker-compose.yml logs"
  ok "remnanode запущен"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    host="${PANEL#*://}"; host="${host%%[:/]*}"
    pip="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1; exit}' || true)"
    if [ -n "$pip" ]; then ufw allow from "$pip" to any port "$NODE_PORT" proto tcp >/dev/null; else warn "Не удалось определить IP панели — откройте порт $NODE_PORT для неё вручную"; fi
    ufw allow "$VPN_PORT"/tcp >/dev/null
    [ -z "$SELFSTEAL" ] || ufw allow 80/tcp >/dev/null
    ok "ufw: порты $NODE_PORT (для панели) и $VPN_PORT открыты"
  else
    warn "Если на сервере или у провайдера есть файрвол — откройте $VPN_PORT/tcp для всех и $NODE_PORT/tcp для IP панели"
  fi
fi

# хост (адрес, который попадёт в подписки пользователей)
r="$(api GET /api/hosts)"
HOST_EXISTS=""
[ "$(code "$r")" = 200 ] && HOST_EXISTS="$(body "$r" | jq -r --arg a "$ADDRESS" '[(.response | if type=="array" then . else (.hosts // []) end)[] | select(.address==$a)][0].uuid // empty')"
if [ -n "$HOST_EXISTS" ]; then
  ok "Хост для $ADDRESS уже есть"
else
  hp="$(jq -n --arg p "$PROFILE_UUID" --arg i "$INBOUND_UUID" --arg rem "$NAME" --arg addr "$ADDRESS" --argjson port "$VPN_PORT" --arg n "$NODE_UUID" --arg sni "${SELFSTEAL:-www.microsoft.com}" \
    '{inbound:{configProfileUuid:$p,configProfileInboundUuid:$i},remark:$rem,address:$addr,port:$port,sni:$sni,fingerprint:"chrome",nodes:[$n]}')"
  r="$(api POST /api/hosts "$hp")"
  if ok2 "$r"; then ok "Хост добавлен в подписки"; else warn "Хост не создан (HTTP $(code "$r")): $(body "$r" | head -c 300) — добавьте в панели: Hosts → Create"; fi
fi

printf '\nГотово. Нода «%s» подключается к панели — статус Online появится через 10–30 секунд (Nodes в панели).\n' "$NAME"
