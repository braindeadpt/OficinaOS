#!/usr/bin/env bash
# OficinaOS database restore from a backup produced by run-backup.sh.
# Usage (host):  docker compose exec -T db-backup /scripts/run-restore.sh <file.sql.gz>
# Pauses 10 seconds before touching anything unless RESTORE_AUTO_CONFIRM=1
# is set (used by the CI round-trip test).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-reparilo}"
PGDATABASE="${PGDATABASE:-reparilo}"
export PGPASSWORD="${PGPASSWORD:-reparilo}"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "usage: run-restore.sh <oficinaos-YYYYmmdd-HHMMSS.sql.gz>" >&2
  echo "       (relative paths resolve inside $BACKUP_DIR)" >&2
  exit 2
fi
case "$FILE" in
  /*) SOURCE="$FILE" ;;
  *)  SOURCE="$BACKUP_DIR/$FILE" ;;
esac

if [ ! -f "$SOURCE" ] || [ ! -s "$SOURCE" ]; then
  echo "ERROR: backup file not found or empty: $SOURCE" >&2
  exit 1
fi

echo "About to RESTORE database '$PGDATABASE@$PGHOST' from:"
echo "  $SOURCE ($(du -h "$SOURCE" | cut -f1))"
echo "ALL CURRENT DATA IN THIS DATABASE WILL BE REPLACED."
if [ "${RESTORE_AUTO_CONFIRM:-0}" != "1" ]; then
  echo "Continuing in 10 seconds - press Ctrl+C to abort."
  sleep 10
fi

echo "[restore] dropping and recreating schema public"
psql \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$PGDATABASE" --set=ON_ERROR_STOP=1 --quiet <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
SQL

echo "[restore] applying backup"
gunzip -c "$SOURCE" | psql \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$PGDATABASE" --set=ON_ERROR_STOP=1 --quiet

TABLES="$(psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$PGDATABASE" --tuples-only --no-align \
  --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d '[:space:]')"
echo "[restore] done: $TABLES tables restored from $(basename "$SOURCE")"
