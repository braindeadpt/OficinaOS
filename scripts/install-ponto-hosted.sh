#!/usr/bin/env bash
# Instalação alojada de uma empresa em modo só-ponto.
# Idempotente: pode ser executada várias vezes com os mesmos dados.

set -euo pipefail

die() {
  echo "ERRO: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "comando '$1' em falta"
}

require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    die "variável obrigatória em falta: $name"
  fi
}

random_hex() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

env_value() {
  local key="$1" file="$2"
  if [ -f "$file" ]; then
    grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
  fi
}

ensure_env_secret() {
  local key="$1" file="$2" current
  current="$(env_value "$key" "$file")"
  if [ -z "$current" ]; then
    current="$(random_hex)"
  fi
  printf '%s=%s\n' "$key" "$current" >>"$file.tmp"
}

copy_env_setting() {
  local key="$1" file="$2" value
  value="${!key:-}"
  if [ -z "$value" ]; then
    value="$(env_value "$key" "$file")"
  fi
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$key" "$value" >>"$file.tmp"
  fi
}

configured_value() {
  local key="$1" file="$2" value
  value="${!key:-}"
  if [ -z "$value" ]; then
    value="$(env_value "$key" "$file")"
  fi
  printf '%s' "$value"
}

b64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

need_cmd docker
need_cmd od
need_cmd base64
need_cmd flock

BOOTSTRAP_ENV=""
cleanup_bootstrap_env() {
  if [ -n "$BOOTSTRAP_ENV" ]; then
    rm -f "$BOOTSTRAP_ENV"
  fi
}
trap cleanup_bootstrap_env EXIT

docker compose version >/dev/null 2>&1 || die "docker compose v2 em falta"

require_var PONTO_CLIENT_SLUG
require_var PONTO_CLIENT_NAME
require_var PONTO_OWNER_NAME
require_var PONTO_OWNER_LOGIN
require_var PONTO_OWNER_PASSWORD
CLOUD_PAIRING_CODE="${CLOUD_PAIRING_CODE:-}"

PONTO_HOST_ROOT="${PONTO_HOST_ROOT:-/opt/oficinaos-ponto}"
PONTO_BASE_DOMAIN="${PONTO_BASE_DOMAIN:-ponto.oficinaos.app}"
PONTO_CLOUD_API_URL="${PONTO_CLOUD_API_URL:-https://cloud.oficinaos.app}"
PONTO_IMAGE="${PONTO_IMAGE:-ghcr.io/braindeadpt/oficinaos:latest}"
PONTO_TZ="${PONTO_TZ:-Europe/Lisbon}"
PONTO_ENABLE_EVOLUTION="${PONTO_ENABLE_EVOLUTION:-true}"
PONTO_ACME_EMAIL="${PONTO_ACME_EMAIL:-admin@oficinaos.app}"
PONTO_NETWORK="${PONTO_NETWORK:-oficinaos-ponto-proxy}"
PONTO_EXISTING_AI_ENCRYPTION_KEY="${PONTO_EXISTING_AI_ENCRYPTION_KEY:-}"
PONTO_BACKUP_ONCALENDAR="${PONTO_BACKUP_ONCALENDAR:-*-*-* 03:17:00}"
PONTO_SCHEDULER="${PONTO_SCHEDULER:-auto}"
PONTO_SYSTEMD_DIR="${PONTO_SYSTEMD_DIR:-}"
PONTO_CRON_DIR="${PONTO_CRON_DIR:-}"

case "$PONTO_CLIENT_SLUG" in
  *[!a-z0-9-]*|"") die "PONTO_CLIENT_SLUG só pode ter minúsculas, dígitos e hífenes" ;;
esac
if [ "${#PONTO_CLIENT_SLUG}" -lt 2 ] || [ "${#PONTO_CLIENT_SLUG}" -gt 40 ]; then
  die "PONTO_CLIENT_SLUG tem de ter 2 a 40 caracteres"
fi
case "$PONTO_CLIENT_SLUG" in
  -*|*-) die "PONTO_CLIENT_SLUG não pode começar nem acabar com hífen" ;;
esac
for var in PONTO_CLIENT_NAME PONTO_OWNER_NAME PONTO_OWNER_LOGIN PONTO_OWNER_PASSWORD CLOUD_PAIRING_CODE; do
  case "${!var}" in
    *$'\n'*|*$'\r'*) die "$var não pode ter quebras de linha" ;;
  esac
done
if [ "${#PONTO_OWNER_PASSWORD}" -lt 10 ]; then
  die "PONTO_OWNER_PASSWORD tem de ter pelo menos 10 caracteres"
fi
if [ -n "$PONTO_EXISTING_AI_ENCRYPTION_KEY" ] && ! printf '%s' "$PONTO_EXISTING_AI_ENCRYPTION_KEY" | grep -qE '^[0-9a-f]{64}$'; then
  die "PONTO_EXISTING_AI_ENCRYPTION_KEY tem de ser hex de 64 caracteres"
fi
case "$PONTO_CLOUD_API_URL" in
  https://*|http://localhost*|http://127.0.0.1*) ;;
  *) die "PONTO_CLOUD_API_URL tem de ser https (ou loopback em desenvolvimento)" ;;
esac
case "$PONTO_BASE_DOMAIN" in
  *[!a-zA-Z0-9.-]*|""|.*|*-|*.-*|*..*) die "PONTO_BASE_DOMAIN inválido" ;;
esac
for var in PONTO_BASE_DOMAIN PONTO_CLOUD_API_URL PONTO_IMAGE PONTO_TZ PONTO_BACKUP_ONCALENDAR; do
  case "${!var}" in
    *$'\n'*|*$'\r'*) die "$var não pode ter quebras de linha" ;;
  esac
done
case "$PONTO_SCHEDULER" in
  auto|systemd|cron|none) ;;
  *) die "PONTO_SCHEDULER tem de ser auto, systemd, cron ou none" ;;
esac

HOSTNAME_CLIENTE="${PONTO_CLIENT_SLUG}.${PONTO_BASE_DOMAIN}"
CLIENT_DIR="${PONTO_HOST_ROOT}/clientes/${PONTO_CLIENT_SLUG}"
PROXY_DIR="${PONTO_HOST_ROOT}/proxy"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

mkdir -p "$CLIENT_DIR/scripts" "$PROXY_DIR"
chmod 700 "$PONTO_HOST_ROOT" "$PONTO_HOST_ROOT/clientes" "$CLIENT_DIR" 2>/dev/null || true

install -m 0755 "$REPO_ROOT/scripts/db-backup.sh" "$CLIENT_DIR/scripts/db-backup.sh"
install -m 0755 "$REPO_ROOT/scripts/db-backup-remote.sh" "$CLIENT_DIR/scripts/db-backup-remote.sh"
install -m 0755 "$REPO_ROOT/scripts/db-restore.sh" "$CLIENT_DIR/scripts/db-restore.sh"
install -m 0755 "$REPO_ROOT/scripts/db-restore-check.sh" "$CLIENT_DIR/scripts/db-restore-check.sh"
install -m 0644 "$REPO_ROOT/scripts/bootstrap-ponto-hosted.ts" "$CLIENT_DIR/bootstrap-ponto-hosted.ts"

ENV_FILE="$CLIENT_DIR/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Preserva segredos já existentes; completa apenas os que faltam. Desta
# forma, correr o instalador outra vez não roda credenciais nem invalida
# sessões/cópias cifradas da instância.
: >"$ENV_FILE.tmp"
for key in POSTGRES_PASSWORD EVOLUTION_DB_PASSWORD BETTER_AUTH_SECRET COOKIE_SECRET AI_ENCRYPTION_KEY SETUP_TOKEN EVOLUTION_API_KEY; do
  ensure_env_secret "$key" "$ENV_FILE"
done
if [ -n "$PONTO_EXISTING_AI_ENCRYPTION_KEY" ] && [ -z "$(env_value AI_ENCRYPTION_KEY "$ENV_FILE")" ]; then
  # A chave nunca vai em argv (seria visível em ps/proc); é hex validada,
  # por isso a substituição linha a linha em shell é suficiente.
  : >"$ENV_FILE.tmp.key"
  while IFS= read -r line; do
    case "$line" in
      AI_ENCRYPTION_KEY=*) printf 'AI_ENCRYPTION_KEY=%s\n' "$PONTO_EXISTING_AI_ENCRYPTION_KEY" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done <"$ENV_FILE.tmp" >"$ENV_FILE.tmp.key"
  cat "$ENV_FILE.tmp.key" >"$ENV_FILE.tmp"
  rm -f "$ENV_FILE.tmp.key"
fi
# Credenciais rclone exportadas no operador entram no .env gerado; o
# db-backup só as usa quando BACKUP_REMOTE_ENABLED=true.
{ env | grep '^RCLONE_CONFIG_' || true; grep '^RCLONE_CONFIG_' "$ENV_FILE" 2>/dev/null || true; } | awk -F= '!seen[$1]++' >>"$ENV_FILE.tmp"
for key in BACKUP_AGE_PUBLIC_KEY BACKUP_ALERT_WEBHOOK_URL BACKUP_ALERT_LABEL BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_S3_REGION BACKUP_S3_PROVIDER BACKUP_S3_FORCE_PATH_STYLE; do
  copy_env_setting "$key" "$ENV_FILE"
done
BACKUP_REMOTE_ENABLED_VALUE="$(configured_value BACKUP_REMOTE_ENABLED "$ENV_FILE")"
BACKUP_REMOTE_ENABLED_VALUE="${BACKUP_REMOTE_ENABLED_VALUE:-true}"
BACKUP_RCLONE_REMOTE_VALUE="$(configured_value BACKUP_RCLONE_REMOTE "$ENV_FILE")"
BACKUP_S3_PREFIX_VALUE="$(configured_value BACKUP_S3_PREFIX "$ENV_FILE")"
BACKUP_S3_PREFIX_VALUE="${BACKUP_S3_PREFIX_VALUE:-clientes/${PONTO_CLIENT_SLUG}}"
cat >>"$ENV_FILE.tmp" <<EOF
COMPOSE_PROJECT_NAME=ponto-${PONTO_CLIENT_SLUG}
COMPOSE_PROFILES=wa-local
PONTO_IMAGE=${PONTO_IMAGE}
PONTO_INTERNAL_ALIAS=app-${PONTO_CLIENT_SLUG}
PONTO_PROXY_NETWORK=${PONTO_NETWORK}
NODE_ENV=production
TZ=${PONTO_TZ}
APP_URL=https://${HOSTNAME_CLIENTE}
API_URL=https://${HOSTNAME_CLIENTE}
TRUST_PROXY=true
BACKUP_REMOTE_ENABLED=${BACKUP_REMOTE_ENABLED_VALUE}
BACKUP_RCLONE_REMOTE=${BACKUP_RCLONE_REMOTE_VALUE}
BACKUP_REQUIRE_ENCRYPTION=true
BACKUP_S3_PREFIX=${BACKUP_S3_PREFIX_VALUE}
EOF
cat "$ENV_FILE.tmp" >"$ENV_FILE"
rm -f "$ENV_FILE.tmp"
chmod 600 "$ENV_FILE"

for key in BACKUP_AGE_PUBLIC_KEY BACKUP_ALERT_WEBHOOK_URL BACKUP_ALERT_LABEL BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_PREFIX BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_S3_REGION BACKUP_S3_PROVIDER BACKUP_S3_FORCE_PATH_STYLE; do
  value="$(env_value "$key" "$ENV_FILE")"
  case "$value" in
    *$'\n'*|*$'\r'*) die "$key não pode ter quebras de linha" ;;
  esac
done
backup_s3_endpoint="$(env_value BACKUP_S3_ENDPOINT "$ENV_FILE")"
if [ -n "$backup_s3_endpoint" ]; then
  case "$backup_s3_endpoint" in
    https://*|http://localhost*|http://127.0.0.1*) ;;
    *) die "BACKUP_S3_ENDPOINT tem de ser https (ou loopback em testes)" ;;
  esac
fi
backup_age_key="$(env_value BACKUP_AGE_PUBLIC_KEY "$ENV_FILE")"
if [ -z "$backup_age_key" ]; then
  die "BACKUP_AGE_PUBLIC_KEY é obrigatória; gera uma chave age na máquina de operador e exporta só a chave pública"
fi
case "$backup_age_key" in
  age1*) ;;
  *) die "BACKUP_AGE_PUBLIC_KEY tem de começar por age1" ;;
esac
case "$backup_age_key" in
  *$'\n'*|*$'\r'*) die "BACKUP_AGE_PUBLIC_KEY não pode ter quebras de linha" ;;
esac
if [ "$(env_value BACKUP_REMOTE_ENABLED "$ENV_FILE")" != "true" ]; then
  die "o ponto alojado exige BACKUP_REMOTE_ENABLED=true para enviar o backup cifrado para fora do servidor"
fi
if [ -z "$(env_value BACKUP_RCLONE_REMOTE "$ENV_FILE")" ]; then
  for key in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
    if [ -z "$(env_value "$key" "$ENV_FILE")" ]; then
      die "variável obrigatória de backup remoto em falta: $key"
    fi
  done
fi

cat >"$CLIENT_DIR/docker-compose.yml" <<'EOF'
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: reparilo
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: reparilo
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U reparilo -d reparilo"]
      interval: 5s
      timeout: 5s
      retries: 10

  app:
    image: ${PONTO_IMAGE}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://reparilo:${POSTGRES_PASSWORD}@db:5432/reparilo
      BACKUP_DIR: /app/backups
      BACKUP_HEARTBEAT_DIR: /app/backups-status
      NODE_ENV: production
      TZ: ${TZ}
      APP_URL: ${APP_URL}
      API_URL: ${API_URL}
      TRUST_PROXY: ${TRUST_PROXY}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      COOKIE_SECRET: ${COOKIE_SECRET}
      AI_ENCRYPTION_KEY: ${AI_ENCRYPTION_KEY}
      SETUP_TOKEN: ${SETUP_TOKEN}
    volumes:
      - uploads:/app/uploads
      - backups-heartbeat:/app/backups-status:ro
      - backups:/app/backups:ro
    networks:
      default:
      proxy:
        aliases:
          - ${PONTO_INTERNAL_ALIAS}
    healthcheck:
      test: ["CMD-SHELL", "bun -e \"fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  db-backup:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGHOST: db
      PGPORT: "5432"
      PGUSER: reparilo
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: reparilo
      BACKUP_DIR: /backups
      RETENTION_DAYS: "30"
      BACKUP_ONCE_PER_DAY: "true"
      HEARTBEAT_DIR: /backups-status
      BACKUP_REMOTE_ENABLED: ${BACKUP_REMOTE_ENABLED:-false}
      BACKUP_RCLONE_REMOTE: ${BACKUP_RCLONE_REMOTE:-}
    volumes:
      - backups:/backups
      - backups-heartbeat:/backups-status
      - ./scripts/db-backup.sh:/scripts/run-backup.sh:ro
      - ./scripts/db-backup-remote.sh:/scripts/db-backup-remote.sh:ro
      - ./scripts/db-restore.sh:/scripts/run-restore.sh:ro
      - ./scripts/db-restore-check.sh:/scripts/run-restore-check.sh:ro
    entrypoint:
      - sh
      - -c
      - |
        for i in 1 2 3 4 5; do apk add --no-cache bash age curl >/dev/null 2>&1 && break; sleep 5; done
        if [ "${BACKUP_REMOTE_ENABLED:-false}" = "true" ]; then
          apk add --no-cache rclone >/dev/null 2>&1 || echo '[db-backup] WARN: rclone install failed'
        fi
        # O agendamento fica no systemd/cron do anfitrião: assim o código de
        # saída, o estado e os logs do backup não dependem deste contentor
        # estar continuamente acordado. Ele fica como caixa de ferramentas
        # para execuções manuais e para o timer.
        while true; do sleep 86400; done

  evolution:
    image: evoapicloud/evolution-api:v2.3.6
    restart: unless-stopped
    profiles: ["wa-local"]
    depends_on:
      evolution-db:
        condition: service_healthy
    environment:
      SERVER_PORT: "8080"
      AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY}
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "false"
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:${EVOLUTION_DB_PASSWORD}@evolution-db:5432/evolution
      DATABASE_CONNECTION_CLIENT_NAME: evolution
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "false"
      DATABASE_SAVE_MESSAGE_UPDATE: "false"
      DATABASE_SAVE_DATA_CONTACTS: "false"
      DATABASE_SAVE_DATA_CHATS: "false"
      DATABASE_SAVE_DATA_LABELS: "false"
      DATABASE_SAVE_DATA_HISTORIC: "false"
      STORE_MESSAGES: "false"
      STORE_CONTACTS: "false"
      STORE_CHATS: "false"
      QRCODE_LIMIT: "30"
      SYNC_FULL_HISTORY: "false"
      LOG_LEVEL: "ERROR"
    expose:
      - "8080"

  evolution-db:
    image: postgres:16-alpine
    restart: unless-stopped
    profiles: ["wa-local"]
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${EVOLUTION_DB_PASSWORD}
      POSTGRES_DB: evolution
    volumes:
      - evolution-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution -d evolution"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
  uploads:
  backups:
  backups-heartbeat:
  evolution-data:

networks:
  proxy:
    external: true
    name: ${PONTO_PROXY_NETWORK}
EOF

if [ "$PONTO_ENABLE_EVOLUTION" != "true" ]; then
  sed -i 's/^COMPOSE_PROFILES=wa-local$/COMPOSE_PROFILES=/' "$ENV_FILE"
  (
    cd "$CLIENT_DIR"
    docker compose --profile wa-local stop evolution evolution-db >/dev/null 2>&1 || true
  )
fi

cat >"$PROXY_DIR/docker-compose.yml" <<'EOF'
services:
  caddy:
    image: caddy:2.9-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - proxy

volumes:
  caddy-data:
  caddy-config:

networks:
  proxy:
    external: true
    name: ${PONTO_PROXY_NETWORK}
EOF

printf 'PONTO_PROXY_NETWORK=%s\n' "$PONTO_NETWORK" >"$PROXY_DIR/.env"
chmod 600 "$PROXY_DIR/.env"

if [ ! -f "$PROXY_DIR/Caddyfile" ]; then
  cat >"$PROXY_DIR/Caddyfile" <<EOF
{
	email ${PONTO_ACME_EMAIL}
}
EOF
fi

if ! docker network inspect "$PONTO_NETWORK" >/dev/null 2>&1; then
  docker network create "$PONTO_NETWORK" >/dev/null
fi

if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_ZONE_ID:-}" ]; then
  need_cmd python3
  PONTO_HOSTNAME="$HOSTNAME_CLIENTE" python3 - <<'PY'
import json
import os
import urllib.error
import urllib.parse
import urllib.request

zone = os.environ["CF_ZONE_ID"]
name = os.environ["PONTO_HOSTNAME"]
token = os.environ["CF_API_TOKEN"]
content = os.environ.get("PONTO_PUBLIC_IP")
if not content:
    with urllib.request.urlopen("https://api.ipify.org", timeout=10) as res:
        content = res.read().decode().strip()
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
}
base = f"https://api.cloudflare.com/client/v4/zones/{zone}/dns_records"

def call(method, url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode())

query = f"{base}?type=A&name={urllib.parse.quote(name)}"
try:
    existing = call("GET", query).get("result") or []
    payload = {
        "type": "A",
        "name": name,
        "content": content,
        "ttl": 1,
        "proxied": False,
    }
    if existing:
        call("PUT", f"{base}/{existing[0]['id']}", payload)
    else:
        call("POST", base, payload)
except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as exc:
    raise SystemExit(f"ERRO: não foi possível garantir o DNS {name}: {exc}")
PY
fi

python_marker_start="# BEGIN ${PONTO_CLIENT_SLUG}"
python_marker_end="# END ${PONTO_CLIENT_SLUG}"
block="${python_marker_start}
${HOSTNAME_CLIENTE} {
	reverse_proxy app-${PONTO_CLIENT_SLUG}:4000
}
${python_marker_end}"

CADDY_TMP="$(mktemp "$PROXY_DIR/.Caddyfile.XXXXXX")"
exec 8>"$PROXY_DIR/Caddyfile.lock"
flock 8
if grep -qFx "$python_marker_start" "$PROXY_DIR/Caddyfile"; then
  awk -v start="$python_marker_start" -v end="$python_marker_end" -v block="$block" '
    $0 == start { print block; skip=1; next }
    $0 == end { skip=0; next }
    skip != 1 { print }
  ' "$PROXY_DIR/Caddyfile" >"$CADDY_TMP"
else
  cp "$PROXY_DIR/Caddyfile" "$CADDY_TMP"
  printf '\n%s\n' "$block" >>"$CADDY_TMP"
fi
mv "$CADDY_TMP" "$PROXY_DIR/Caddyfile"
flock -u 8
exec 8>&-

# Sobe primeiro o proxy e depois a empresa. Se já existirem, `up -d` é
# idempotente e só recria contentores cuja configuração mudou.
docker compose -p oficinaos-ponto-proxy -f "$PROXY_DIR/docker-compose.yml" up -d >/dev/null
(
  cd "$CLIENT_DIR"
  docker compose up -d >/dev/null
)

caddy_container="$(docker compose -p oficinaos-ponto-proxy -f "$PROXY_DIR/docker-compose.yml" ps -q caddy)"
if [ -n "$caddy_container" ]; then
  docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 ||
    docker compose -p oficinaos-ponto-proxy -f "$PROXY_DIR/docker-compose.yml" restart caddy >/dev/null
fi

app_container="$(cd "$CLIENT_DIR" && docker compose ps -q app)"
[ -n "$app_container" ] || die "contentor app não arrancou"

for attempt in $(seq 1 45); do
  if docker exec "$app_container" bun -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 45 ]; then
    die "a app não respondeu em /health dentro do tempo esperado"
  fi
  sleep 2
done

docker cp "$CLIENT_DIR/bootstrap-ponto-hosted.ts" "$app_container:/tmp/ponto-bootstrap.ts" >/dev/null
BOOTSTRAP_ENV="$(mktemp)"
chmod 600 "$BOOTSTRAP_ENV"
{
  printf 'PONTO_CLIENT_NAME_B64=%s\n' "$(b64 "$PONTO_CLIENT_NAME")"
  printf 'PONTO_OWNER_NAME_B64=%s\n' "$(b64 "$PONTO_OWNER_NAME")"
  printf 'PONTO_OWNER_LOGIN_B64=%s\n' "$(b64 "$PONTO_OWNER_LOGIN")"
  printf 'PONTO_OWNER_PASSWORD_B64=%s\n' "$(b64 "$PONTO_OWNER_PASSWORD")"
  printf 'PONTO_PAIRING_CODE_B64=%s\n' "$(b64 "$CLOUD_PAIRING_CODE")"
  printf 'PONTO_SETUP_TOKEN_B64=%s\n' "$(b64 "$(env_value SETUP_TOKEN "$ENV_FILE")")"
  printf 'PONTO_CLOUD_API_URL_B64=%s\n' "$(b64 "$PONTO_CLOUD_API_URL")"
} >"$BOOTSTRAP_ENV"
if ! docker exec --env-file "$BOOTSTRAP_ENV" "$app_container" bun /tmp/ponto-bootstrap.ts; then
  die "bootstrap da instância falhou"
fi
rm -f "$BOOTSTRAP_ENV"
BOOTSTRAP_ENV=""

backup_container="$(cd "$CLIENT_DIR" && docker compose ps -q db-backup 2>/dev/null || true)"
# Não criar um dump extra quando já há um backup nas últimas 24h: reexecuções
# idempotentes não mudaram dados e dumps extra competiam com a retenção diária.
latest_backup=""
if [ -n "$backup_container" ]; then
  latest_backup="$(docker exec "$backup_container" sh -c "find /backups -maxdepth 1 -type f \( -name 'oficinaos-*.dump.age' -o -name 'oficinaos-*.sql.gz' \) -mtime -1 -print -quit" 2>/dev/null || true)"
fi
# Na primeira instalação forçar um dump depois do bootstrap: o dump de arranque
# do contentor ainda não tem proprietário nem emparelhamento. Em reexecuções,
# um backup nas últimas 24h chega.
if [ -n "$backup_container" ] && { [ ! -f "$CLIENT_DIR/.bootstrap-backup-done" ] || [ -z "$latest_backup" ]; }; then
  # O contentor instala age/rclone no arranque. Esperar um curto período para
  # o primeiro backup pós-bootstrap não falhar só por essa corrida.
  for attempt in $(seq 1 30); do
    if docker exec "$backup_container" sh -c 'command -v age >/dev/null 2>&1 && command -v rclone >/dev/null 2>&1' >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if docker exec -e BACKUP_FORCE=true "$backup_container" bash /scripts/run-backup.sh >/dev/null 2>&1; then
    touch "$CLIENT_DIR/.bootstrap-backup-done"
    chmod 600 "$CLIENT_DIR/.bootstrap-backup-done"
  else
    echo "AVISO: o backup pós-bootstrap falhou; verificar db-backup." >&2
  fi
fi

# Agendamento diário no anfitrião. systemd é preferido; cron é a alternativa
# em VPS sem systemd. Em ambos os casos a execução entra pelo contentor
# db-backup e o código de saída real do script é preservado.
install_backup_scheduler() {
  local docker_bin scheduler systemd_dir cron_dir service timer cronfile wrapper
  docker_bin="$(command -v docker)"
  scheduler="$PONTO_SCHEDULER"
  service="oficinaos-ponto-backup-${PONTO_CLIENT_SLUG}.service"
  timer="oficinaos-ponto-backup-${PONTO_CLIENT_SLUG}.timer"
  wrapper="$CLIENT_DIR/scripts/run-scheduled-backup.sh"

  cat >"$wrapper" <<EOF
#!/bin/sh
# Gerado pelo instalador: preserva o código de saída e regista um alerta
# no anfitrião mesmo quando o contentor db-backup não pode ser executado.
if (cd "${CLIENT_DIR}" && "${docker_bin}" compose --env-file .env exec -T db-backup bash /scripts/run-backup.sh); then
  rm -f "${CLIENT_DIR}/backup-scheduler-alert.txt"
  exit 0
else
  rc=\$?
  printf '%s exit_code=%s\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" "\$rc" >"${CLIENT_DIR}/backup-scheduler-alert.txt"
  exit "\$rc"
fi
EOF
  chmod 0700 "$wrapper"

  if [ "$scheduler" = "none" ]; then
    echo "AVISO: agendamento de backup desligado explicitamente (PONTO_SCHEDULER=none)." >&2
    return 0
  fi
  if [ "$scheduler" = "auto" ]; then
    if [ -n "$PONTO_SYSTEMD_DIR" ] || [ -d /run/systemd/system ]; then
      scheduler="systemd"
    else
      scheduler="cron"
    fi
  fi

  if [ "$scheduler" = "systemd" ]; then
    systemd_dir="${PONTO_SYSTEMD_DIR:-/etc/systemd/system}"
    mkdir -p "$systemd_dir"
    cat >"$systemd_dir/$service" <<EOF
[Unit]
Description=Backup diário cifrado do ponto ${PONTO_CLIENT_SLUG}
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=${CLIENT_DIR}
ExecStart=${wrapper}
EOF
    cat >"$systemd_dir/$timer" <<EOF
[Unit]
Description=Agendamento do backup diário do ponto ${PONTO_CLIENT_SLUG}

[Timer]
OnCalendar=${PONTO_BACKUP_ONCALENDAR}
Persistent=true

[Install]
WantedBy=timers.target
EOF
    chmod 0644 "$systemd_dir/$service" "$systemd_dir/$timer"
    if command -v systemctl >/dev/null 2>&1; then
      systemctl daemon-reload >/dev/null 2>&1 || true
      systemctl enable --now "$timer" >/dev/null
    fi
    return 0
  fi

  cron_dir="${PONTO_CRON_DIR:-/etc/cron.d}"
  if [ ! -d "$cron_dir" ] && ! mkdir -p "$cron_dir" 2>/dev/null; then
    die "não foi possível instalar timer systemd nem cron para o backup diário"
  fi
  mkdir -p "$CLIENT_DIR/logs"
  chmod 700 "$CLIENT_DIR/logs"
  cronfile="$cron_dir/oficinaos-ponto-backup-${PONTO_CLIENT_SLUG}"
  cat >"$cronfile" <<EOF
SHELL=/bin/sh
17 3 * * * root ${wrapper} >> ${CLIENT_DIR}/logs/backup.log 2>&1
EOF
  chmod 0644 "$cronfile"
}

install_backup_scheduler

printf '\nInstância pronta: https://%s\n' "$HOSTNAME_CLIENTE"
printf 'Diretório: %s\n' "$CLIENT_DIR"
printf 'Nota: o DNS/TLS pode demorar alguns minutos na primeira emissão do certificado.\n'
