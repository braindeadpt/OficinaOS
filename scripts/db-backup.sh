#!/usr/bin/env bash
# OficinaOS database backup with retention.
# Runs inside the db-backup container (postgres:16-alpine) on a daily cron,
# or manually: docker compose exec db-backup /scripts/run-backup.sh
#
# Output: gzipped plain-format SQL dumps named oficinaos-<UTC stamp>.sql.gz
# plus a heartbeat file the app reads for the "last backup" indicator.
# When BACKUP_REMOTE_ENABLED=true, every dump is also copied to an S3-compatible
# object store via rclone (second destination) and a weekly restore verification
# of the remote copy runs against a throwaway database.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
HEARTBEAT_DIR="${HEARTBEAT_DIR:-/heartbeat}"
PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-reparilo}"
PGDATABASE="${PGDATABASE:-reparilo}"
export PGPASSWORD="${PGPASSWORD:-reparilo}"

# ─── Off-site copy (second destination, optional) ─────────────────────
# BACKUP_REMOTE_ENABLED=true activates the rclone copy; BACKUP_RCLONE_REMOTE
# is any rclone destination (S3, B2, GCS, ...), e.g. "gcs:bucket/prefix".
# Credentials follow rclone's standard env-var config (e.g. RCLONE_CONFIG_GCS_TYPE,
# RCLONE_CONFIG_GCS_ACCESS_KEY_ID, ...). Failure of the off-site copy is
# reported loud but never blocks or invalidates the local dump.
BACKUP_REMOTE_ENABLED="${BACKUP_REMOTE_ENABLED:-false}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"
RESTORE_CHECK_INTERVAL_DAYS="${RESTORE_CHECK_INTERVAL_DAYS:-7}"
RESTORE_CHECK_SCRIPT="${RESTORE_CHECK_SCRIPT:-/scripts/run-restore-check.sh}"
RESTORE_CHECK_STATE="$HEARTBEAT_DIR/last-restore-check-attempt.txt"

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

# ─── Off-site copy to object storage (best-effort) ────────────────────
if [ "$BACKUP_REMOTE_ENABLED" = "true" ] && [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "[backup] copying to remote: $BACKUP_RCLONE_REMOTE"
    if rclone copyto "$TARGET" "$BACKUP_RCLONE_REMOTE/$(basename "$TARGET")"; then
      echo "[backup] remote copy ok"
      printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "$HEARTBEAT_DIR/last-remote-copy.txt"
      # Remote retention mirrors the local one (best-effort).
      rclone delete "$BACKUP_RCLONE_REMOTE" \
        --include 'oficinaos-*.sql.gz' \
        --min-age "${RETENTION_DAYS}d" >/dev/null 2>&1 || \
        echo "[backup] warn: remote retention pass failed" >&2
    else
      echo "[backup] ERROR: remote copy failed - local dump is still valid" >&2
    fi
  else
    echo "[backup] ERROR: BACKUP_REMOTE_ENABLED but rclone not installed" >&2
  fi
fi

# ─── Weekly restore verification of the remote copy (best-effort) ─────
# Due when the last check attempt is older than the interval - attempts are
# recorded even on failure so a permanently broken check cannot hammer the
# remote/store every day.
if [ "$BACKUP_REMOTE_ENABLED" = "true" ] && [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  DUE=true
  if [ -f "$RESTORE_CHECK_STATE" ]; then
    LAST=$(cat "$RESTORE_CHECK_STATE" 2>/dev/null || echo 0)
    [ -z "$LAST" ] && LAST=0
    NOW=$(date -u +%s)
    AGE=$(( NOW - LAST ))
    [ "$AGE" -lt $(( RESTORE_CHECK_INTERVAL_DAYS * 86400 )) ] && DUE=false
  fi
  if [ "$DUE" = "true" ]; then
    date -u +%s > "$RESTORE_CHECK_STATE"
    if command -v rclone >/dev/null 2>&1 && [ -x "$RESTORE_CHECK_SCRIPT" ]; then
      echo "[backup] running weekly restore verification"
      "$RESTORE_CHECK_SCRIPT" || \
        echo "[backup] ERROR: restore verification failed - check the remote copy" >&2
    elif [ ! -x "$RESTORE_CHECK_SCRIPT" ]; then
      echo "[backup] warn: restore-check script not found at $RESTORE_CHECK_SCRIPT" >&2
    fi
  fi
fi

# Heartbeat read by the app for the settings "last backup" indicator.
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HEARTBEAT_DIR/last-backup.txt"

# Retention: keep the newest RETENTION_DAYS dumps, delete the rest.
ls -1t "$BACKUP_DIR"/oficinaos-*.sql.gz 2>/dev/null | tail -n +$((RETENTION_DAYS + 1)) | while IFS= read -r old; do
  echo "[backup] pruning $old"
  rm -f "$old"
done
