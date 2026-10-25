#!/usr/bin/env bash
# Hourly demo reset — thin wrapper so cron/systemd on the host can call a
# stable path. The infra timer actually invokes the app container:
#   docker exec demo-web bun run demo:reset
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun run demo:reset
