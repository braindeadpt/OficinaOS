# Ecossistema OficinaOS — mapa dos repositórios

> **Lê este ficheiro primeiro.** O OficinaOS não é um repo — são 4 repositórios
> interligados. Este documento é o mapa canónico de como tudo se liga; os READMEs
> de cada repo apontam para aqui.

> **Documentação ao utilizador é parte da mudança.** Qualquer alteração a um
> módulo Pro, fluxo Cloud, permissão ou comportamento visível ao utilizador
> implica atualizar os docs no website (`oficinaos-website/src/i18n/{pt,en,es}.ts`
> — `moduleDocs.<módulo>` quando existe um módulo afetado; mudanças
> transversais como permissões atualizam só `docs.sections` do guia
> completo) — na mesma PR ou numa PR geminada ao website. Docs
> desatualizados são bugs.

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

Além do poller de 2 min há um **poller de mensagens de 12 s**
(`server/jobs/messaging-poller.ts`) só para as filas inbound
(`/whatsapp/inbound`, `/sms/inbound`) — respostas do bot chegam em
segundos, não em minutos.

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
sem ele o canal resolve null e o outbox cancela. Desde a decisão do
dono de 2026-11-23 é **Pro** — exige o entitlement `whatsapp-bot`
fresco como os restantes transportes (grátis não envia nada).
`syncFullHistory=false` — nada do
histórico do cliente é importado. Remarketing exige templates Meta →
recusado no modo local. A sessão/chaves nunca saem da loja (RGPD limpo);
risco de ban do número fica documentado no disclaimer do UI.

**Bot Pro sobre Evolution** (§5.7): com entitlement `whatsapp-bot` +
termo do bot aceite (`whatsappBotDisclaimerAt`/`UserId` — separado do
disclaimer do transporte), a Evolution posta `MESSAGES_UPSERT` em
`POST /api/public/whatsapp/evolution/inbound` com o segredo no header
`x-oficinaos-webhook-token` (a variante legada `/inbound/:token` no
path continua aceite para webhooks já registados; hosts públicos são
registados em HTTPS) e a app responde
pelo pipeline partilhado com proteções anti-ban: ignora
fromMe/grupos/broadcast/newsletters, não-texto e números sem ficha de
cliente escalam ao staff, dedupe por id, presença "a escrever…" + atraso
3–8 s, 10 respostas/h por número, teto diário por instância
(`whatsappBotDailyCap`, default 200), e erro de sessão suspende o bot
(`whatsappBotSuspendedAt`) até novo aceite.

### Canal SMS (Pro — gateway Android local ou Cloud)

```
Outbound: evento → notification-dispatch → outbox →
  POST http://<telemovel>:8080/message (Basic auth, LAN — sms-gate.app)
Inbound:  cliente SMS → SMS Gateway for Android → webhook
  POST /api/public/sms/inbound/:token (route-security: CSRF off + rate limit)
  → só processa com entitlement `sms` fresco (isModuleEnabled — grátis
    responde 200 sem ler) → handleInboundSms → mesmos intents do bot
    (bot-intents.ts partilhado com whatsapp-bot) → resposta automática
```

100% LAN: nada passa pela Cloud nem pela Meta — só sai o SMS pela rede móvel.
Sem template SMS dedicado, o dispatch usa o corpo WhatsApp com `*bold*`
removido (SMS não renderiza markdown). Desde a decisão do dono de
2026-11-23 **todo o SMS é Pro — inclusive o envio pela LAN**: o
`getSmsConfig` do outbox só resolve o gateway com
`isModuleEnabled(settings, "sms")` (entitlement + `cloudSyncedAt` < 24 h)
e o `PUT /settings/sms` + `POST /settings/sms/test` devolvem 402 sem ele.
O **inbound** também é Pro: a rota pública só chama `handleInboundSms`
com o mesmo check fresco; sem Pro o webhook devolve 200 e não processa
nada — nem bot, nem gravação, nem PARAR/STOP (o opt-out manual fica a
cargo do staff na ficha do cliente).
A responsabilidade é da loja: o SIM é dela, a fatura da operadora e os
limites anti-spam também.
Consentimento partilhado (`whatsappConsent` = opt-in de mensagens
automáticas, qualquer canal) — gravado mesmo sem Pro, fica pronto para
quando a loja ativar o módulo. Password do gateway encriptada
(AES-256-GCM); token do webhook gerado por `generateSmsWebhookToken`.
Respostas automáticas saem transliteradas para GSM-7 (`toSmsText`) —
acentos fora pagam UCS-2 e partem a mensagem.

### Módulo `sms` (Pro — SMS Android via Cloud, multi-loja)

O mesmo SMS Gateway for Android em **modo servidor/cloud**: o telemóvel
liga-se à Cloud (`SmsDevice`, Basic auth + `gatewayUrl` configurável —
hoje a cloud pública do sms-gate, amanhã o nosso servidor privado com a
mesma API). A app envia por `POST /sms/send` na Cloud (402 sem
entitlement), que fila no device e depois cai no gateway LAN como
fallback quando configurado.

```
Inbound:  cliente SMS → device → webhook POST /webhooks/sms-gate/:secret
  na Cloud → SmsInbound fila → poller de 12 s da app → handleInboundSms
Routing:  SmsRoute(deviceId, customerPhone, shopId) — uma resposta vai
  para a loja do último envio; REP-code no corpo é o override explícito
Estado:   SmsOutbound liga delivery events (sms:sent/delivered/failed)
  ao outbox da loja
Multi-loja: um telemóvel pode servir várias lojas do mesmo dono
  (SmsDevice.ownerId → User, Shop.smsDeviceId)
Fallback "loja fechada": inbound RECEIVED não consumido há >5 min
  (SmsInbound/WhatsAppInbound sem ack) → a Cloud envia o texto da loja
  ("Recebemos a sua mensagem. A loja responde assim que abrir.") e
  marca fallbackSentAt — no máx. 1 por número/12 h
```

### Módulo `whatsapp-bot` — motor comum + templates automáticos

Os três canais (SMS, WhatsApp oficial, Evolution) partilham o mesmo
pipeline de resposta (`server/services/bot-intents.ts`): regras
determinísticas primeiro (SIM/NÃO de orçamento, REP-code, PARAR) e só
depois a IA com ferramentas que correm na app sobre `vistaCliente()`
(ficha com lista fechada de campos — `holdReason`, IMEI, fornecedores e
códigos nunca saem). IA = `POST /ai/bot-reply` na Cloud
(`{type:"reply"|"tool_calls"}`, zod-validado, contadores em
`AiBotUsage`, entitlement por canal — `sms`/`whatsapp-bot`).

Janela de 24 h (Meta): mensagens iniciadas pela loja saem sempre como
**template**; resposta a mensagem do cliente <24 h é texto livre.
Inbound mais velho que a janela recebe ack sem resposta.

Templates automáticos (§5.6 C.2): os textos das `NotificationTemplate`
WHATSAPP são submetidos à Meta como templates `UTILITY`/`pt_PT` com
parâmetros posicionais `{{1}}…` na ordem das `{{var}}` — só em modo
Pro/cloud, delegando em
`POST /whatsapp/templates/sync` + `GET /whatsapp/templates` na Cloud.
Estado por template em `ShopSettings.whatsappTemplatesJson` → chip na
UI + "Voltar a submeter". O outbox grava `templateParams` na mesma
ordem e envia `type:"template"` quando o transporte é Meta/Cloud.

### Módulo `ai-inbox` (caixa de entrada unificada + IA de staff)

A caixa de entrada do staff e o assistente de IA para a equipa —
módulo próprio, contratável sozinho (nome comercial e preço por
decidir — `{{AI_INBOX_NOME}}`/`{{AI_INBOX_PRECO}}`).

- **Caixa de entrada:** todas as mensagens recebidas/enviadas de
  WhatsApp (oficial + Evolution) e SMS — incluindo as do bot — ficam
  em `BusinessMessage` (`channel`, `direction`, `customerId`,
  `externalId`, `conversationKey`, `conversationStatus`,
  `assignedToId`, `handledBy`). UI "Mensagens": conversas, filtros,
  atribuição e resposta manual.
- **Ferramentas na app:** um único conjunto `staffInboxTools`
  (listar/ler/procurar conversas, resumo do cliente, atribuir,
  rascunhar, `enviar_rascunho` só após aprovação humana) corre na BD
  local com as permissões do utilizador — nunca na Cloud.
- **Ligação permanente app → Cloud** (`/ai-inbox/link`, WebSocket/SSE
  iniciada pela app, token da loja, reconexão com backoff): a Cloud
  envia `{callId, tool, args, userId}` e a app devolve o resultado.
  Sem portas abertas na loja; app offline → "A loja está offline".
- **`POST /ai/staff-reply`** (Cloud): mesmo padrão sem estado do
  `/ai/bot-reply` — a app envia a conversa do staff + resultados das
  ferramentas, a Cloud devolve `tool_calls` ou a resposta final.
  System prompt e esquemas das ferramentas existem só na Cloud.
  Modelo: qualquer API compatível com OpenAI, com a chave da própria
  loja cifrada na Cloud (nunca devolvida) ou o modelo incluído com
  medição de uso.
- **`/mcp` na Cloud** (`cloud.oficinaos.app/mcp`, Streamable HTTP):
  servidor MCP alojado — Claude, ChatGPT, Cursor, Gemini CLI,
  LM Studio/Open WebUI e outros clientes ligam-se com um **token
  pessoal por utilizador** (a Cloud guarda só o hash; permissões do
  perfil desse utilizador; criado/revogado em Definições → IA →
  "Ligar a outra IA"). Cada chamada é encaminhada pela ligação
  `/ai-inbox/link` para a app certa. Não existe `/mcp` na app nem na
  LAN.
- **Segurança:** envio sempre em dois passos (rascunho → aprovação
  humana na app); texto de clientes marcado como não-confiável; cada
  chamada vai para `AuditLog`; `deviceUnlockCode`/`imei`/assinaturas
  nunca saem.
- **Precisa de um canal que receba:** Evolution na LAN (funciona só
  com este módulo — grava na caixa de entrada mas o bot não responde)
  ou `whatsapp-bot`/`sms`. Sem entitlement → 402 em
  `/ai/staff-reply`, `/mcp` e na ligação.

### Canais de mensagens — matriz free/Pro (regra canónica)

**Decisão do dono (2026-11-23): o grátis não envia NADA — toda a
mensagem (SMS + WhatsApp, todos os transportes, envio e receção) é
Pro.** Os transportes self-hosted (Evolution, gateway Android LAN)
continuam a existir, mas são transportes Pro: o disclaimer Evolution e
a responsabilidade da loja (SIM, operadora, ban/ToS) mantêm-se.

| Canal | Grátis | Pro |
|---|---|---|
| WhatsApp | nada — canal resolve `null`, rotas 402, UI locked | `whatsapp-bot`: Meta Business API relay (`POST /whatsapp/send`), envio direto Meta local ou Evolution (não-oficial, disclaimer); templates auto-sincronizados na Cloud |
| SMS | nada — config resolve `null`, rotas 402, UI locked | `sms`: Android ligado à Cloud (`SmsDevice`/`SmsRoute`, multi-loja) ou gateway LAN como fallback |

Regras:

- O gate é sempre o entitlement fresco (`isModuleEnabled`, cache <24h)
  verificado no resolve do canal, no dispatch, no outbox e nas rotas —
  nunca a remoção do transporte. Nunca Baileys/scraping na Cloud.
- **Estado: migrado 2026-11-23.** Evolution e SMS-Android deixaram de
  ser free; `PUT /settings/sms`, `PUT /settings/whatsapp`,
  `POST /settings/sms/test`, `POST /settings/whatsapp/evolution/pair` e
  o test de notificação devolvem 402 `CLOUD_MODULE_REQUIRED` sem módulo.
  Na UI os cards/botões ficam visíveis mas locked — clicar mostra
  "Esta opção existe apenas no OficinaOS Pro.".
- Meta direct local (`whatsappApiTokenEncrypted`) é transporte Pro
  alternativo ao relay — o token local apaga-se no primeiro envio Cloud
  bem-sucedido.
- `customer.whatsappConsent` é o opt-in único para toda a mensagem
  automática — gravado mesmo sem Pro (fica pronto para quando ativar).
- Opt-out ("PARAR") 100% manual no grátis — sem receção não há
  processamento; o staff desliga o consentimento na ficha do cliente.
- `POST /api/public/quote-respond` continua grátis — página pública de
  resposta a orçamento, não um canal de mensagens.
- Inbound grátis: webhooks SMS/Evolution respondem 200 sem processar.

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
| `whatsapp-bot` | WhatsApp oficial (bot + relay Meta) | app: `whatsapp-bot.service.ts` + `whatsapp-channel.ts`; cloud: webhook + `WhatsAppInbound` + relay `POST /whatsapp/send`. Desde 2026-11-23 gateia TODOS os transportes WhatsApp: relay cloud, Meta local e Evolution | Live, E2E provado (SIM → APPROVED real) |
| `diag-intake` | Receção de diagnósticos | app: `intake-request.service.ts` (fila em Pedidos); cloud: `src/routes/intake.ts` | Implementado |
| `ai-reports` | Relatórios IA | cloud: `src/routes/reports.ts`, `src/ai-report.ts` | Implementado |
| `market` | Procuro-peça B2B | app: `part-requests.service.ts`; cloud: `src/routes/part-requests.ts` | Live |
| `storefront` | Loja online da loja | app: `storefront.service.ts`; cloud: `src/routes/storefront.ts`, `public/storefront.html` | Live |
| `storefront-plus` | Personalização da montra | cor/logo/layout — `Storefront.accentColor/logoImage/template` | Live |
| `remarketing` | Remarketing WhatsApp | app: `remarketing.service.ts` (sweep horário, template Meta) | Live |
| `market-prices` | Preços de mercado agregados | app: `market-prices.service.ts`; cloud: `src/routes/prices.ts` (≥3 lojas por benchmark) | Live |
| `invoicing` | Faturação InvoiceXpress | app: `invoicing.service.ts` (FR/FS, IVA incluído→líquido) | Live, validado conta demo |
| `multi-shop` | Dashboard multi-loja | app: `shop-metrics.service.ts` (snapshot diário); cloud: `src/routes/metrics.ts` + `ShopMetric`, UI no dashboard do dono | Live |
| `ai-inbox` | Caixa de entrada + IA de staff | app: `staffInboxTools` + ligação permanente; cloud: `/ai/staff-reply`, `/ai-inbox/link`, `/mcp` (tokens pessoais, só hash) | Em desenvolvimento — nome/preço por decidir |
| `ponto` | Livro de ponto por WhatsApp/SMS | app: `server/services/ponto/` + `server/routes/ponto.ts` (proxy Cloud); cloud: `src/routes/ponto.ts` — `POST /ponto/evaluate` corre na Cloud, `PontoToken` ~24 h, página pública `/ponto/:slug`; os registos `TimeEntry` ficam na app | Em beta — nome/preço por decidir |

(O canal `sms` voltou a ser módulo Pro em 2026-11-23 — inclusive o
gateway LAN, que fica como fallback do caminho Cloud. Ver secção acima.)

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
