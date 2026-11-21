#!/bin/sh
set -e

# Volumes created by the older root-running image are root-owned — fix
# ownership at start (new volumes get it from the image itself), then drop
# to the non-root bun user for the app process.
chown -R bun:bun /app/uploads 2>/dev/null || true

exec su -s /bin/sh bun -c 'export HOME=/home/bun; cd /app; exec bun run start:prod'
