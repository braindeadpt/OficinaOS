# Instalação portátil (sem Docker)

Bundle Windows autónomo para PCs onde o Docker Desktop não funciona —
virtualização desativada na BIOS, CPU sem VT-x/AMD-V, ou WSL2 impossível.
Estes ficheiros são copiados para a raiz do `oficinaos-portable.zip`
(gerado pelo job `portable` em `.github/workflows/release.yml`).

## O que o bundle contém

```
oficinaos-portable/
├── bun\bun.exe         runtime (bun-windows-x64, GitHub releases)
├── pgsql\              PostgreSQL 17 oficial (binários EDB zip)
├── app\                código da release + node_modules + dist + generated/
│   ├── .env            gerado na 1ª execução por gerar-env.ps1
│   └── .pgpass         password do Postgres (a mesma do DATABASE_URL)
├── data\               dados do Postgres (a base de dados — isto é o importante)
├── backups\ dentro de app\uploads\backups\   dumps diários .sql.gz
├── INICIAR.bat         arranca tudo
├── PARAR.bat           para tudo
├── ATUALIZAR.bat       atualiza preservando data\ e app\.env
├── BACKUP.bat          backup manual (corre sozinho a cada arranque)
├── RESTAURAR.bat       repõe a BD a partir de um backup (interativo)
├── run-app.bat         wrapper com respawn (usado pelo INICIAR)
├── BACKUP.ps1 / RESTORE.ps1 / gerar-env.ps1 / harden-pg.ps1   lógica real
└── STOP                flag criada pelo PARAR (impede respawn)
```

## Como funciona

**Arranque (`INICIAR.bat`)**
1. Se `:4000/health` responde → já está a correr, abre o browser e sai
2. Gera `app\.env` na primeira vez (segredos aleatórios + `DATABASE_URL` com
   password gerada) e `app\.pgpass` com a password do Postgres
3. `initdb` na primeira vez → `data\` com `listen_addresses=127.0.0.1`, porta
   5433, auth `scram-sha-256` → **só liga quem tem a password** (noutros
   processos deste PC incluídos); a app continua exposta à LAN em `:4000`
   → instalações anteriores com `trust` são migradas automaticamente pelo
   `harden-pg.ps1` no primeiro arranque (ALTER USER + rewrite do pg_hba)
4. `pg_ctl start`, `createdb oficinaos` se faltar
5. Backup diário (`BACKUP.ps1`) — equivalente ao sidecar `db-backup` do Docker
6. Na primeira vez pergunta se arranca com o Windows (Scheduled Task `ONLOGON`; a resposta fica em `data\autostart.flag` e nunca mais pergunta)
7. Lança `run-app.bat` minimizado → `bun run start:prod` = `prisma migrate deploy` + serve

**Respawn (`run-app.bat`)** — loop infinito: se `bun` sair com erro, espera 5s e
reinicia. Só pára quando existe o ficheiro `STOP` (criado pelo `PARAR.bat`).

**Backup (`BACKUP.ps1`)** — `pg_dump` plain → gzip → `app\uploads\backups\oficinaos-<UTC>.sql.gz`,
heartbeat ISO em `app\uploads\backups-status\last-backup.txt`, retenção 14 dias.
Os nomes e o heartbeat seguem exatamente a convenção do `scripts/db-backup.sh`,
por isso o indicador de backups na app funciona igual nos dois modos.

**Restaurar (`RESTORE.ps1` via `RESTAURAR.bat`)** — lista os dumps disponíveis,
pede confirmação (⚠️ substitui todos os dados), para a app (mantém o Postgres),
recria a base de dados `oficinaos` e aplica o dump com `psql -f`. No fim diz
para correr `INICIAR.bat`. Equivalente ao `run-restore.sh` do stack Docker.

**Parar (`PARAR.bat`)** — cria `STOP`, mata os `bun.exe` debaixo da pasta do
bundle, `pg_ctl stop -m fast`.

**Atualizar (`ATUALIZAR.bat`)** — descarrega o `oficinaos-portable.zip` mais
recente → `PARAR` → faz backup de `app\.env` → extrai por cima excluindo `data\`,
`.env` e `PRIMEIRO-LOGIN.txt` → repõe o `.env` → `INICIAR` (migrações correm
sozinhas no arranque). Cada update descarrega o zip inteiro (~540 MB) —
no Docker só se descarregam as layers mudadas.

## Diferenças vs instalação Docker

| | Docker (`INSTALAR.bat`) | Portátil |
|---|---|---|
| Requisitos | Docker Desktop + WSL2 + VT-x na BIOS | nenhum — qualquer Win10/11 64-bit |
| Arranque com o PC | automático (Docker Desktop + restart policy) | Scheduled Task opcional (perguntado na 1ª execução) |
| Crash da app | Docker reinicia | `run-app.bat` reinicia em 5s |
| Backups diários | sidecar `db-backup` (24h) | `BACKUP.ps1` a cada arranque |
| Off-site backup | rclone opcional (`BACKUP_REMOTE_ENABLED`) | não incluído — copiar `app\uploads\backups\` manualmente |
| Updates | `ATUALIZAR.bat` (pull de layers) ou Watchtower automático | `ATUALIZAR.bat` (download do zip completo) |
| Remote access (HTTPS público) | perfil `cloudflared` no compose | instalar cloudflared em separado |
| Postgres | 16-alpine em contentor | 17 oficial como processo local |

## Resolução de problemas

- **A app não responde**: vê `data\postgres.log` e a janela minimizada do `run-app.bat`
- **Porta 5433 ocupada**: muda `port` em `data\postgresql.conf` **e** o `DATABASE_URL` em `app\.env`
- **Porta 4000 ocupada**: muda `PORT` em `app\.env`
- **Apagar tudo**: corre `PARAR.bat`, apaga a pasta `oficinaos-portable` (⚠️ `data\` é a base de dados inteira)
- **Desativar arranque automático**: `schtasks /delete /tn "OficinaOS" /f`
