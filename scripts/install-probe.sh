#!/usr/bin/env bash
# Установка пробы по ключу VLESS на сервер (Ubuntu/Debian): xray + таймер, запуск каждые 10 минут.
# Использование:
#   bash install-probe.sh --sub https://sub.vaylonet.ru/<ключ тестового пользователя> --api https://api.vaylonet.ru --key <INTERNAL_KEY> [--name vps-main] [--operator beeline]
# Тестового пользователя создайте в боте/админке (например, «probe») и возьмите его ссылку подписки.
set -euo pipefail
SUB=""; API=""; KEY=""; NAME="vps-probe"; OPERATOR=""
while [ $# -gt 0 ]; do case "$1" in
  --sub) SUB="$2"; shift 2;; --api) API="$2"; shift 2;; --key) KEY="$2"; shift 2;;
  --name) NAME="$2"; shift 2;; --operator) OPERATOR="$2"; shift 2;; *) echo "Неизвестный параметр: $1"; exit 2;;
esac; done
[ -n "$SUB" ] && [ -n "$API" ] && [ -n "$KEY" ] || { echo "Нужны --sub, --api и --key"; exit 2; }
[ "$(id -u)" = 0 ] || { echo "Запустите от root (sudo)"; exit 1; }
DIR=/opt/vaylo-probe
HERE="$(cd "$(dirname "$0")" && pwd)"
apt-get update -qq && apt-get install -y -qq curl unzip ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
fi
mkdir -p "$DIR"
if [ ! -x "$DIR/xray" ]; then
  ARCH=64; [ "$(uname -m)" = "aarch64" ] && ARCH=arm64-v8a
  curl -fsSL -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-$ARCH.zip"
  unzip -oq /tmp/xray.zip xray -d "$DIR" && chmod +x "$DIR/xray" && rm -f /tmp/xray.zip
fi
cp "$HERE/vless-probe/lib.mjs" "$HERE/vless-probe/probe.mjs" "$DIR/"
cat > "$DIR/env" <<EOF
PROBE_SUB=$SUB
PROBE_API=$API
PROBE_KEY=$KEY
PROBE_NAME=$NAME
PROBE_OPERATOR=$OPERATOR
PROBE_XRAY=$DIR/xray
EOF
chmod 600 "$DIR/env"
cat > /etc/systemd/system/vaylo-probe.service <<EOF
[Unit]
Description=VAYLO проба доступности по ключу VLESS
[Service]
Type=oneshot
EnvironmentFile=$DIR/env
ExecStart=/usr/bin/env node $DIR/probe.mjs
SuccessExitStatus=0 3
EOF
cat > /etc/systemd/system/vaylo-probe.timer <<EOF
[Unit]
Description=Запуск пробы VAYLO каждые 10 минут
[Timer]
OnBootSec=1min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now vaylo-probe.timer
echo "Готово. Первый запуск: systemctl start vaylo-probe.service && journalctl -u vaylo-probe.service -n 20 --no-pager"
