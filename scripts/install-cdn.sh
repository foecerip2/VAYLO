#!/usr/bin/env bash
# Origin-сервер для обхода блокировок через CDN (Яндекс Cloud CDN / VK Cloud CDN): nginx + Xray XHTTP под управлением Remnawave.
#
#   sudo bash install-cdn.sh --panel https://panel.example.com --token <API-токен> --origin cdn.example.com \
#        --cdn-domain yacdn.example.com --name Yandex-CDN --country RU --yes
#
# Схема:  клиент → CDN (yacdn.example.com → CNAME Яндекса) → origin (cdn.example.com, этот сервер) → nginx → Xray (127.0.0.1:2053)
# Запускать на ОТДЕЛЬНОМ VPS (порт 443 должен быть свободен). A-запись --origin должна указывать на IP этого сервера.
# Второй запуск с --cdn-domain (когда CDN уже создан) добавляет хост в подписки; повторные запуски ничего не дублируют.
set -Eeuo pipefail
if [ -t 1 ]; then C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'; C_OFF=$'\033[0m'; else C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_OFF=''; fi
info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }
ok()   { printf '%s ✓%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%s !%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
die()  { printf '%s ✗ Ошибка:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

PANEL=""; TOKEN=""; ORIGIN=""; CDN_DOMAIN=""; NAME="CDN-origin"; COUNTRY=""; ADDRESS=""
XPATH="/api/getFile"; XPORT=2053; NODE_PORT=2222; OBFS=0; EMPTY_HOST=0; NON_INTERACTIVE=0
PROFILE_NAME="VAYLO-CDN"; SQUAD_NAME="VAYLO"; HOST_REMARK=""; DIR=/opt/remnanode
SKIP_SYSTEM="${CDN_SKIP_INSTALL:-0}"; NGINX_DIR="${CDN_NGINX_DIR:-/etc/nginx}"; WEB_DIR="${CDN_WEB_DIR:-/var/www}"

usage() { cat <<U
Использование: sudo bash install-cdn.sh --panel URL --token TOKEN --origin ДОМЕН [опции]
  --panel URL         адрес панели Remnawave (https://panel.example.com)
  --token TOKEN       API-токен панели
  --origin ДОМЕН      домен-источник (cdn.example.com), A-запись на IP ЭТОГО сервера
  --cdn-domain ДОМЕН  домен, который пользователи увидят в ссылках (yacdn.example.com, CNAME на Яндекс CDN).
                      Можно не указывать сейчас и запустить скрипт повторно после создания CDN-ресурса
  --name NAME         имя ноды (по умолчанию CDN-origin)
  --country CC        страна ноды (2 буквы)
  --address ADDR      адрес сервера для панели (по умолчанию публичный IP)
  --path PATH         секретный путь XHTTP (по умолчанию /api/getFile)
  --obfs              усиленная маскировка трафика (xPadding и др.) — если CDN отвечает 403 на обычный XHTTP
  --empty-host        оставить Host пустым (нужно, если CDN выдал технический домен без своего домена)
  --yes               без вопросов
U
}
while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --origin) ORIGIN="${2:-}"; shift 2 ;;
    --cdn-domain) CDN_DOMAIN="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --country) COUNTRY="${2:-}"; shift 2 ;;
    --address) ADDRESS="${2:-}"; shift 2 ;;
    --path) XPATH="${2:-}"; shift 2 ;;
    --obfs) OBFS=1; shift ;;
    --empty-host) EMPTY_HOST=1; shift ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --yes|-y) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Неизвестный параметр: $1" ;;
  esac
done
ask() { local q="$1" def="${2:-}" a; if [ "$NON_INTERACTIVE" = 1 ]; then printf '%s' "$def"; return; fi; read -r -p "$q${def:+ [$def]}: " a </dev/tty || true; printf '%s' "${a:-$def}"; }

[ "$(id -u)" -eq 0 ] || [ "$SKIP_SYSTEM" = 1 ] || die "Запустите от root: sudo bash $0"
[ -n "$PANEL" ] || PANEL="$(ask 'Адрес панели (https://panel.example.com)')"
[ -n "$TOKEN" ] || TOKEN="$(ask 'API-токен панели')"
[ -n "$ORIGIN" ] || ORIGIN="$(ask 'Домен-источник (cdn.example.com)')"
PANEL="${PANEL%/}"; [[ "$PANEL" =~ ^https?:// ]] || PANEL="https://$PANEL"
[ -n "$TOKEN" ] || die "Нужен API-токен панели"
valid_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }
valid_domain "$ORIGIN" || die "Некорректный домен-источник: '$ORIGIN'"
[ -z "$CDN_DOMAIN" ] || valid_domain "$CDN_DOMAIN" || die "Некорректный --cdn-domain: '$CDN_DOMAIN'"
[[ "$XPATH" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "Путь должен начинаться с / и содержать только латиницу, цифры и _ . / -"
XPATH="${XPATH%/}"
[ -n "$COUNTRY" ] || COUNTRY="$(ask 'Код страны ноды (2 буквы)' XX)"
COUNTRY="$(printf '%s' "${COUNTRY:-XX}" | tr '[:lower:]' '[:upper:]' | cut -c1-2)"
NAME="${NAME:0:30}"; [ "${#NAME}" -ge 3 ] || NAME="CDN-$NAME"
[ -n "$HOST_REMARK" ] || HOST_REMARK="$NAME"

public_ip() { curl -fsS4 --max-time 6 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 6 https://ifconfig.me 2>/dev/null || true; }
rand_hex() { openssl rand -hex "$1"; }

if [ "$SKIP_SYSTEM" != 1 ]; then
  export DEBIAN_FRONTEND=noninteractive
  info "Устанавливаю пакеты (nginx, certbot, jq)"
  apt-get update -qq && apt-get install -y -qq nginx certbot curl jq openssl dnsutils ca-certificates >/dev/null
  if ! { command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }; then
    info "Устанавливаю Docker"
    curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "Не удалось установить Docker"
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(:|\])443$' && ! systemctl is-active --quiet nginx; then
    die "Порт 443 уже занят другой программой. Origin нужно ставить на чистый сервер."
  fi
fi

[ -n "$ADDRESS" ] || ADDRESS="$(public_ip)"
[ -n "$ADDRESS" ] || ADDRESS="$(ask 'Не удалось определить IP. Адрес сервера')"
[ -n "$ADDRESS" ] || die "Нужен адрес сервера (--address)"

if [ "$SKIP_SYSTEM" != 1 ]; then
  resolved="$(getent ahostsv4 "$ORIGIN" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "$resolved" ]; then die "Домен $ORIGIN не резолвится. Создайте A-запись $ORIGIN → $ADDRESS (серое облако, без проксирования) и подождите 5–10 минут."; fi
  [ "$resolved" = "$ADDRESS" ] || warn "Домен $ORIGIN указывает на $resolved, а IP сервера — $ADDRESS. Сертификат может не выпуститься."
fi

api() { local args=(-sS -X "$1" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -w '\n%{http_code}'); [ -n "${3:-}" ] && args+=(-d "$3"); curl "${args[@]}" "$PANEL$2"; }
code() { tail -n1 <<<"$1"; }
body() { sed '$d' <<<"$1"; }
ok2() { [ "$(code "$1")" = 200 ] || [ "$(code "$1")" = 201 ]; }

info "Проверяю доступ к панели"
r="$(api GET /api/config-profiles)" || die "Панель недоступна: $PANEL"
case "$(code "$r")" in 200) ;; 401|403) die "Панель отклонила токен (HTTP $(code "$r"))" ;; *) die "Панель ответила HTTP $(code "$r")" ;; esac

# ---------------------------------------------------------------- nginx + сертификат + заглушка
mkdir -p "$WEB_DIR/cdnsite/html" "$WEB_DIR/html" "$NGINX_DIR/sites-available" "$NGINX_DIR/sites-enabled"
cat > "$WEB_DIR/cdnsite/html/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>File Delivery Service</title></head>
<body><h1>File Delivery Service</h1><p>Static content delivery endpoint. Access is restricted.</p></body></html>
HTML
CONF="$NGINX_DIR/sites-available/cdnsite"
if [ "$SKIP_SYSTEM" != 1 ] && [ ! -f "/etc/letsencrypt/live/$ORIGIN/fullchain.pem" ]; then
  info "Получаю сертификат Let's Encrypt для $ORIGIN"
  cat > "$CONF" <<CONF80
server {
    listen 80;
    server_name $ORIGIN;
    root $WEB_DIR/html;
    location /.well-known/acme-challenge/ { }
    location / { return 301 https://\$host\$request_uri; }
}
CONF80
  ln -sf "$CONF" "$NGINX_DIR/sites-enabled/cdnsite"
  rm -f "$NGINX_DIR/sites-enabled/default"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  certbot certonly --webroot -w "$WEB_DIR/html" -d "$ORIGIN" --agree-tos --register-unsafely-without-email -n >/dev/null 2>&1 \
    || die "Сертификат не выпущен. Проверьте A-запись $ORIGIN и что порт 80 открыт у провайдера."
  ok "Сертификат получен"
fi
cat > "$CONF" <<CONFSSL
server {
    listen 80;
    server_name $ORIGIN;
    root $WEB_DIR/html;
    location /.well-known/acme-challenge/ { }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name $ORIGIN;
    ssl_certificate     /etc/letsencrypt/live/$ORIGIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$ORIGIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    root $WEB_DIR/cdnsite/html;
    index index.html;
    location $XPATH {
        proxy_pass http://127.0.0.1:$XPORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        client_max_body_size 0;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location / { try_files \$uri \$uri/ =404; }
}
CONFSSL
ln -sf "$CONF" "$NGINX_DIR/sites-enabled/cdnsite"
if [ "$SKIP_SYSTEM" != 1 ]; then
  nginx -t >/dev/null 2>&1 || { nginx -t; die "Ошибка в конфиге nginx"; }
  systemctl reload nginx
  ok "nginx настроен: $XPATH → Xray, остальное — заглушка"
fi

# ---------------------------------------------------------------- профиль Xray (XHTTP) в панели
info "Создаю профиль Xray «$PROFILE_NAME» (VLESS + XHTTP за nginx)"
XH='{"path":"'"$XPATH"'","mode":"packet-up"}'
if [ "$OBFS" = 1 ]; then
  XH="$(jq -n --arg p "$XPATH" '{path:$p,mode:"packet-up",xPaddingBytes:"100-1000",xPaddingObfsMode:true,xPaddingKey:"hash",xPaddingHeader:"X-Client-Version",xPaddingPlacement:"queryInHeader",xPaddingMethod:"tokenish",seqPlacement:"query",seqKey:"chunk_id",scMaxBufferedPosts:100,scStreamUpServerSecs:"20-80"}')"
fi
r="$(api GET /api/config-profiles)"
PROFILE_UUID="$(body "$r" | jq -r --arg n "$PROFILE_NAME" '[.response.configProfiles[]? | select(.name==$n)][0].uuid // empty')"
if [ -z "$PROFILE_UUID" ]; then
  cfg="$(jq -n --argjson xh "$XH" --argjson port "$XPORT" '{
    log:{loglevel:"warning"},
    inbounds:[{tag:"XHTTP_CDN",listen:"127.0.0.1",port:$port,protocol:"vless",
      settings:{clients:[],decryption:"none"},
      sniffing:{enabled:true,destOverride:["http","tls","quic"]},
      streamSettings:{network:"xhttp",security:"none",xhttpSettings:$xh}}],
    outbounds:[{tag:"DIRECT",protocol:"freedom"},{tag:"BLOCK",protocol:"blackhole"}],
    routing:{rules:[{ip:["geoip:private"],outboundTag:"BLOCK"},{protocol:["bittorrent"],outboundTag:"BLOCK"}]}}')"
  r="$(api POST /api/config-profiles "$(jq -n --arg n "$PROFILE_NAME" --argjson c "$cfg" '{name:$n,config:$c}')")"
  ok2 "$r" || die "Не удалось создать профиль (HTTP $(code "$r")): $(body "$r" | head -c 300)"
  PROFILE_UUID="$(body "$r" | jq -r '.response.uuid')"
  INBOUND_UUID="$(body "$r" | jq -r '[.response.inbounds[]? | select(.tag=="XHTTP_CDN")][0].uuid // empty')"
  ok "Профиль создан"
else
  ok "Профиль уже есть — использую его (чтобы изменить путь/режим, удалите профиль в панели)"
  r="$(api GET "/api/config-profiles/$PROFILE_UUID")"
  INBOUND_UUID="$(body "$r" | jq -r '[.response.inbounds[]? | select(.tag=="XHTTP_CDN")][0].uuid // empty')"
fi
[ -n "$INBOUND_UUID" ] || die "Не найден inbound XHTTP_CDN в профиле"

# ---------------------------------------------------------------- нода
r="$(api GET /api/nodes)"
NODE_UUID="$(body "$r" | jq -r --arg a "$ADDRESS" '[(.response | if type=="array" then . else (.nodes // []) end)[] | select(.address==$a)][0].uuid // empty')"
if [ -z "$NODE_UUID" ]; then
  payload="$(jq -n --arg name "$NAME" --arg addr "$ADDRESS" --arg cc "$COUNTRY" --argjson port "$NODE_PORT" --arg p "$PROFILE_UUID" --arg i "$INBOUND_UUID" \
    '{name:$name,address:$addr,port:$port,countryCode:$cc,isTrafficTrackingActive:false,configProfile:{activeConfigProfileUuid:$p,activeInbounds:[$i]}}')"
  r="$(api POST /api/nodes "$payload")"
  ok2 "$r" || die "Не удалось создать ноду (HTTP $(code "$r")): $(body "$r" | head -c 300)"
  NODE_UUID="$(body "$r" | jq -r '.response.uuid')"
  ok "Нода создана"
else
  ok "Нода с этим адресом уже есть"
fi
r="$(api GET /api/keygen)"; ok2 "$r" || die "Не удалось получить ключ ноды (HTTP $(code "$r"))"
SECRET="$(body "$r" | jq -r '.response.secretKey // .response.pubKey // empty')"
[ -n "$SECRET" ] || die "Панель не вернула ключ ноды"
mkdir -p "$DIR"
(umask 077; cat > "$DIR/docker-compose.yml" <<YML
services:
  remnanode:
    image: remnawave/node:latest
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
if [ "$SKIP_SYSTEM" != 1 ]; then
  (cd "$DIR" && docker compose up -d >/dev/null) || die "remnanode не запустился"
  ok "remnanode запущен"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    h="${PANEL#*://}"; h="${h%%[:/]*}"; pip="$(getent ahostsv4 "$h" 2>/dev/null | awk '{print $1; exit}' || true)"
    [ -n "$pip" ] && ufw allow from "$pip" to any port "$NODE_PORT" proto tcp >/dev/null || warn "Откройте порт $NODE_PORT для IP панели вручную"
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
    ok "ufw: открыты 80, 443 и $NODE_PORT (для панели)"
  fi
fi

# ---------------------------------------------------------------- сквад: добавляем inbound к существующему сквадy
r="$(api GET /api/internal-squads)"
SQ="$(body "$r" | jq -c --arg n "$SQUAD_NAME" '[.response.internalSquads[]? | select(.name==$n)][0] // empty')"
if [ -n "$SQ" ]; then
  SQ_UUID="$(jq -r '.uuid' <<<"$SQ")"
  new="$(jq -c --arg i "$INBOUND_UUID" '[(.inbounds // [])[].uuid] + [$i] | unique' <<<"$SQ")"
  r="$(api PATCH /api/internal-squads "$(jq -n --arg u "$SQ_UUID" --argjson inb "$new" '{uuid:$u,inbounds:$inb}')")"
  if ok2 "$r"; then ok "Inbound добавлен в сквад «$SQUAD_NAME» — пользователи получат CDN-подключение"; else warn "Не удалось обновить сквад (HTTP $(code "$r")) — добавьте inbound XHTTP_CDN в сквад вручную"; fi
else
  warn "Сквад «$SQUAD_NAME» не найден — добавьте inbound XHTTP_CDN в нужный сквад в панели"
fi

# ---------------------------------------------------------------- хост для подписок
if [ -n "$CDN_DOMAIN" ]; then
  r="$(api GET /api/hosts)"
  HOST_EXISTS="$(body "$r" | jq -r --arg a "$CDN_DOMAIN" '[(.response | if type=="array" then . else (.hosts // []) end)[] | select(.address==$a)][0].uuid // empty')"
  if [ -n "$HOST_EXISTS" ]; then
    ok "Хост для $CDN_DOMAIN уже есть"
  else
    EXTRA='null'
    if [ "$OBFS" = 1 ]; then
      EXTRA='{"mode":"packet-up","seqKey":"chunk_id","seqPlacement":"query","xPaddingBytes":"100-1000","xPaddingHeader":"X-Client-Version","xPaddingKey":"hash","xPaddingMethod":"tokenish","xPaddingObfsMode":true,"xPaddingPlacement":"queryInHeader","xmux":{"cMaxReuseTimes":1000,"hKeepAlivePeriod":20000,"hMaxRequestTimes":"600-900","hMaxReusableSecs":"100","maxConcurrency":"32-64","maxConnections":0}}'
    fi
    HOSTHDR="$CDN_DOMAIN"; [ "$EMPTY_HOST" = 1 ] && HOSTHDR=""
    hp="$(jq -n --arg p "$PROFILE_UUID" --arg i "$INBOUND_UUID" --arg rem "$HOST_REMARK" --arg addr "$CDN_DOMAIN" --arg path "$XPATH" --arg host "$HOSTHDR" --arg n "$NODE_UUID" --argjson extra "$EXTRA" \
      '{inbound:{configProfileUuid:$p,configProfileInboundUuid:$i},remark:$rem,address:$addr,port:443,path:$path,sni:$addr,host:$host,alpn:"h2,http/1.1",fingerprint:"chrome",securityLayer:"TLS",nodes:[$n]} + (if $extra==null then {} else {xhttpExtraParams:$extra} end)')"
    r="$(api POST /api/hosts "$hp")"
    if ok2 "$r"; then ok "Хост $CDN_DOMAIN добавлен в подписки"; else warn "Хост не создан (HTTP $(code "$r")): $(body "$r" | head -c 300)"; fi
  fi
fi

cat <<DONE

Готово: origin настроен.
  Origin (источник для CDN): https://$ORIGIN   (путь туннеля: $XPATH)
  Проверка с этого сервера:  curl -sk -o /dev/null -w '%{http_code}\n' https://$ORIGIN$XPATH/   → ожидается 400
DONE
if [ -z "$CDN_DOMAIN" ]; then cat <<NEXT

Дальше:
  1. В Яндекс Cloud CDN создайте ресурс: источник https://$ORIGIN, персональный домен (например yacdn.ваш-домен),
     передача заголовка Host — «пересылать», кеширование — ВЫКЛЮЧИТЬ. Скопируйте выданный CNAME.
  2. В DNS домена создайте CNAME yacdn → значение от Яндекса. A-запись $ORIGIN НЕ удаляйте.
  3. Когда проверка curl https://yacdn.ваш-домен$XPATH/ вернёт 400, запустите скрипт ещё раз с теми же параметрами
     и добавьте --cdn-domain yacdn.ваш-домен — он создаст хост для подписок.
NEXT
fi
