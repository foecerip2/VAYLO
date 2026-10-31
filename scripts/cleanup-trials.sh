#!/usr/bin/env bash
# By default only lists candidates. --apply explicitly enables deletion.
set -euo pipefail
case "${1:-}" in ''|--apply) ;; *) echo 'Использование: cleanup-trials.sh [--apply]' >&2; exit 2;; esac
cleanup_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$cleanup_root/deploy"
docker compose exec -T api node dist/cli.js cleanup-trials "$@"
