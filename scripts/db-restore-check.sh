#!/usr/bin/env bash
# OficinaOS weekly restore verification of the off-site backup copy.
#
# Downloads the newest dump from the remote object store and restores it
# into a throwaway database — the live database is never touched. Writes
# a heartbeat (last-restore-check.txt) that the app surfaces in Settings.
#
# Runs weekly from the db-backup container when BACKUP_REMOTE_ENABLED=true;
# manual run: docker compose exec db-backup /scripts/run-restore-check.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
HEARTBEAT_DIR="${HEARTBEAT_DIR:-/heartbeat}"
RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-gcs:oficinaos-backups}"
CHECK_DB="${RESTORE_CHECK_DB:-restore_check}"

PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-reparilo}"
export PGPASSWORD="${PGPASSWORD:-reparilo}"

command -v rclone >/dev/null 2>&1 || {
  echo "[restore-check] ERROR: rclone not available" >&2
  exit 1
}

# Newest remote object. The UTC-stamped names sort chronologically.
TARGET_FILE="$(rclone lsf "$RCLONE_REMOTE" --files-only --max-depth 1 \
  --include 'oficinaos-*.sql.gz' 2>/dev/null | sort | tail -n 1 || true)"
if [ -z "$TARGET_FILE" ]; then
  echo "[restore-check] ERROR: no backups found in $RCLONE_REMOTE" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
LOCAL_PATH="$BACKUP_DIR/restore-check-$STAMP.sql.gz"
echo "[restore-check] downloading $RCLONE_REMOTE/$TARGET_FILE"
rclone copyto "$RCLONE_REMOTE/$TARGET_FILE" "$LOCAL_PATH"

if [ ! -s "$LOCAL_PATH" ]; then
  echo "[restore-check] ERROR: downloaded file is empty" >&2
  exit 1
fi

# Throwaway database only: a bad dump can never touch live data.
echo "[restore-check] restoring into throwaway database '$CHECK_DB'"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname=postgres --set=ON_ERROR_STOP=1 --quiet \
  --command="DROP DATABASE IF EXISTS \"$CHECK_DB\";" \
  --command="CREATE DATABASE \"$CHECK_DB\";"

gunzip -c "$LOCAL_PATH" | psql \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$CHECK_DB" --set=ON_ERROR_STOP=1 --quiet

TABLES="$(psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$CHECK_DB" --tuples-only --no-align \
  --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
  | tr -d '[:space:]')"

# Heartbeat is written only on success: a failed check leaves the old
# (or missing) timestamp in place and the UI flags it.
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$HEARTBEAT_DIR/last-restore-check.txt"

# Cleanup happens after the heartbeat so a cleanup failure cannot mask
# a successful verification.
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname=postgres --set=ON_ERROR_STOP=1 --quiet \
  --command="DROP DATABASE IF EXISTS \"$CHECK_DB\";" || true
rm -f "$LOCAL_PATH"

echo "[restore-check] ok: $TABLES tables restored from $TARGET_FILE"
