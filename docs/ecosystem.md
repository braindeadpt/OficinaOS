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

1. Dono cria conta em `cloud.oficinaos.app` → dashboard gera código de emparelhamento (24 h)
2. Na app: **Definições → separador Cloud** → colar código → `POST /pairing/redeem` → token permanente da loja
3. A partir daí a app faz sync a cada **~2 minutos** (`server/services/cloud.service.ts` → poller)

### O poller de 2 minutos (o coração da integração)

Em cada ciclo, `server/services/cloud.service.ts` faz:

- `POST /shops/sync` → empurra config da loja (ex.: `whatsappPhoneNumberId`), recebe **entitlements** (módulos ativos)
- `GET /portal/replies` + `POST /portal/replies/ack` → respostas de orçamento vindas do portal público
- `GET /signature/replies` + `POST /signature/replies/ack` → assinaturas capturadas na página remota (o ack apaga o PNG na cloud)
- `GET /whatsapp/inbound` + `POST /whatsapp/inbound/ack` → mensagens WhatsApp recebidas
- Push de snapshots de portal que mudaram desde o último sync
- `POST /shops/metrics` → snapshot diário agregado (receita, reparações, vendas) se `multi-shop` ativo — só números, nunca dados de clientes

### Módulo `portal`

App publica snapshot **redigido** da ficha → `POST /portal/publish` → página
pública em `cloud.oficinaos.app/t/:token` (token = segredo de 16 chars).
Resposta aceitar/recusar → fila → poller → `respondToQuote` (o mesmo serviço do
balcão — mesmo audit trail).

**Agent-readable**: a página declara `rel="alternate"` para `GET /api/portal/:token`
(JSON limpo, noindex) e o site serve `/llms.txt` — LLMs/agentes conseguem ler o
estado da reparação a partir do link. MCP server é roadmap em `docs/pro-modules.md`.

### Módulo `signature-remote`

Assinatura remota da ficha de entrada — o cliente assina fora da LAN, sem tunnel.

```
App cria sessão local (mesmo token 64-hex — LAN 15min; relayed na cloud
alarga para 30min, link vivo só com o diálogo aberto) →
POST /signature/sessions publica o documento REDIGIDO
(publicDocumentView — sem códigos de desbloqueio) → página pública
cloud.oficinaos.app/sign/:token → cliente assina (PNG ≤500KB, submissão
atómica single-use, rate-limit por IP) → poller da app →
pullSignatureReplies → submitSignatureSession (o mesmo serviço do QR LAN —
mesma prova, hash e audit trail) → POST /signature/replies/ack apaga o PNG
na cloud.
```

A cloud é só transporte: guarda a assinatura até ao ack, nunca é a dona da
prova — essa fica na app local (`signatureDataUrl` + `documentHash`).
Invalidar a sessão local faz `DELETE /signature/sessions/:token`; o QR LAN
de 15 min continua a existir para quem não tem o módulo.

### Módulo `whatsapp-bot`

```
Inbound:  Cliente → WhatsApp Meta → POST /webhooks/whatsapp (assinatura HMAC
  validada com WA_APP_SECRET) → fila WhatsAppInbound (routing por
  phone_number_id, dedupe por wamid) → poller da app →
  server/services/whatsapp-bot.service.ts (match pelos últimos 9 dígitos
  do telefone → jobs ativos → resposta)
Outbound: app → POST /whatsapp/send (relay na Cloud, sem credenciais no
  pedido) → Cloud envia à Graph API com o token Meta da loja
```

**O token Meta vive na Cloud** (`shops.whatsappAccessToken`, AES-GCM com
`SECRETS_KEY`): a app faz upload uma vez via `POST /shops/whatsapp-credentials`
(no setup ou no primeiro ciclo do bot) e nunca o recebe de volta. O envio é
autorizado server-side por entitlement — a cache local de módulos é só um
hint de UI (expira 24h após o último sync). Instalações antigas continuam a
enviar com o token local (`whatsappApiTokenEncrypted`, AES-256-GCM em
`AI_ENCRYPTION_KEY`) até ao primeiro envio Cloud bem-sucedido — nessa altura
o token local é apagado. A Cloud não guarda nem regista corpos de mensagem;
os logs levam só id/estado/erro e telefone mascarado.

**Unpair**: a app chama `DELETE /shops/me` — a Cloud apaga a linha `Shop` e o
cascade (`onDelete: Cascade`) leva tudo o que é dela: tokens, entitlements,
relatórios intake, filas WhatsApp/SMS, respostas de portal, sessões de
assinatura, storefront, métricas e contribuições de preços. Tokens com scope
`diag` não conseguem chamar este endpoint (a bancada não desaparelha a loja).
Em Clouds antigas sem o endpoint a app cai para o cleanup parcial
(`DELETE /shops/whatsapp-credentials`).

#### Transporte alternativo: WhatsApp local (Evolution API)

`whatsappTransport` em ShopSettings: `"meta"` (default — fluxo acima) ou
`"evolution"` — Evolution API v2 (Baileys/WhatsApp Web, **não-oficial**)
a correr na LAN da loja (`docker compose --profile wa-local up -d`,
serviços `evolution` + `evolution-db` com Postgres próprio — nunca toca
na BD da app). O envio é `POST {evolutionUrl}/message/sendText/{instance}`
via `server/services/evolution.service.ts`; pairing por QR/pairingCode em
`POST /settings/whatsapp/evolution/pair`, health check em
`GET /settings/whatsapp/evolution/status` (open/connecting/close) e
`DELETE`-like logout em `/evolution/disconnect`.

Gates (app-side): `whatsappLocalDisclaimerAt` obrigatório no PUT das
settings e revalidado em `resolveWhatsAppChannel` antes de cada envio;
sem ele o canal resolve null e o outbox cancela. **É free** — não exige
nenhum entitlement (o `whatsapp-bot` gateia só as funções oficiais:
relay Meta na cloud + bot inbound). `syncFullHistory=false` — nada do
histórico do cliente é importado. Remarketing exige templates Meta →
recusado no modo local. A sessão/chaves nunca saem da loja (RGPD limpo);
risco de ban do número fica documentado no disclaimer do UI.

### Canal SMS (free — gateway Android local)

```
Outbound: evento → notification-dispatch → outbox →
  POST http://<telemovel>:8080/message (Basic auth, LAN — sms-gate.app)
Inbound:  cliente SMS → SMS Gateway for Android → webhook
  POST /api/public/sms/inbound/:token (route-security: CSRF off + rate limit)
  → handleInboundSms → mesmos intents do bot (bot-intents.ts partilhado
  com whatsapp-bot) → resposta automática por SMS
```

100% LAN: nada passa pela Cloud nem pela Meta — só sai o SMS pela rede móvel.
É o canal "de arranque" da loja que ainda não tem WhatsApp Business aprovado.
Sem template SMS dedicado, o dispatch usa o corpo WhatsApp com `*bold*`
removido (SMS não renderiza markdown). Corre localmente e é **free** — o
módulo Pro `sms` gateia apenas transportes geridos (provider comercial via
Cloud, por construir); o gateway Android da loja não exige entitlement.
A responsabilidade é da loja: o SIM é dela, a fatura da operadora e os
limites anti-spam também.
Consentimento partilhado (`whatsappConsent` = opt-in de mensagens
automáticas, qualquer canal). Password do gateway encriptada
(AES-256-GCM); token do webhook gerado por `generateSmsWebhookToken`.

### Canais de mensagens — matriz free/Pro (regra canónica)

**Free = transportes self-hosted e não-oficiais — custo e responsabilidade
ficam do lado da loja (disclaimer aceite, ban/ToS são problema dela).
Pro = apenas APIs oficiais, enviadas e enforçadas pela Cloud — a oferta
premium é "nós tratamos".**

| Canal | Free (infra da loja) | Pro (Cloud envia) |
|---|---|---|
| WhatsApp | Evolution/Baileys (`whatsappTransport:"evolution"`) — não-oficial, risco de ban, disclaimer obrigatório | Meta Business API — credenciais em `shops.whatsappAccessToken`, envio via `POST /whatsapp/send` (402 sem entitlement) |
| SMS | SMS Gateway for Android na LAN — SIM/tarifário e limites da operadora da loja | Provider comercial (BulkSMS/Twilio/…) — `smsTransport:"cloud"`, credenciais na Cloud (`POST /shops/sms-credentials` + `POST /sms/send` — por construir quando surgir o 1.º provider pedido) |

Regras:

- Tudo o que é Pro sai pela Cloud → gate server-side por envio; tudo o que
  é free sai da infra da loja → nada a enforçar. Nunca Baileys/scraping na
  Cloud — "Pro" é só APIs com contrato.
- **Estado: migrado.** Evolution e SMS-Android são free desde o flip
  (disclaimer Evolution mantido); os entitlements `whatsapp-bot`/`sms`
  passaram a gatear apenas os transportes oficiais/geridos.
- Meta direct local (`whatsappApiTokenEncrypted`) é legacy — existe só
  para a migração e apaga-se no primeiro envio Cloud bem-sucedido.
- `customer.whatsappConsent` é o opt-in único para toda a mensagem
  automática, qualquer canal (WA, SMS ou provider futuro).

### Notificações ao cliente — quando disparam e onde vivem

Pipeline única para todos os eventos: código do domínio chama
`notify()` (`notification-dispatch.ts`) → procura template por canal em
`NotificationTemplate` (editável em Definições → Notificações) → gates de
canal ativo + consentimento → `notification-outbox` (fila/retry/cancel) →
transporte resolvido (meta/cloud/evolution ou sms-android). SMS sem
template próprio usa o corpo WhatsApp com `*bold*` removido.

| Evento | Dispara quando | Cliente recebe | Onde no código |
|---|---|---|---|
| `job_created` | reparação criada (intake) | "registada" + link de acompanhamento | `job.service.ts` — create |
| `job_in_repair` | status → IN_REPAIR | "em reparação" + tracking | `updateStatus` — `STATUS_TEMPLATE_MAP` |
| `job_waiting_parts` | status → WAITING_FOR_PARTS | "a aguardar peças" + tracking | idem |
| `job_on_hold` | status → ON_HOLD | "em pausa" + tracking | idem |
| `job_done` | status → DONE | **"reparado e pronto a levantar"** + tracking | idem |
| `job_delivered` | status → DELIVERED | "entregue" + recibo/garantia + link de avaliação | idem |
| `job_returned` | status → RETURNED | "devolvido" | idem |
| `job_cancelled` | status → CANCELLED | "cancelada" | idem |
| `job_overdue` | scheduler: `estimatedDate` passou e job aberto | "está a demorar" + tracking | `jobs/overdue-scheduler.ts` |
| `job_done_reminder` | scheduler: job em DONE há 3+ dias sem entrega (timestamp lido do audit `STATUS_CHANGED`), re-lembra a cada 72h | "vem levantar" + tracking | `jobs/pickup-reminder-scheduler.ts` (PR em revisão — `feat/pickup-reminder`) |
| `quote_sent` | staff clica "enviar orçamento" | valor + link para aprovar/recusar | `job-quote.service.ts` |
| `warranty_return_created` | devolução em garantia criada | "registámos a devolução" + tracking | `routes/jobs.ts` |
| `signature_link` | staff clica "enviar link" no dialog de assinatura (ficha ou termo) | link `/sign/:token` — só aparece se o URL for alcançável fora da loja (relay cloud ou APP_URL/trackingBase público); LAN pura não oferece o botão | `POST /sign-sessions/:token/send` → `signature-link.service.ts` |

Só para staff (IN_APP): `pre_check_submitted`, `return_claim_resolved`,
`part_low_stock`, e uma cópia IN_APP de cada evento de job para o OWNER.
`quote_approved`/`quote_rejected` também só notificam staff — a resposta
do cliente ao orçamento não deve gerar eco de volta ao cliente.

**Consentimento transacional:** `signature_link` está em
`STAFF_INITIATED_TEMPLATES` (`notification-outbox.service.ts`) — eventos
que o staff dispara à mão para um cliente concreto (equivalente a copiar o
link para o WhatsApp da loja) passam sem o opt-in `whatsappConsent`, que
existe para mensagens automáticas. No intake o cliente pode ainda não ter
registo na BD — o gate seria fatal para o caso de uso principal. Os gates
de canal ativo e de configuração mantêm-se; o envio fica em audit
(`NOTIFICATION_SENT`, destinatário mascarado, nunca o URL bearer).

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
| `signature-remote` | Assinatura remota | app: `server/services/signature-relay.service.ts`; cloud: `src/routes/signature.ts`, `public/sign.html`, `SignatureRelaySession` | Implementado |
| `whatsapp-bot` | WhatsApp oficial (bot + relay Meta) | app: `whatsapp-bot.service.ts` + `whatsapp-channel.ts`; cloud: webhook + `WhatsAppInbound` + relay `POST /whatsapp/send`. NÃO gateia o transporte Evolution (free) | Live, E2E provado (SIM → APPROVED real) |
| `diag-intake` | Receção de diagnósticos | app: `intake-request.service.ts` (fila em Pedidos); cloud: `src/routes/intake.ts` | Implementado |
| `ai-reports` | Relatórios IA | cloud: `src/routes/reports.ts`, `src/ai-report.ts` | Implementado |
| `market` | Procuro-peça B2B | app: `part-requests.service.ts`; cloud: `src/routes/part-requests.ts` | Live |
| `storefront` | Loja online da loja | app: `storefront.service.ts`; cloud: `src/routes/storefront.ts`, `public/storefront.html` | Live |
| `storefront-plus` | Personalização da montra | cor/logo/layout — `Storefront.accentColor/logoImage/template` | Live |
| `remarketing` | Remarketing WhatsApp | app: `remarketing.service.ts` (sweep horário, template Meta) | Live |
| `market-prices` | Preços de mercado agregados | app: `market-prices.service.ts`; cloud: `src/routes/prices.ts` (≥3 lojas por benchmark) | Live |
| `invoicing` | Faturação InvoiceXpress | app: `invoicing.service.ts` (FR/FS, IVA incluído→líquido) | Live, validado conta demo |
| `multi-shop` | Dashboard multi-loja | app: `shop-metrics.service.ts` (snapshot diário); cloud: `src/routes/metrics.ts` + `ShopMetric`, UI no dashboard do dono | Live |

(O canal `sms` saiu dos módulos Pro — é core grátis, ver secção acima.)

Ativar/desativar: lado da Cloud (`scripts/grant.ts` / dashboard). A app esconde
a funcionalidade se o módulo não constar nos entitlements — mas a cache local
é apenas um **hint de UI com validade de 24h** (`cloudSyncedAt`): a enforcement
real é server-side, no endpoint Cloud de cada módulo (ex.: `/whatsapp/send`
exige `whatsapp-bot`).

## Onde está cada coisa (para quem chega ao código)

- **Segurança da app**: `server/plugins/security.ts` (SSOT — relaxada para LAN HTTP de propósito, ver CLAUDE.md)
- **Token WhatsApp**: na Cloud (`shops.whatsappAccessToken`, AES-GCM `SECRETS_KEY`); legado local `whatsappApiTokenEncrypted` (AES-256-GCM, `server/lib/crypto.ts`) até migrar
- **Canal WhatsApp (cloud vs local)**: `server/services/whatsapp-channel.ts`
- **Entitlements + poller**: `server/services/cloud.service.ts`
- **Credenciais WhatsApp na UI**: menu **Notificações → Setup → WhatsApp** (`src/components/modules/notifications/channel-settings.tsx`), API `PUT /api/settings/whatsapp`
- **Emparelhamento na UI**: **Definições → separador Cloud** (`src/components/modules/settings/settings-cloud-tab.tsx`)
- **Webhook Meta**: `oficinaos-cloud/src/index.ts` + rota WhatsApp
- **Copy do site** (todo o texto público): `oficinaos-website/src/i18n/{pt,en,es}.ts` — data-driven, `Copy` deriva de `pt.ts`
- **Docs ao utilizador**: `oficinaos-website` `/docs` + `/docs/{portal,whatsapp,diag}` — o site, não os `.md`, é a fonte para clientes
- **Docs técnicas**: `reparilo/docs/` (pro-modules.md, remote-access.md, mobile-access.md, privacy-and-data.md, este mapa)
- **Roadmap aprovado (não implementado)**: `docs/marketplace.md` — classificados B2B entre lojas, pós-beta; `oficinaos-diag/docs/roadmap.md` — licença scrcpy (Apache-2.0, OK comercial) + plano do auto-orçamento determinístico
- **Ideia registada (não aprovada)**: `docs/ai-counter.md` — "Balcão IA" WhatsApp: orçamentos estimados, agendamento, LLM fallback. Só avança com tração no free + interesse Pro

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
