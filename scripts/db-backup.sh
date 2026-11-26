#!/usr/bin/env bash
# Backup da base de dados OficinaOS com retenção.
#
# Modo seguro (instalações alojadas do ponto): pg_dump -Fc cifrado
# diretamente com age antes de qualquer escrita final ou envio remoto. A
# chave privada nunca é necessária neste servidor.
#
# BACKUP_REQUIRE_ENCRYPTION=true torna a chave pública obrigatória. Sem esse
# requisito explícito, o formato legado .sql.gz continua disponível para
# instalações antigas que ainda não migraram.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
HEARTBEAT_DIR="${HEARTBEAT_DIR:-/heartbeat}"
PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-reparilo}"
PGDATABASE="${PGDATABASE:-reparilo}"
export PGPASSWORD="${PGPASSWORD:-reparilo}"

BACKUP_REMOTE_ENABLED="${BACKUP_REMOTE_ENABLED:-false}"
BACKUP_REQUIRE_ENCRYPTION="${BACKUP_REQUIRE_ENCRYPTION:-false}"
BACKUP_AGE_PUBLIC_KEY="${BACKUP_AGE_PUBLIC_KEY:-}"
BACKUP_ALERT_WEBHOOK_URL="${BACKUP_ALERT_WEBHOOK_URL:-}"
BACKUP_ALERT_LABEL="${BACKUP_ALERT_LABEL:-oficinaos}"
RESTORE_CHECK_INTERVAL_DAYS="${RESTORE_CHECK_INTERVAL_DAYS:-7}"
RESTORE_CHECK_SCRIPT="${RESTORE_CHECK_SCRIPT:-/scripts/run-restore-check.sh}"
RESTORE_CHECK_STATE="$HEARTBEAT_DIR/last-restore-check-attempt.txt"
ALERT_FILE="$HEARTBEAT_DIR/backup-alert.txt"

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "[backup] ERROR: RETENTION_DAYS tem de ser numérico" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR" "$HEARTBEAT_DIR"

write_failure_alert() {
  rc="$1"
  set +e
  printf '%s exit_code=%s database=%s host=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" "$PGDATABASE" "$PGHOST" \
    >"$ALERT_FILE" 2>/dev/null
  if [ -n "$BACKUP_ALERT_WEBHOOK_URL" ] && command -v curl >/dev/null 2>&1; then
    label="$(printf '%s' "$BACKUP_ALERT_LABEL" | tr -d '\r\n' | sed 's/[\\"]/\\&/g')"
    curl -fsS --max-time 10 -X POST \
      -H 'Content-Type: application/json' \
      --data "{\"text\":\"Backup OficinaOS falhou em ${label} (código ${rc})\"}" \
      "$BACKUP_ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

trap 'rc=$?; if [ "$rc" -ne 0 ]; then write_failure_alert "$rc"; fi' EXIT

if [ "${BACKUP_ONCE_PER_DAY:-false}" = "true" ] && [ "${BACKUP_FORCE:-false}" != "true" ] && [ -f "$HEARTBEAT_DIR/last-backup.txt" ]; then
  LAST_BACKUP_DATE="$(cut -c1-10 "$HEARTBEAT_DIR/last-backup.txt" 2>/dev/null || true)"
  if [ "$LAST_BACKUP_DATE" = "$(date -u +%F)" ]; then
    ALREADY_DONE=true
    if [ -n "${BACKUP_AGE_PUBLIC_KEY:-}" ]; then
      TODAY_COMPACT="$(date -u +%Y%m%d)"
      TODAY_ENCRYPTED=false
      for existing in "$BACKUP_DIR"/oficinaos-"$TODAY_COMPACT"-*.dump.age; do
        [ -f "$existing" ] && TODAY_ENCRYPTED=true && break
      done
      [ "$TODAY_ENCRYPTED" != "true" ] && ALREADY_DONE=false
    fi
    if [ "$ALREADY_DONE" = "true" ]; then
      echo "[backup] já existe um backup concluído hoje; nada a fazer"
      exit 0
    fi
  fi
fi

ENCRYPTED=false
if [ -n "$BACKUP_AGE_PUBLIC_KEY" ]; then
  ENCRYPTED=true
fi
if [ "$BACKUP_REQUIRE_ENCRYPTION" = "true" ] && [ "$ENCRYPTED" != "true" ]; then
  echo "[backup] ERROR: BACKUP_REQUIRE_ENCRYPTION=true mas falta BACKUP_AGE_PUBLIC_KEY" >&2
  exit 2
fi
if [ "$ENCRYPTED" = "true" ]; then
  command -v age >/dev/null 2>&1 || {
    echo "[backup] ERROR: age não está instalado" >&2
    exit 1
  }
  # age autentica o conteúdo mas não o produtor: qualquer escritor do bucket
  # pode cifrar com a chave pública. minisign autentica este servidor com um
  # par de chaves separado da chave privada age (que nunca entra aqui).
  BACKUP_SIGN_SECRET_KEY_FILE="${BACKUP_SIGN_SECRET_KEY_FILE:-/backup-keys/backup-signing.key}"
  BACKUP_SIGN_PUBLIC_KEY_FILE="${BACKUP_SIGN_PUBLIC_KEY_FILE:-/backup-keys/backup-signing.pub}"
  command -v minisign >/dev/null 2>&1 || {
    echo "[backup] ERROR: minisign não está instalado" >&2
    exit 1
  }
  if [ ! -s "$BACKUP_SIGN_SECRET_KEY_FILE" ] && [ ! -s "$BACKUP_SIGN_PUBLIC_KEY_FILE" ]; then
    # Primeira execução num volume persistente: gerar uma vez. O instalador
    # alojado também o faz, mas isto mantém o compose genérico funcional.
    mkdir -p "$(dirname "$BACKUP_SIGN_SECRET_KEY_FILE")"
    (umask 077; minisign -G -W -f \
      -p "$BACKUP_SIGN_PUBLIC_KEY_FILE" \
      -s "$BACKUP_SIGN_SECRET_KEY_FILE" >/dev/null 2>&1)
  fi
  if [ ! -s "$BACKUP_SIGN_SECRET_KEY_FILE" ] || [ ! -s "$BACKUP_SIGN_PUBLIC_KEY_FILE" ]; then
    echo "[backup] ERROR: par de chaves de assinatura em /backup-keys incompleto ou não gerado" >&2
    exit 1
  fi
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
if [ "$ENCRYPTED" = "true" ]; then
  TARGET="$BACKUP_DIR/oficinaos-$STAMP-$$.dump.age"
  TMP_TARGET="$TARGET.tmp"
  rm -f "$TMP_TARGET"
  echo "[backup] dumping+cifrando $PGDATABASE@$PGHOST:$PGPORT -> $TARGET"
  pg_dump \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" \
    --format=custom \
    --no-owner \
    --no-privileges \
    | age -r "$BACKUP_AGE_PUBLIC_KEY" >"$TMP_TARGET"
  mv "$TMP_TARGET" "$TARGET"
  rm -f "$TARGET.minisig"
  minisign -qS -m "$TARGET" -s "$BACKUP_SIGN_SECRET_KEY_FILE" -x "$TARGET.minisig"
else
  TARGET="$BACKUP_DIR/oficinaos-$STAMP-$$.sql.gz"
  echo "[backup] dumping $PGDATABASE@$PGHOST:$PGPORT -> $TARGET"
  pg_dump \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" \
    --format=plain \
    --no-owner \
    --no-privileges \
    | gzip -9 >"$TARGET"
fi

# Fail loud on an empty dump: a silent zero-byte backup is worse than none.
if [ ! -s "$TARGET" ]; then
  echo "[backup] ERROR: dump file is empty, removing it" >&2
  rm -f "$TARGET"
  exit 1
fi

echo "[backup] ok: $(du -h "$TARGET" | cut -f1)"

# Retenção local antes do envio remoto: falhas de rede/credenciais não podem
# deixar acumular dumps diários até encher o disco.
shopt -s nullglob
backup_files=( "$BACKUP_DIR"/oficinaos-*.dump.age "$BACKUP_DIR"/oficinaos-*.sql.gz )
if [ "${#backup_files[@]}" -gt 0 ]; then
  printf '%s\n' "${backup_files[@]}" |
    sort -r |
    tail -n +$((RETENTION_DAYS + 1)) |
    while IFS= read -r old; do
      echo "[backup] pruning $old"
      rm -f "$old" "$old.minisig"
    done
fi

if [ "$BACKUP_REMOTE_ENABLED" = "true" ]; then
  # shellcheck source=db-backup-remote.sh
  . "$(dirname "$0")/db-backup-remote.sh"
  backup_remote_target
  REMOTE="$BACKUP_REMOTE_TARGET"
  command -v rclone >/dev/null 2>&1 || {
    echo "[backup] ERROR: BACKUP_REMOTE_ENABLED=true mas rclone não está instalado" >&2
    exit 1
  }

  echo "[backup] copying to remote object storage"
  if ! rclone copyto "$TARGET" "$REMOTE/$(basename "$TARGET")"; then
    echo "[backup] ERROR: remote copy failed" >&2
    exit 1
  fi
  if [ "$ENCRYPTED" = "true" ] && ! rclone copyto "$TARGET.minisig" "$REMOTE/$(basename "$TARGET").minisig"; then
    # Não deixar um objeto sem assinatura como "mais recente": o verificador
    # rejeita-o corretamente, mas escondia o backup assinado anterior.
    rclone deletefile "$REMOTE/$(basename "$TARGET")" >/dev/null 2>&1 || true
    echo "[backup] ERROR: remote signature copy failed" >&2
    exit 1
  fi
  echo "[backup] remote copy ok"
  printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$HEARTBEAT_DIR/last-remote-copy.txt"

  # Retenção no destino: apaga objetos mais velhos que RETENTION_DAYS. É
  # propositadamente independente da retenção local.
  if ! rclone delete "$REMOTE" \
    --include 'oficinaos-*.dump.age' \
    --include 'oficinaos-*.sql.gz' \
    --include 'oficinaos-*.minisig' \
    --min-age "${RETENTION_DAYS}d"; then
    echo "[backup] ERROR: remote retention pass failed" >&2
    exit 1
  fi

  # O teste mensal corre noutra máquina; o marcador remoto é a única ponte
  # possível para o painel local saber que esse teste passou. Best-effort:
  # nunca falha o backup só porque ainda não há verificação publicada.
  rclone copyto "$REMOTE/restore-check-status/last-restore-check.txt" \
    "$HEARTBEAT_DIR/last-restore-check.txt" >/dev/null 2>&1 || true
fi

# Nas instalações legadas sem cifragem, preservar a verificação periódica que
# já existia. Backups cifrados têm de ser verificados noutra máquina com a
# chave privada; por isso o agendamento mensal seguro está documentado fora
# deste servidor.
if [ "$BACKUP_REMOTE_ENABLED" = "true" ] && [ "$ENCRYPTED" != "true" ]; then
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
      echo "[backup] running legacy restore verification"
      RESTORE_CHECK_REQUIRE_PONTO=false "$RESTORE_CHECK_SCRIPT" || \
        echo "[backup] ERROR: restore verification failed - check the remote copy" >&2
    elif [ ! -x "$RESTORE_CHECK_SCRIPT" ]; then
      echo "[backup] warn: restore-check script not found at $RESTORE_CHECK_SCRIPT" >&2
    fi
  fi
fi

# Heartbeat read by the app for the settings "last backup" indicator. Só é
# escrito depois de upload e retenções: uma falha posterior nunca marca o dia
# como concluído nem impede a nova tentativa agendada/manual.
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HEARTBEAT_DIR/last-backup.txt"
rm -f "$ALERT_FILE"
