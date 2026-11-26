#!/usr/bin/env bash
# Configuração partilhada do destino remoto dos backups.
# Não contém credenciais: lê apenas variáveis de ambiente fornecidas pelo operador.

backup_remote_target() {
  s3_complete=true
  if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
    s3_complete=false
  fi
  for required in BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
    if [ -z "${!required:-}" ]; then
      s3_complete=false
    fi
  done

  # S3 completo tem prioridade sobre o destino legado numa migração. Se só há
  # parte da configuração S3 e existe um remote legado funcional, não partir o
  # backup: usa-se o legado e o instalador valida a configuração parcial.
  if [ "$s3_complete" != "true" ]; then
    if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
      BACKUP_REMOTE_TARGET="$BACKUP_RCLONE_REMOTE"
      return 0
    fi
    echo "[backup-remote] erro: define BACKUP_RCLONE_REMOTE ou a configuração S3 completa" >&2
    return 1
  fi

  # As credenciais nunca vão em argumentos: o rclone lê esta configuração do ambiente.
  export RCLONE_CONFIG_PONTOBACKUP_TYPE=s3
  export RCLONE_CONFIG_PONTOBACKUP_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
  export RCLONE_CONFIG_PONTOBACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
  export RCLONE_CONFIG_PONTOBACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export RCLONE_CONFIG_PONTOBACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_PONTOBACKUP_REGION="${BACKUP_S3_REGION:-auto}"
  export RCLONE_CONFIG_PONTOBACKUP_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-true}"

  prefix="${BACKUP_S3_PREFIX:-}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  if [ -n "$prefix" ]; then
    BACKUP_REMOTE_TARGET="pontobackup:${BACKUP_S3_BUCKET}/${prefix}"
  else
    BACKUP_REMOTE_TARGET="pontobackup:${BACKUP_S3_BUCKET}"
  fi
}
