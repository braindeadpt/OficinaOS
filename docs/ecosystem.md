# Ecossistema OficinaOS — mapa dos repositórios

> **Lê este ficheiro primeiro.** O OficinaOS não é um repo — são 4 repositórios
> interligados. Este documento é o mapa canónico de como tudo se liga; os READMEs
> de cada repo apontam para aqui.

## Os 4 repositórios

| Repo | Pasta local | GitHub | O que é | Stack |
|---|---|---|---|---|
| `reparilo` | `~/Documents/reparilo` | [braindeadpt/OficinaOS](https://github.com/braindeadpt/OficinaOS) | **A app da loja** — gestão de reparações, corre no PC da loja em LAN | Bun, Fastify, React+Vite, Prisma 7, PostgreSQL, Docker |
| `oficinaos-cloud` | `~/Documents/oficinaos-cloud` | [braindeadpt/oficinaos-cloud](https://github.com/braindeadpt/oficinaos-cloud) | **O servidor ponte** — contas, emparelhamento, entitlements Pro, filas e webhooks | Bun, Fastify, Prisma, PostgreSQL |
| `oficinaos-website` | `~/Documents/oficinaos-website` | [braindeadpt/oficinaos-website](https://github.com/braindeadpt/oficinaos-website) | **Site público** — marketing + toda a documentação ao utilizador (PT/EN/ES) | Astro + Tailwind, estático, GitHub Pages |
| `oficinaos-diag` | `~/Documents/oficinaos-diag` | [braindeadpt/oficinaos-diag](https://github.com/braindeadpt/oficinaos-diag) | **Ferramenta de diagnóstico** — app Windows que lê Android/iPhone por USB | C# / .NET 8 WPF |

## A arquitetura num parágrafo

A **app da loja é o centro**. Corre num PC dentro da loja, guarda tudo localmente
(Postgres), funciona offline em LAN — é grátis e MIT. A **Cloud** não guarda os
dados da loja: é uma ponte que sabe (a) que lojas existem, (b) que módulos Pro
cada uma pagou, e (c) filas temporárias de mensagens que atravessam a fronteira
LAN→internet. O modelo comercial é: core local grátis; funcionalidades que
precisam de «chegar à internet» são módulos Pro ativados **do lado do servidor**
(sem ficheiros de licença na loja). O website é estático e não tem ligação em
runtime. O diag é standalone até o utilizador escolher «Enviar à loja».

## Como as peças se ligam

### Emparelhamento (uma vez por loja)

1. Dono cria conta em `cloud.oficinaos.app` → dashboard gera código de emparelhamento (15 min)
2. Na app: **Definições → separador Cloud** → colar código → `POST /pairing/redeem` → token permanente da loja
3. A partir daí a app faz sync a cada **~2 minutos** (`server/services/cloud.service.ts` → poller)

### O poller de 2 minutos (o coração da integração)

Em cada ciclo, `server/services/cloud.service.ts` faz:

- `POST /shops/sync` → empurra config da loja (ex.: `whatsappPhoneNumberId`), recebe **entitlements** (módulos ativos)
- `GET /portal/replies` + `POST /portal/replies/ack` → respostas de orçamento vindas do portal público
- `GET /whatsapp/inbound` + `POST /whatsapp/inbound/ack` → mensagens WhatsApp recebidas
- Push de snapshots de portal que mudaram desde o último sync

### Módulo `portal`

App publica snapshot **redigido** da ficha → `POST /portal/publish` → página
pública em `cloud.oficinaos.app/t/:token` (token = segredo de 16 chars).
Resposta aceitar/recusar → fila → poller → `respondToQuote` (o mesmo serviço do
balcão — mesmo audit trail).

**Agent-readable**: a página declara `rel="alternate"` para `GET /api/portal/:token`
(JSON limpo, noindex) e o site serve `/llms.txt` — LLMs/agentes conseguem ler o
estado da reparação a partir do link. MCP server é roadmap em `docs/pro-modules.md`.

### Módulo `whatsapp-bot`

```
Cliente → WhatsApp Meta → POST /webhooks/whatsapp (assinatura HMAC validada
com WA_APP_SECRET) → fila WhatsAppInbound (routing por phone_number_id,
dedupe por wamid) → poller da app → server/services/whatsapp-bot.service.ts
(match pelos últimos 9 dígitos do telefone → jobs ativos → resposta) →
envio DIRETO app → Graph API
```

**O token da Meta nunca sai da loja** — a Cloud só recebe inbound e enfileira;
a resposta sai da app com `shop_settings.whatsappApiTokenEncrypted`
(AES-256-GCM, chave em `AI_ENCRYPTION_KEY`, `server/lib/crypto.ts`).

### Módulos `diag-intake` + `ai-reports`

`oficinaos-diag` corre 100% local no PC do cliente. Se o utilizador meter o
código da loja → `POST` intake → Cloud → app recolhe como **Pedido**
(`server/services/intake-request.service.ts`) → conversível em reparação.
`ai-reports`: dados brutos do scan → `POST /reports/diagnostic` → relatório em
linguagem simples gerado na Cloud.

## Endpoints e ambientes

| O quê | Onde |
|---|---|
| App da loja | `http://localhost:4000` (Docker) — ou IP LAN |
| Cloud produção | `https://cloud.oficinaos.app` (Docker Compose) |
| Webhook WhatsApp | `https://cloud.oficinaos.app/webhooks/whatsapp` (verify token + HMAC `WA_APP_SECRET`) |
| Privacy policy (requisito Meta) | `https://cloud.oficinaos.app/privacy` |
| Site público | `https://oficinaos.app` (GitHub Pages — deploy automático em push para `main`) |
| Releases diag | `github.com/braindeadpt/oficinaos-diag/releases` |

## Módulos Pro — identificadores

| ID do módulo | Nome | Onde no código | Estado |
|---|---|---|---|
| `portal` | Portal do cliente | app: `server/services/portal.service.ts`; cloud: `src/routes/portal.ts`, `public/portal.html` | Live, E2E testado |
| `whatsapp-bot` | Bot de WhatsApp | app: `server/services/whatsapp-bot.service.ts`; cloud: webhook + `WhatsAppInbound` | Live, E2E provado (SIM → APPROVED real) |
| `diag-intake` | Receção de diagnósticos | app: `intake-request.service.ts` (fila em Pedidos); cloud: `src/routes/intake.ts` | Implementado |
| `ai-reports` | Relatórios IA | cloud: `src/routes/reports.ts`, `src/ai-report.ts` | Implementado |

Ativar/desativar: lado da Cloud (`scripts/grant.ts` / dashboard). A app esconde
a funcionalidade se o módulo não constar nos entitlements.

## Onde está cada coisa (para quem chega ao código)

- **Segurança da app**: `server/plugins/security.ts` (SSOT — relaxada para LAN HTTP de propósito, ver CLAUDE.md)
- **Token WhatsApp encriptado**: `server/lib/crypto.ts` (AES-256-GCM)
- **Entitlements + poller**: `server/services/cloud.service.ts`
- **Credenciais WhatsApp na UI**: menu **Notificações → Setup → WhatsApp** (`src/components/modules/notifications/channel-settings.tsx`), API `PUT /api/settings/whatsapp`
- **Emparelhamento na UI**: **Definições → separador Cloud** (`src/components/modules/settings/settings-cloud-tab.tsx`)
- **Webhook Meta**: `oficinaos-cloud/src/index.ts` + rota WhatsApp
- **Copy do site** (todo o texto público): `oficinaos-website/src/i18n/{pt,en,es}.ts` — data-driven, `Copy` deriva de `pt.ts`
- **Docs ao utilizador**: `oficinaos-website` `/docs` + `/docs/{portal,whatsapp,diag}` — o site, não os `.md`, é a fonte para clientes
- **Docs técnicas**: `reparilo/docs/` (pro-modules.md, remote-access.md, mobile-access.md, privacy-and-data.md, este mapa)
- **Roadmap aprovado (não implementado)**: `docs/marketplace.md` — classificados B2B entre lojas, pós-beta; `oficinaos-diag/docs/roadmap.md` — licença scrcpy (Apache-2.0, OK comercial) + plano do auto-orçamento determinístico

## Regras transversais (aplicam-se a todos os repos)

- **Bun only** nos projetos JS — nunca npm/pnpm/npx
- **Sem ficheiros de licença locais** — Pro é sempre entitlement server-side
- **Privacy-first**: nada sai da loja por defeito; cada módulo documenta o que sai
- **Branding OficinaOS** — nunca reintroduzir "Reparilo" em strings visíveis
- **Sem segredos em código/docs** — tokens Meta, app secrets e afins vivem em `.env`/BD encriptada

## Estado atual (beta) e pendências conhecidas

- ✅ App + Cloud + site + webhook Meta: live e E2E provado (portal link, bot responde, SIM aprova orçamento real)
- ⏳ Meta Business Verification — necessária para números reais de lojas (coexistence) e embedded signup
- ⏳ Templates WhatsApp aprovados — necessários para notificações proativas fora da janela de 24h
- ⏳ Testes do diag com telefone real (Android e iPhone)
- ⏳ Onboarding da 1ª loja beta real + validação de preços
