#!/usr/bin/env bash
# Verificação de restauro dos backups off-site.
#
# Pensado para correr numa máquina de operador que tenha a chave privada age —
# nunca no servidor de produção. Descarrega o backup mais recente, decifra-o,
# restaura numa base temporária, valida registos de ponto e apaga a base no fim.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/tmp/oficinaos-restore-check}"
HEARTBEAT_DIR="${HEARTBEAT_DIR:-$BACKUP_DIR/heartbeat}"
CHECK_DB="${RESTORE_CHECK_DB:-restore_check_$$}"
MAX_ENTRY_AGE_DAYS="${RESTORE_CHECK_MAX_ENTRY_AGE_DAYS:-35}"

PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-reparilo}"
export PGPASSWORD="${PGPASSWORD:-reparilo}"

case "$CHECK_DB" in
  ''|*[!a-zA-Z0-9_]*) echo "[restore-check] ERROR: RESTORE_CHECK_DB só pode ter letras, dígitos e underscore" >&2; exit 2 ;;
esac
case "$MAX_ENTRY_AGE_DAYS" in
  ''|*[!0-9]*) echo "[restore-check] ERROR: RESTORE_CHECK_MAX_ENTRY_AGE_DAYS tem de ser numérico" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR" "$HEARTBEAT_DIR"
command -v rclone >/dev/null 2>&1 || {
  echo "[restore-check] ERROR: rclone não está instalado" >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  echo "[restore-check] ERROR: psql não está instalado" >&2
  exit 1
}

# shellcheck source=db-backup-remote.sh
. "$(dirname "$0")/db-backup-remote.sh"
backup_remote_target
REMOTE="$BACKUP_REMOTE_TARGET"

TARGET_FILE="$(rclone lsf "$REMOTE" --files-only --max-depth 1 \
  --include 'oficinaos-*.dump.age' \
  --include 'oficinaos-*.sql.gz' \
  --include 'oficinaos-*.dump' 2>/dev/null | sort | tail -n 1 || true)"
if [ -z "$TARGET_FILE" ]; then
  echo "[restore-check] ERROR: não há backups em $REMOTE" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DOWNLOAD_PATH="$BACKUP_DIR/restore-check-$STAMP-$TARGET_FILE"
PLAIN_PATH=""
TMP_KEY=""
SIG_PATH=""
umask 077

cleanup() {
  set +e
  psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
    --dbname=postgres --set=ON_ERROR_STOP=1 --quiet \
    --command="DROP DATABASE IF EXISTS \"$CHECK_DB\";" >/dev/null 2>&1
  rm -f "$DOWNLOAD_PATH" "$PLAIN_PATH" "$TMP_KEY" "$SIG_PATH"
}
trap cleanup EXIT

echo "[restore-check] downloading $REMOTE/$TARGET_FILE"
rclone copyto "$REMOTE/$TARGET_FILE" "$DOWNLOAD_PATH"
if [ ! -s "$DOWNLOAD_PATH" ]; then
  echo "[restore-check] ERROR: ficheiro descarregado está vazio" >&2
  exit 1
fi

case "$TARGET_FILE" in
  *.dump.age)
    command -v age >/dev/null 2>&1 || {
      echo "[restore-check] ERROR: age não está instalado" >&2
      exit 1
    }
    KEY_FILE="${BACKUP_AGE_KEY_FILE:-}"
    if [ -z "$KEY_FILE" ] && [ -n "${BACKUP_AGE_PRIVATE_KEY:-}" ]; then
      TMP_KEY="$(mktemp)"
      chmod 600 "$TMP_KEY"
      printf '%s\n' "$BACKUP_AGE_PRIVATE_KEY" >"$TMP_KEY"
      KEY_FILE="$TMP_KEY"
    fi
    if [ -z "$KEY_FILE" ] || [ ! -r "$KEY_FILE" ]; then
      echo "[restore-check] ERROR: define BACKUP_AGE_KEY_FILE (recomendado) ou BACKUP_AGE_PRIVATE_KEY" >&2
      exit 2
    fi
    BACKUP_SIGN_SECRET_KEY_FILE="${BACKUP_SIGN_SECRET_KEY_FILE:-}"
    if [ -z "$BACKUP_SIGN_SECRET_KEY_FILE" ] || [ ! -r "$BACKUP_SIGN_SECRET_KEY_FILE" ]; then
      echo "[restore-check] ERROR: define BACKUP_SIGN_SECRET_KEY_FILE com a chave minisign da instância" >&2
      exit 2
    fi
    command -v minisign >/dev/null 2>&1 || {
      echo "[restore-check] ERROR: minisign não está instalado" >&2
      exit 1
    }
    SIG_PATH="$DOWNLOAD_PATH.minisig"
    if ! rclone copyto "$REMOTE/$TARGET_FILE.minisig" "$SIG_PATH" 2>/dev/null; then
      echo "[restore-check] ERROR: assinatura do backup em falta no destino remoto" >&2
      exit 1
    fi
    if [ -n "${BACKUP_SIGN_PUBLIC_KEY_FILE:-}" ]; then
      minisign -qV -m "$DOWNLOAD_PATH" -p "$BACKUP_SIGN_PUBLIC_KEY_FILE" -x "$SIG_PATH" || {
        echo "[restore-check] ERROR: assinatura do backup inválida" >&2
        exit 1
      }
    elif [ -n "${BACKUP_SIGN_PUBLIC_KEY:-}" ]; then
      minisign -qV -m "$DOWNLOAD_PATH" -P "$BACKUP_SIGN_PUBLIC_KEY" -x "$SIG_PATH" || {
        echo "[restore-check] ERROR: assinatura do backup inválida" >&2
        exit 1
      }
    else
      echo "[restore-check] ERROR: define BACKUP_SIGN_PUBLIC_KEY_FILE ou BACKUP_SIGN_PUBLIC_KEY" >&2
      exit 2
    fi
    PLAIN_PATH="$BACKUP_DIR/restore-check-$STAMP.dump"
    echo "[restore-check] decrypting backup"
    age -d -i "$KEY_FILE" -o "$PLAIN_PATH" "$DOWNLOAD_PATH"
    ;;
  *.dump)
    PLAIN_PATH="$DOWNLOAD_PATH"
    ;;
  *.sql.gz)
    PLAIN_PATH=""
    ;;
  *)
    echo "[restore-check] ERROR: formato de backup não suportado: $TARGET_FILE" >&2
    exit 1
    ;;
esac

echo "[restore-check] restoring into throwaway database '$CHECK_DB'"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname=postgres --set=ON_ERROR_STOP=1 --quiet \
  --command="DROP DATABASE IF EXISTS \"$CHECK_DB\";" \
  --command="CREATE DATABASE \"$CHECK_DB\";"

case "$TARGET_FILE" in
  *.dump|*.dump.age)
    command -v pg_restore >/dev/null 2>&1 || {
      echo "[restore-check] ERROR: pg_restore não está instalado" >&2
      exit 1
    }
    # Gerar SQL a partir do formato custom em vez de ligar pg_restore
    # diretamente à BD: pg_dump/pg_restore 18+ emitem `SET transaction_timeout`,
    # um GUC que não existe em Postgres <= 16. Sem ligação é só texto e pode
    # ser filtrado como já fazíamos nos dumps plain legados.
    pg_restore --no-owner --no-privileges -f - "$PLAIN_PATH" \
      | sed '/^SET transaction_timeout\b/d' \
      | psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
        --dbname="$CHECK_DB" --set=ON_ERROR_STOP=1 --quiet
    ;;
  *.sql.gz)
    # Backups legados plain SQL. pg_dump >= 17 escreve um GUC que não existe
    # em Postgres <= 16; a linha é inócua para o restauro.
    gunzip -c "$DOWNLOAD_PATH" | sed '/^SET transaction_timeout\b/d' | psql \
      --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
      --dbname="$CHECK_DB" --set=ON_ERROR_STOP=1 --quiet
    ;;
esac

if [ "${RESTORE_CHECK_REQUIRE_PONTO:-true}" = "true" ]; then
  ENTRY_COUNT="$(psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
    --dbname="$CHECK_DB" --tuples-only --no-align \
    --command='SELECT count(*) FROM time_entries;' | tr -d '[:space:]')"
  RECENT_OK="$(psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
    --dbname="$CHECK_DB" --tuples-only --no-align \
    --command="SELECT CASE WHEN max(at) IS NOT NULL AND max(at) > now() - interval '${MAX_ENTRY_AGE_DAYS} days' THEN 1 ELSE 0 END FROM time_entries;" \
    | tr -d '[:space:]')"

  if ! [[ "$ENTRY_COUNT" =~ ^[0-9]+$ ]] || [ "$ENTRY_COUNT" -eq 0 ]; then
    echo "[restore-check] ERROR: restauro sem registos de ponto" >&2
    exit 1
  fi
  if [ "$RECENT_OK" != "1" ]; then
    echo "[restore-check] ERROR: última picagem não está dentro de ${MAX_ENTRY_AGE_DAYS} dias" >&2
    exit 1
  fi
  VERIFY_MESSAGE="$ENTRY_COUNT registos de ponto"
else
  # Compatibilidade com a verificação legada de instalações OficinaOS que
  # ainda não são só-ponto: antes desta tarefa o teste apenas provava que o
  # dump restaurava tabelas.
  TABLE_COUNT="$(psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
    --dbname="$CHECK_DB" --tuples-only --no-align \
    --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
    | tr -d '[:space:]')"
  if ! [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]] || [ "$TABLE_COUNT" -eq 0 ]; then
    echo "[restore-check] ERROR: restauro sem tabelas públicas" >&2
    exit 1
  fi
  VERIFY_MESSAGE="$TABLE_COUNT tabelas públicas"
fi

RESTORE_CHECK_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' "$RESTORE_CHECK_AT" \
  > "$HEARTBEAT_DIR/last-restore-check.txt"
# Marcador remoto pequeno e sem dados, fora dos padrões de retenção dos dumps.
# É assinado antes de sair: o servidor só o aceita com assinatura
# válida, por isso um escritor do bucket não consegue forjar "restauro OK".
printf '%s\n' "$RESTORE_CHECK_AT" > "$BACKUP_DIR/last-restore-check-remote.txt"
if [ -n "${BACKUP_SIGN_SECRET_KEY_FILE:-}" ]; then
  minisign -qS -m "$BACKUP_DIR/last-restore-check-remote.txt" \
    -s "$BACKUP_SIGN_SECRET_KEY_FILE" \
    -x "$BACKUP_DIR/last-restore-check-remote.txt.minisig"
  if ! rclone copyto "$BACKUP_DIR/last-restore-check-remote.txt" \
    "$REMOTE/restore-check-status/last-restore-check.txt" 2>/dev/null || \
     ! rclone copyto "$BACKUP_DIR/last-restore-check-remote.txt.minisig" \
    "$REMOTE/restore-check-status/last-restore-check.txt.minisig" 2>/dev/null; then
    echo "[restore-check] ERROR: não foi possível publicar o marcador assinado de verificação" >&2
    rm -f "$BACKUP_DIR/last-restore-check-remote.txt" "$BACKUP_DIR/last-restore-check-remote.txt.minisig"
    exit 1
  fi
  rm -f "$BACKUP_DIR/last-restore-check-remote.txt" "$BACKUP_DIR/last-restore-check-remote.txt.minisig"
fi

echo "[restore-check] ok: $VERIFY_MESSAGE restaurados de $TARGET_FILE; base temporária removida"
