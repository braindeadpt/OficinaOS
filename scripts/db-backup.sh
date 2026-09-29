#!/usr/bin/env bash
# OficinaOS database backup with retention.
# Runs inside the db-backup container (postgres:16-alpine) on a daily cron,
# or manually: docker compose exec db-backup /scripts/run-backup.sh
#
# Output: gzipped plain-format SQL dumps named oficinaos-<UTC stamp>.sql.gz
# plus a heartbeat file the app reads for the "last backup" indicator.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
HEARTBEAT_DIR="${HEARTBEAT_DIR:-/heartbeat}"
PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-reparilo}"
PGDATABASE="${PGDATABASE:-reparilo}"
export PGPASSWORD="${PGPASSWORD:-reparilo}"

mkdir -p "$BACKUP_DIR" "$HEARTBEAT_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/oficinaos-$STAMP.sql.gz"

echo "[backup] dumping $PGDATABASE@$PGHOST:$PGPORT -> $TARGET"
pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --format=plain \
  --no-owner \
  --no-privileges \
  | gzip -9 > "$TARGET"

# Fail loud on an empty dump: a silent zero-byte backup is worse than none.
if [ ! -s "$TARGET" ]; then
  echo "[backup] ERROR: dump file is empty, removing it" >&2
  rm -f "$TARGET"
  exit 1
fi

echo "[backup] ok: $(du -h "$TARGET" | cut -f1)"

# Heartbeat read by the app for the settings "last backup" indicator.
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HEARTBEAT_DIR/last-backup.txt"

# Retention: keep the newest RETENTION_DAYS dumps, delete the rest.
ls -1t "$BACKUP_DIR"/oficinaos-*.sql.gz 2>/dev/null | tail -n +$((RETENTION_DAYS + 1)) | while IFS= read -r old; do
  echo "[backup] pruning $old"
  rm -f "$old"
done
