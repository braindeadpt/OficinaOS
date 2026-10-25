<p align="center">
  <img src="public/logo.svg" alt="OficinaOS" width="280" />
</p>

# OficinaOS

Sistema de gestão para oficinas de reparação de telemóveis — loja única, self-hosted. Regista a receção do equipamento, acompanha a reparação e entrega ao cliente, tudo numa única app acessível pelo browser. Faturação certificada opcional via InvoiceXpress (módulo Pro).

**Quatro idiomas incluídos: Português (PT-PT), English, Français, Español.**

> **Fork de [Reparilo](https://github.com/cranknet/reparilo)** por Bechar Gherbi — adaptado para o público português, com português europeu completo e deployment Docker pronto para rede local. O nome foi alterado conforme exigido pela licença do projeto original.

> **Estado:** projeto jovem, mantido por um único autor upstream. API e esquema de base de dados podem mudar. Issues e PRs bem-vindos.

## Funcionalidades

- **Fluxo completo de reparação** — receção → diagnóstico → reparação → entrega, com fotos, linha temporal de estados e notificações ao cliente
- **Receção completa** — checklist funcional, código/padrão de desbloqueio e assinatura digital do cliente no talão
- **Talões e tracking por QR** — o cliente lê um QR code e vê o estado da reparação no telemóvel, sem instalar nada
- **Pré-check público** — formulário para o cliente pedir orçamento/diagnóstico online; os pedidos entram na fila da app
- **Orçamentos** — versões com resposta aceite/recusada registada
- **POS de balcão** — venda de peças e acessórios, sessões de caixa e pagamentos
- **Devoluções e garantias** — fluxo separado para retrabalho e reclamações de garantia
- **Compra de usados (trade-in)** — registo com dados legais do vendedor e grading do equipamento
- **Gestão de peças e stock** — inventário com alertas de stock baixo e sugestões de reposição
- **Impressão** — talões e etiquetas em térmicas ESC/POS de rede (58/80 mm) ou A4
- **Relatórios e exportações** — vendas, reparações e margens por período; exportação CSV; objetivo mensal de faturação
- **OficinaDiag** — app Windows grátis que lê o telemóvel por USB (bateria, ecrã, sensores) e envia o diagnóstico para a loja
- **Assistente IA** (opcional) — traz a tua chave OpenAI; encriptada em AES-256 em repouso
- **Notificações WhatsApp/email** (opcional) — templates editáveis nas definições
- **Módulos Pro** (opcionais, via OficinaOS Cloud) — portal do cliente público, bot de WhatsApp, canal SMS, relatórios IA e faturação InvoiceXpress
- **PWA + Android (Capacitor)** — instalável no ecrã principal em iOS/Android ou APK nativo para tablets da loja
- **Single-tenant por design** — feito para uma loja, não é SaaS

## Como funciona

```
Browser (PC, tablet, telemóvel na rede da loja)
        ↓
   OficinaOS (Fastify + React)
        ↓
   PostgreSQL
```

Uma máquina corre o servidor e a base de dados; todos os outros dispositivos acedem pelo browser. Funciona sem internet para o uso principal — AI e WhatsApp são opcionais.

## Instalação

### Instalação fácil (Windows) ⭐

Descarrega o **[OficinaOS-Setup.exe](https://github.com/braindeadpt/OficinaOS/releases/latest)** — um instalador Windows normal: fica como serviço, arranca com o PC, ícone na bandeja, sem Docker nem janelas de consola. Pede administrador só na instalação.

Alternativas: **[oficinaos-portable.zip](https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-portable.zip)** (~470 MB, Bun + PostgreSQL embutidos — sem admin, sem instalar nada) ou o **[instalador ZIP Docker](https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-install.zip)** (`INSTALAR.bat` — para NAS/Linux e quem já usa Docker). Diferenças, backups e restauro: **[INSTALL.md → Instalação portátil](./INSTALL.md#instalação-portátil-sem-docker)**.

> O ZIP da release contém só os ficheiros de instalação. Para o código completo: **Code → Download ZIP** (sempre a versão mais recente de `main`).

Guia passo a passo completo: **[INSTALL.md](./INSTALL.md)**

### Docker manual (recomendado para Linux/Mac)

Requisitos: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) ou Docker Engine (Linux). Nada mais precisa de ser instalado na máquina.

```bash
git clone https://github.com/braindeadpt/OficinaOS.git
cd OficinaOS

cp .env.example .env
# Edita o .env — preenche BETTER_AUTH_SECRET, AI_ENCRYPTION_KEY,
# COOKIE_SECRET, SETUP_TOKEN e APP_URL (o IP da máquina na rede local).
# Gera segredos com:
#   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

docker compose up -d --build
docker compose exec app bun run db:seed   # só na 1ª vez (dados iniciais)
```

Depois abre `http://<IP-da-máquina>:4000/setup?token=<SETUP_TOKEN>` (o valor que puseste no `.env`) e cria a oficina no ecrã **«Criar a sua oficina»**: nome da loja, o teu nome, utilizador/email e palavra-passe. Não há credenciais pré-definidas. Em Docker o token é sempre preciso (o browser chega ao contentor pela rede do Docker, não como `127.0.0.1`); depois de criado o primeiro utilizador o ecrã deixa de existir.

### Comandos Docker

```bash
docker compose up -d        # ligar
docker compose down         # desligar (os dados ficam nos volumes)
docker compose logs -f app  # ver logs da app
docker compose restart app  # reiniciar após mudanças de build
```

### Notas de deployment em rede local (HTTP)

Este fork inclui patches para funcionar em HTTP simples dentro de uma rede local de confiança (sem TLS): cookies de sessão sem `Secure`, CSP sem `upgrade-insecure-requests`, HSTS desativado.

- Acede sempre pelo **mesmo URL configurado em `APP_URL`** — misturar `localhost` e IP provoca erros de origem inválida
- Se expuseres a app fora da rede da loja, **usa HTTPS** — a configuração HTTP é só para LAN privada. A forma mais simples: **[acesso remoto via Cloudflare Tunnel](docs/remote-access.md)**, sem abrir portas e sem IP público
- Se o IP da máquina mudar, atualiza `APP_URL` no `.env` e corre `docker compose up -d`

## Telemóveis e tablets

A app é responsiva e instalável como **PWA** (ícone no ecrã principal, ecrã cheio) — iPhone, iPad e Android, na rede da loja ou remotamente. Também há configuração **Capacitor** pronta para gerar um APK Android nativo sem Play Store.

Guia completo: **[docs/mobile-access.md](docs/mobile-access.md)**

## Acesso remoto (opcional)

Com o PC da loja ligado, um **Cloudflare Tunnel** gratuito expõe a app em HTTPS — para staff fora da loja e para os links de cliente (tracking, orçamentos, pré-check, recibo/QR de garantia). Sem port-forward, sem IP público, funciona com CGNAT.

```bash
# .env
TUNNEL_TOKEN=eyJh…        # token do túnel (Cloudflare Zero Trust)
EXTRA_TRUSTED_ORIGINS=https://oficina.oteudominio.pt
```

```bash
docker compose --profile tunnel up -d
```

Guia passo a passo: **[docs/remote-access.md](docs/remote-access.md)**

## Backups e teste de restore (sidecar db-backup)

O compose traz um sidecar `db-backup` que faz dump diário do PostgreSQL (retenção de 14 dias, configurável com `RETENTION_DAYS`) e, com o destino remoto activo, copia cada dump para object storage e verifica o restore semanalmente. Estado visível em **Definições → Loja → Backups**.

### Teste de restore numa base de dados real (procedimento local)

O ciclo completo — dump → wipe → restore → dados intactos — pode ser reproduzido na tua máquina com Docker em ~5 minutos:

```bash
git clone https://github.com/braindeadpt/OficinaOS.git
cd OficinaOS
cp .env.example .env    # segredos não são necessários para este teste

# Sobe a base de dados e o sidecar de backups
# (o sidecar faz um dump no arranque e depois a cada 24h)
docker compose up -d db db-backup

# Tabela de prova com dados conhecidos
docker compose exec db psql -U reparilo -d reparilo \
  -c "CREATE TABLE restore_probe (id serial primary key, marker text);" \
  -c "INSERT INTO restore_probe (marker) VALUES ('marcador-pre-backup');"

# Backup que já inclui a tabela de prova
docker compose exec db-backup /scripts/run-backup.sh

# Destrói os dados (DROP SCHEMA) e restaura o dump
docker compose exec db psql -U reparilo -d reparilo \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec db-backup /scripts/run-restore.sh \
  "$(docker compose exec -T db-backup sh -c 'ls -1t /backups/oficinaos-*.sql.gz | head -1')"

# Confirma que o marcador sobreviveu ao ciclo
docker compose exec db psql -U reparilo -d reparilo \
  -c "SELECT count(*) FROM restore_probe WHERE marker = 'marcador-pre-backup';"
# → deve devolver 1
```

> ⚠️ **Nunca apontes o restore para uma base de dados com dados reais** — `run-restore.sh` substitui tudo. O script pausa 10 s antes de destruir dados, a menos que `RESTORE_AUTO_CONFIRM=1` esteja definido (usado pela CI).

### Cópia off-site (object storage via rclone)

No `.env` da instalação, activa o segundo destino e configura o remote do rclone por env-vars (S3, B2, GCS, MinIO…):

```bash
BACKUP_REMOTE_ENABLED=true
BACKUP_RCLONE_REMOTE=s3:oficinaos-backups        # ou gcs:…, b2:…
RCLONE_CONFIG_S3_TYPE=s3
RCLONE_CONFIG_S3_ACCESS_KEY_ID=...
RCLONE_CONFIG_S3_SECRET_ACCESS_KEY=...
# RCLONE_CONFIG_S3_ENDPOINT=...                  # só para MinIO/R2
```

O que acontece no sidecar, por backup diário:

1. Dump local + retenção (como sempre);
2. `rclone copyto` do dump para o bucket + heartbeat `last-remote-copy.txt`;
3. Passa a retenção remota (`--min-age 14d`);
4. Uma vez por semana (`RESTORE_CHECK_INTERVAL_DAYS`, default 7): descarrega o dump mais recente do bucket e restaura-o na base de dados descartável `restore_check` — **a base de dados live nunca é tocada**. O resultado fica no heartbeat `last-restore-check.txt`.

Falha da cópia remota ou da verificação nunca invalida o dump local; os indicadores da UI (cópia remota / restore verificado) ficam "atrasados" a vermelho até a próxima execução bem-sucedida. O job **DB backup/restore round-trip** da CI exercita esta cadeia completa contra um endpoint S3 real em cada PR.

### Restore manual (desastre)

```bash
docker compose exec -T db-backup /scripts/run-restore.sh oficinaos-<stamp>.sql.gz
```

O script lista os ficheiros disponíveis com `docker compose exec db-backup ls -1t /backups`. Em produção, confirma sempre o nome do ficheiro antes do Enter — o restore substitui a base de dados inteira.

## Configuração

Todas as variáveis de ambiente estão documentadas no [`.env.example`](./.env.example). Em produção o servidor recusa arrancar se faltarem segredos obrigatórios.

| Variável | Descrição |
|---|---|
| `APP_URL` | URL público da app (ex.: `http://192.168.1.33:4000`) |
| `DATABASE_URL` | Ligação PostgreSQL (definida pelo compose) |
| `BETTER_AUTH_SECRET` | Segredo de sessões (gerar aleatório) |
| `SETUP_TOKEN` | Opcional — código de uso único para o ecrã «Criar a sua oficina» a partir de outro aparelho (Docker/servidor). Sem ele, só funciona em `localhost` |
| `SEED_ADMIN_PASSWORD` | Só dev/CI/E2E — se definido, o `db:seed` cria o utilizador `admin` (com troca obrigatória) quando a base de dados não tem utilizadores |
| `SEED_ADMIN_EMAIL` | Opcional, com o anterior — email do admin semeado (por omissão `admin@oficinaos.local`) |
| `AI_ENCRYPTION_KEY` | Chave AES-256 para guardar a OpenAI key |
| `OPENAI_API_KEY` | Opcional — assistente IA |
| `WHATSAPP_*`, `EMAIL_*` | Opcional — notificações ao cliente |
| `DEMO_MODE` | `true` ativa a demo pública (ver secção seguinte) — **nunca numa instalação real** |

## Demo pública (`demo.oficinaos.app`)

`DEMO_MODE=true` transforma a instalação numa demo pública: o visitante carrega em «Experimentar a demo», entra numa oficina fictícia já preenchida (clientes, reparações, stock, vendas — tudo inventado) e usa tudo sem instalar nada.

**O que muda com `DEMO_MODE=true`:**

- `POST /api/demo/login` cria uma sessão de dono de oficina sem password; `/setup` fica desativado e um banco vazio é semeado automaticamente no arranque
- O servidor **recusa arrancar** se algum segredo real estiver definido — por prefixo (`OPENAI_`, `EMAIL_`, `WHATSAPP_`, `SMTP_`, `META_`, `EVOLUTION_`, `OFICINAOS_CLOUD_`, `CLOUD_`, `GITHUB_`, `INVOICEXPRESS_`, `IX_`, `TRADE_`, `MARKET_`, `S3_`, `R2_`, `AWS_`, `BACKUP_`, `SEED_ADMIN_`, `SETUP_TOKEN`) **ou por sufixo** (`*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_PASS`, `*_KEY`, `*_API_KEY`, `*_APIKEY`, `*_CREDENTIALS`, `*_DSN`). Únicas exceções: `BETTER_AUTH_SECRET`, `COOKIE_SECRET` e `AI_ENCRYPTION_KEY`, que nunca saem do contentor
- Tudo o que sai para fora fica desligado **no servidor** (não só na UI): email, WhatsApp/SMS, webhooks, assistente IA, pairing/sync com Cloud e Trade, InvoiceXpress, feedback→GitHub, self-update, impressora ESC/POS, exports
- Bloqueados com 403: gestão de utilizadores/papéis, alteração de password/email, chaves e integrações, sign-in por credenciais (só `/api/demo/login` cria sessões — falhas nunca bloqueiam a conta demo), importações acima de 50 linhas
- O guard corre sobre o caminho **descodificado** (variantes URL-encoded como `/api/%75sers/...` são rejeitadas antes do router)
- Uploads: máximo 1 MB por ficheiro, só imagens (validação MIME + magic bytes), quota total de 200 MB
- Rate limits mais apertados (login demo 20/15min por IP; escritas ≤60/min) — atrás do cloudflared a chave é `CF-Connecting-IP`, para que todos os visitantes não partilhem o IP do túnel. O header só é honrado quando o peer é privado/edge (o conector cloudflared ou o proxy) ou com `DEMO_TRUST_CF_CONNECTING_IP=true` — **a origem tem de estar acessível apenas via cloudflared** (ou o proxy da edge tem de sobrepor/remover o header), senão quem chegar direto à origem forja o header e ganha orçamento ilimitado
- Os schedulers externos (Cloud poller, remarketing, outbox) nem arrancam
- Uma faixa fixa no topo avisa «Demo — os dados são fictícios e apagados de hora a hora» com o CTA «Instalar na minha oficina»

**Seed:** `bun run db:seed:demo` gera o dataset determinístico (PRNG com seed fixa — mesma forma em cada execução, datas relativas a "agora") e grava o snapshot em `demo-snapshot.json` (ou `DEMO_DUMP_PATH`). Como segunda guarda, `seedDemo`/`demo:reset` recusam correr sobre uma BD cujo nome não contenha `demo`.

**Reset horário:** o timer da infra corre `docker exec demo-web bun run demo:reset` — regenera o dump (datas sempre frescas), faz TRUNCATE+replay **numa única transação** (`lock_timeout=10s`, timeout 60s) e limpa o conteúdo dos uploads. A app continua a responder durante o reset — os leitores veem o estado antes ou depois, nunca uma base a meio; o comando é idempotente e corre inteiramente dentro do contentor.

**Deploy de exemplo:** [`compose.demo.yaml`](./compose.demo.yaml) — app + Postgres com imagem de tag fixa, `read_only` + `tmpfs /tmp`, `cap_drop ALL`, `no-new-privileges`, limites de memória/CPU/PIDs, rede `internal` selada e **nenhuma porta publicada** (só a rede `edge`), com [`.env.demo.example`](./.env.demo.example). O reverse proxy na edge aponta `demo.oficinaos.app` para `demo-web:4000`.

## Desenvolvimento local (sem Docker)

Requisitos: [Bun](https://bun.sh) `1.3.13` e PostgreSQL.

```bash
bun install
cp .env.example .env          # preencher segredos
bun run db:migrate
bun run db:seed
bun run dev                   # http://localhost:5173
```

```bash
bun run test         # vitest
bun run check        # ultracite lint
bun run fix          # auto-fix lint
bun run db:studio    # Prisma Studio
```

## Traduções e i18n

Os locales ficam em `src/i18n/locales/` (`pt`, `en`, `fr`). Fluxo para strings novas:

1. Adiciona a key em `src/i18n/locales/en.json`
2. `bun run sync-locales` — sincroniza e auto-traduz os outros locales
3. `python scripts/fix-pt-pt.py` — normaliza o português gerado para PT-PT (o Google tende para pt-BR)

Strings hardcoded na UI são rejeitadas em review.

## Contribuir

Vê [CONTRIBUTING.md](./CONTRIBUTING.md). Resumindo: abre um issue antes de PRs grandes, corre `bun run check` e `bun run test`, e mantém cada PR focado numa só coisa.

## Segurança

Encontraste uma vulnerabilidade? Vê [SECURITY.md](./SECURITY.md) — **não** abras um issue público.

## Licença

[MIT](./LICENSE) © 2026 Bechar Gherbi (projeto original), alterações © braindeadpt. O nome "Reparilo" pertence ao autor original e não está licenciado — este fork usa o nome **OficinaOS**.

---

## English summary

**OficinaOS** is a Portuguese-focused fork of [Reparilo](https://github.com/cranknet/reparilo): single-location phone repair shop management (intake → repair → return), QR customer tracking, parts inventory, optional AI/WhatsApp — no invoicing. This fork adds a full **pt-PT locale** and a **Docker Compose deployment for LAN use over HTTP**. See the sections above for setup; all commands are the same. MIT licensed; renamed per the upstream license terms.
