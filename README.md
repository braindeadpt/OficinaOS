<p align="center">
  <img src="public/logo.svg" alt="OficinaOS" width="280" />
</p>

# OficinaOS

Sistema de gestão para oficinas de reparação de telemóveis — loja única, self-hosted, sem faturação. Regista a receção do equipamento, acompanha a reparação e entrega ao cliente, tudo numa única app acessível pelo browser.

**Quatro idiomas incluídos: Português (PT-PT), English, Français, العربية (RTL).**

> **Fork de [Reparilo](https://github.com/cranknet/reparilo)** por Bechar Gherbi — adaptado para o público português, com português europeu completo e deployment Docker pronto para rede local. O nome foi alterado conforme exigido pela licença do projeto original.

> **Estado:** projeto jovem, mantido por um único autor upstream. API e esquema de base de dados podem mudar. Issues e PRs bem-vindos.

## Funcionalidades

- **Fluxo completo de reparação** — receção → diagnóstico → reparação → entrega, com fotos, linha temporal de estados e notificações ao cliente
- **Talões e tracking por QR** — o cliente lê um QR code e vê o estado da reparação no telemóvel, sem instalar nada
- **Devoluções e garantias** — fluxo separado para retrabalho e reclamações de garantia
- **Gestão de peças e stock** — inventário com alertas de stock baixo
- **Assistente IA** (opcional) — traz a tua chave OpenAI; encriptada em AES-256 em repouso
- **Notificações WhatsApp/email** (opcional) — templates editáveis nas definições
- **Build Android via Capacitor** para tablets da loja
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

## Instalação com Docker (recomendado)

Requisitos: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) ou Docker Engine (Linux). Nada mais precisa de ser instalado na máquina.

```bash
git clone https://github.com/braindeadpt/OficinaOS.git
cd OficinaOS

cp .env.example .env
# Edita o .env — preenche BETTER_AUTH_SECRET, AI_ENCRYPTION_KEY,
# SEED_ADMIN_PASSWORD e APP_URL (o IP da máquina na rede local).
# Gera segredos com:
#   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

docker compose up -d --build
docker compose exec app bun run db:seed   # só na 1ª vez
```

Depois abre `http://<IP-da-máquina>:4000` (ex.: `http://192.168.1.33:4000`) e inicia sessão com **username `admin`** e a `SEED_ADMIN_PASSWORD` que definiste — a app obriga a trocar a palavra-passe no primeiro login.

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
- Se expuseres a app fora da rede da loja, **usa HTTPS** (reverse proxy com TLS) — a configuração HTTP é só para LAN privada
- Se o IP da máquina mudar, atualiza `APP_URL` no `.env` e corre `docker compose up -d`

## Configuração

Todas as variáveis de ambiente estão documentadas no [`.env.example`](./.env.example). Em produção o servidor recusa arrancar se faltarem segredos obrigatórios.

| Variável | Descrição |
|---|---|
| `APP_URL` | URL público da app (ex.: `http://192.168.1.33:4000`) |
| `DATABASE_URL` | Ligação PostgreSQL (definida pelo compose) |
| `BETTER_AUTH_SECRET` | Segredo de sessões (gerar aleatório) |
| `SEED_ADMIN_PASSWORD` | Palavra-passe inicial do admin — mudar no 1º login |
| `AI_ENCRYPTION_KEY` | Chave AES-256 para guardar a OpenAI key |
| `OPENAI_API_KEY` | Opcional — assistente IA |
| `WHATSAPP_*`, `EMAIL_*` | Opcional — notificações ao cliente |

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

Os locales ficam em `src/i18n/locales/` (`en`, `pt`, `fr`, `ar`). Fluxo para strings novas:

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
