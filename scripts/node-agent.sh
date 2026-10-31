#!/usr/bin/env bash
# Агент ноды: раз в минуту сообщает панели VPN-платформы свой публичный IP (определяется по источнику запроса).
# Установка:  curl -fsSL <API>/api/v1/node-agent/install.sh | sudo bash -s -- <API> <TOKEN>
set -euo pipefail
API="${1:?API url}"; TOKEN="${2:?token}"
[ "$(id -u)" = 0 ] || { echo "Запустите от root (sudo)"; exit 1; }
install -d -m 755 /opt/node-agent
umask 077
cat > /etc/node-agent.env <<ENV
API=${API%/}
TOKEN=${TOKEN}
ENV
cat > /opt/node-agent/report.sh <<'SH'
#!/usr/bin/env bash
set -u
. /etc/node-agent.env
curl -fsS -m 20 -X POST -H "x-node-token: $TOKEN" "$API/api/v1/node-agent/report" -o /dev/null \
  || logger -t node-agent "report failed"
SH
chmod 755 /opt/node-agent/report.sh
cat > /etc/systemd/system/node-agent.service <<'UNIT'
[Unit]
Description=VPN node IP reporter
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/node-agent/report.sh
UNIT
cat > /etc/systemd/system/node-agent.timer <<'UNIT'
[Unit]
Description=VPN node IP reporter timer
[Timer]
OnBootSec=15
OnUnitActiveSec=60
AccuracySec=5
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now node-agent.timer
systemctl start node-agent.service || true
echo "Агент установлен. Проверка: systemctl status node-agent.timer"
