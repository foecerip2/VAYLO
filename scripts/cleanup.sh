#!/usr/bin/env bash
# VAYLO daily maintenance: caches and journal only. No database/volume/backup deletion.
# bash cleanup.sh --dry-run --dir /opt/vpn-platform
# sudo bash cleanup.sh --install --dir /opt/vpn-platform
set -Eeuo pipefail
umask 077
TASK_DIR=/opt/vpn-platform
if [[ "${BASH_SOURCE[0]}" == */scripts/cleanup.sh ]]; then
  TASK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
fi
DRY=0; INSTALL_TIMER=0; LEGACY_FLAGS=0
usage() {
 cat <<'HELP'
VAYLO: безопасная очистка кэшей и системного журнала.
  --dir ПУТЬ   каталог проекта (по умолчанию /opt/vpn-platform)
  --dry-run    только показать действия, ничего не удалять
  --install    установить ежедневный systemd timer, 04:15 по времени сервера
  --help       эта справка
БД, Docker-тома, контейнеры, бэкапы, .env, SSH и образы :local/:prev не удаляются.
HELP
}
while (($#)); do
 case "$1" in
  --dir) (($#>=2)) || { echo '--dir требует путь' >&2; exit 2; }; TASK_DIR=$2; shift 2;;
  --dry-run|-n) DRY=1; shift;;
  --install) INSTALL_TIMER=1; shift;;
  # Compatibility with older installers; these options no longer widen the cleanup.
  --deep) LEGACY_FLAGS=1; shift;;
  --keep) (($#>=2)) && [[ $2 =~ ^[1-9][0-9]*$ ]] || { echo '--keep требует положительное число' >&2; exit 2; }; LEGACY_FLAGS=1; shift 2;;
  --keep=*) [[ ${1#--keep=} =~ ^[1-9][0-9]*$ ]] || exit 2; LEGACY_FLAGS=1; shift;;
  --help|-h) usage; exit 0;;
  *) echo "Неизвестный параметр: $1" >&2; usage >&2; exit 2;;
 esac
done
[[ "$TASK_DIR" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo 'Нужен абсолютный путь без пробелов и специальных символов.' >&2; exit 2; }
TASK_DIR=$(realpath -e -- "$TASK_DIR") || exit 2
[[ "$TASK_DIR" != / && -f "$TASK_DIR/deploy/docker-compose.yml" ]] || { echo 'В каталоге не найден deploy/docker-compose.yml проекта.' >&2; exit 2; }
if ((DRY==0)) && [[ $(id -u) != 0 ]]; then echo 'Запустите через sudo. Предпросмотр --dry-run доступен без root.' >&2; exit 1; fi
LABEL_PROJECT=${COMPOSE_PROJECT:-vpn}
[[ $LABEL_PROJECT =~ ^[a-zA-Z0-9_.-]+$ ]] || { echo 'Некорректный COMPOSE_PROJECT' >&2; exit 2; }
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
if ((LEGACY_FLAGS)); then log 'Параметры --deep/--keep оставлены для совместимости; бэкапы обслуживает backup.sh.'; fi
if ((INSTALL_TIMER)); then
 if ((DRY)); then
  log "Предпросмотр установки: /usr/local/sbin/vaylo-cleanup-daily; проект $TASK_DIR"
  log 'systemd: vaylo-cleanup-daily.service и .timer, каждый день в 04:15 по часовому поясу сервера.'
  log 'Старое задание cron с меткой vpn-platform-cleanup будет заменено таймером. Другие задания сохранятся.'
  exit 0
 fi
 command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || { echo 'Нужен сервер с systemd (например Ubuntu 24.04).' >&2; exit 1; }
 command -v flock >/dev/null || { echo 'Не найден flock (пакет util-linux).' >&2; exit 1; }
 # A stable standalone copy survives project-file synchronisation on update.
 cleanup_source=$(realpath -e -- "${BASH_SOURCE[0]}")
 if [[ $cleanup_source != /usr/local/sbin/vaylo-cleanup-daily ]]; then
  install -m 0755 -- "$cleanup_source" /usr/local/sbin/vaylo-cleanup-daily
 fi
 cat > /etc/systemd/system/vaylo-cleanup-daily.service <<UNIT
[Unit]
Description=VAYLO daily cache cleanup
After=docker.service
ConditionPathExists=$TASK_DIR/deploy/docker-compose.yml

[Service]
Type=oneshot
ExecStart=/bin/bash /usr/local/sbin/vaylo-cleanup-daily --dir $TASK_DIR
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=COMPOSE_PROJECT=$LABEL_PROJECT
Nice=19
IOSchedulingClass=idle
TimeoutStartSec=5min
NoNewPrivileges=true
StandardOutput=journal
StandardError=journal
UNIT
 cat > /etc/systemd/system/vaylo-cleanup-daily.timer <<'TIMER'
[Unit]
Description=Run VAYLO cleanup daily at 04:15

[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true
AccuracySec=1min
Unit=vaylo-cleanup-daily.service

[Install]
WantedBy=timers.target
TIMER
 systemctl daemon-reload
 systemctl enable --now vaylo-cleanup-daily.timer
 # Read success is required before modifying crontab; a read error never wipes it.
 if command -v crontab >/dev/null && cleanup_cron=$(crontab -l 2>/dev/null); then
  printf '%s\n' "$cleanup_cron" | awk '!/# (vpn-platform-cleanup|vaylo-cleanup-daily)[[:space:]]*$/' | crontab -
 fi
 log 'Ежедневная очистка установлена: 04:15 по времени сервера. После выключения сервера пропущенный запуск выполнится при включении.'
 systemctl list-timers --all vaylo-cleanup-daily.timer --no-pager
 exit 0
fi
if ((DRY==0)); then
 command -v flock >/dev/null || { echo 'Не найден flock: очистка отменена.' >&2; exit 1; }
 exec 9>"$TASK_DIR/.cleanup.lock"
 if ! flock -n 9; then log 'Другой запуск очистки уже выполняется. Пропускаю.'; exit 0; fi
 # Avoid competing with a database backup or restoration.
 if [[ -d "$TASK_DIR/backups" ]]; then
  exec 8>"$TASK_DIR/backups/.backup.lock"
  if ! flock -n 8; then log 'Выполняется бэкап. Очистка пропущена.'; exit 0; fi
 fi
 if command -v pgrep >/dev/null && pgrep -f 'bash[[:space:]]+[^[:space:]]*/scripts/(install|restore)\.sh([[:space:]]|$)' >/dev/null; then
  log 'Выполняется установка или восстановление. Очистка пропущена.'; exit 0
 fi
fi
STATUS=0
step() {
 local title=$1; shift
 if ((DRY)); then printf '[предпросмотр] %s: ' "$title"; printf '%q ' "$@"; printf '\n'; return; fi
 log "$title"
 if ! "$@"; then log "Не удалось выполнить: $title"; STATUS=1; fi
}
used_kb() { df -Pk / | awk 'NR==2{print $3}'; }
before_kb=$(used_kb)
log "Начало очистки. Проект: $TASK_DIR. Режим: $([[ $DRY == 1 ]] && echo предпросмотр || echo очистка)."
if command -v docker >/dev/null; then
 if timeout 20 docker info >/dev/null 2>&1; then
  step 'Висячие образы проекта старше 7 дней' docker image prune -f --filter "label=com.docker.compose.project=$LABEL_PROJECT" --filter 'until=168h'
  step 'Неиспользуемый кэш Docker-сборки старше 7 дней; порог хранения 1 ГБ' docker builder prune -f --filter 'until=168h' --keep-storage 1GB
 else log 'Docker недоступен; его очистка пропущена.'; STATUS=1; fi
fi
if command -v apt-get >/dev/null; then step 'Кэш скачанных пакетов apt' apt-get clean; fi
if command -v journalctl >/dev/null; then
 step 'Архив системного журнала: не более 7 дней / 200 МБ' journalctl --rotate --vacuum-time=7d --vacuum-size=200M
fi
if command -v systemd-tmpfiles >/dev/null; then
 step 'Временные файлы по штатным правилам хранения ОС' systemd-tmpfiles --clean --prefix=/tmp --prefix=/var/tmp --exclude-prefix="$TASK_DIR"
fi
after_kb=$(used_kb); freed_mb=$(((before_kb-after_kb)/1024)); ((freed_mb>=0)) || freed_mb=0
log "Завершено. Изменение занятого места на /: освобождено примерно ${freed_mb} МБ."
df -h /
log 'Бэкапы, конфигурация и рабочие данные проекта сохраняются. Образы с тегами и контейнеры остаются.'
exit "$STATUS"
