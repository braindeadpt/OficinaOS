# OficinaOS ecosystem — repository map

> **Read this file first.** OficinaOS is not one repo — it is 4 interconnected
> repositories. This document is the canonical map of how everything connects;
> each repo's README points here.

> **User documentation is part of the change.** Any change to a Pro module,
> Cloud flow, permission or user-visible behavior implies updating the docs on
> the website (`oficinaos-website/src/i18n/{pt,en,es}.ts` — `moduleDocs.<module>`
> when an affected module exists; cross-cutting changes like permissions update
> only the `docs.sections` of the full guide) — in the same PR or a twinned
> website PR. Outdated docs are bugs.

## The 4 repositories

| Repo | GitHub | What it is | Stack |
|---|---|---|---|
| `reparilo` | [braindeadpt/OficinaOS](https://github.com/braindeadpt/OficinaOS) | **The shop app** — repair management, runs on the shop PC on the LAN | Bun, Fastify, React+Vite, Prisma 7, PostgreSQL, Docker |
| `oficinaos-cloud` | [braindeadpt/oficinaos-cloud](https://github.com/braindeadpt/oficinaos-cloud) | **The bridge server** — accounts, pairing, Pro entitlements, queues and webhooks | Bun, Fastify, Prisma, PostgreSQL |
| `oficinaos-website` | [braindeadpt/oficinaos-website](https://github.com/braindeadpt/oficinaos-website) | **Public site** — marketing + all user-facing documentation (PT/EN/ES) | Astro + Tailwind, static, GitHub Pages |
| `oficinaos-diag` | [braindeadpt/oficinaos-diag](https://github.com/braindeadpt/oficinaos-diag) | **Diagnostics tool** — Windows app that reads Android/iPhone over USB | C# / .NET 8 WPF |

## The architecture in one paragraph

**The shop app is the center.** It runs on a PC inside the shop, stores
everything locally (Postgres), works offline on the LAN — it's free and MIT.
The **Cloud** does not store shop data: it is a bridge that knows (a) which
shops exist, (b) which Pro modules each one pays for, and (c) temporary message
queues crossing the LAN→internet boundary. The commercial model: free local
core; features that need to "reach the internet" are Pro modules activated
**server-side** (no license files in the shop). The website is static with no
runtime connection. Diag is standalone until the user chooses "Send to shop".

## How the pieces connect

### Pairing (once per shop)

1. Owner creates an account at `cloud.oficinaos.app` → dashboard generates a pairing code (24 h)
2. In the app: **Settings → Cloud tab** → paste the code → `POST /pairing/redeem` → permanent shop token
3. From then on the app syncs every **~2 minutes** (`server/services/cloud.service.ts` → poller)

### The 2-minute poller (the heart of the integration)

Every cycle, `server/services/cloud.service.ts` does:

- `POST /shops/sync` → pushes shop config (e.g. `whatsappPhoneNumberId`), receives **entitlements** (active modules)
- `GET /portal/replies` + `POST /portal/replies/ack` → quote responses coming from the public portal
- `GET /signature/replies` + `POST /signature/replies/ack` → signatures captured on the remote page (the ack deletes the PNG on the cloud)
- `GET /whatsapp/inbound` + `POST /whatsapp/inbound/ack` → received WhatsApp messages
- Push of portal snapshots that changed since the last sync
- `POST /shops/metrics` → aggregated daily snapshot (revenue, repairs, sales) if `multi-shop` active — numbers only, never customer data

Besides the 2-min poller there is a **12 s messaging poller**
(`server/jobs/messaging-poller.ts`) just for the inbound queues
(`/whatsapp/inbound`, `/sms/inbound`) — bot replies arrive in
seconds, not minutes.

### `portal` module

App publishes a **redacted** snapshot of the job sheet → `POST /portal/publish` → public
page at `cloud.oficinaos.app/t/:token` (token = 16-char secret).
Accept/decline response → queue → poller → `respondToQuote` (the same counter
service — same audit trail).

**Agent-readable**: the page declares `rel="alternate"` for `GET /api/portal/:token`
(clean JSON, noindex) and the site serves `/llms.txt` — LLMs/agents can read the
repair status from the link. MCP server is roadmap in `docs/pro-modules.md`.

### `signature-remote` module

Remote signature of the intake sheet — the customer signs outside the LAN, no tunnel.

```
App creates local session (same 64-hex token — LAN 15min; relayed on the cloud
extends to 30min, link alive only while the dialog is open) →
POST /signature/sessions publishes the REDACTED document
(publicDocumentView — no unlock codes) → public page
cloud.oficinaos.app/sign/:token → customer signs (PNG ≤500KB, atomic
single-use submission, per-IP rate limit) → app poller →
pullSignatureReplies → submitSignatureSession (the same LAN QR
service — same proof, hash and audit trail) → POST /signature/replies/ack
deletes the PNG on the cloud.
```

The cloud is only transport: it holds the signature until the ack, it is never
the owner of the proof — that stays in the local app (`signatureDataUrl` +
`documentHash`). Invalidating the local session issues
`DELETE /signature/sessions/:token`; the 15-min LAN QR keeps existing for
those without the module.

### `whatsapp-bot` module

```
Inbound:  Customer → WhatsApp Meta → POST /webhooks/whatsapp (HMAC signature
  validated with WA_APP_SECRET) → WhatsAppInbound queue (routing by
  phone_number_id, dedupe by wamid) → app poller →
  server/services/whatsapp-bot.service.ts (match by last 9 phone digits
  → active jobs → reply)
Outbound: app → POST /whatsapp/send (Cloud relay, no credentials in the
  request) → Cloud sends to the Graph API with the shop's Meta token
```

**The Meta token lives in the Cloud** (`shops.whatsappAccessToken`, AES-GCM with
`SECRETS_KEY`): the app uploads it once via `POST /shops/whatsapp-credentials`
(at setup or on the bot's first cycle) and never gets it back. Sending is
authorized server-side by entitlement — the local module cache is only a
UI hint (expires 24h after the last sync). Older installs keep sending with
the local token (`whatsappApiTokenEncrypted`, AES-256-GCM under
`AI_ENCRYPTION_KEY`) until the first successful Cloud send — at which point
the local token is wiped. The Cloud neither stores nor logs message bodies;
logs carry only id/state/error and masked phone.

**Unpair**: the app calls `DELETE /shops/me` — the Cloud deletes the `Shop` row and the
cascade (`onDelete: Cascade`) takes everything it owns: tokens, entitlements,
intake reports, WhatsApp/SMS queues, portal replies, signature
sessions, storefront, metrics and price contributions. Tokens with
`diag` scope cannot call this endpoint (the bench doesn't unpair the shop).
On older Clouds without the endpoint the app falls back to partial cleanup
(`DELETE /shops/whatsapp-credentials`).

#### Alternative transport: local WhatsApp (Evolution API)

`whatsappTransport` in ShopSettings: `"meta"` (default — flow above) or
`"evolution"` — Evolution API v2 (Baileys/WhatsApp Web, **unofficial**)
running on the shop LAN (`docker compose --profile wa-local up -d`,
`evolution` + `evolution-db` services with their own Postgres — never touches
the app's DB). Sending is `POST {evolutionUrl}/message/sendText/{instance}`
via `server/services/evolution.service.ts`; pairing by QR/pairingCode at
`POST /settings/whatsapp/evolution/pair`, health check at
`GET /settings/whatsapp/evolution/status` (open/connecting/close) and
`DELETE`-like logout at `/evolution/disconnect`.

Gates (app-side): `whatsappLocalDisclaimerAt` mandatory in the settings PUT
and revalidated in `resolveWhatsAppChannel` before every send; without it
the channel resolves null and the outbox cancels. Since the owner's decision
of 2026-11-23 it is **Pro** — it requires the fresh `whatsapp-bot`
entitlement like the other transports (free sends nothing).
`syncFullHistory=false` — none of the customer's history is imported.
Remarketing requires Meta templates → refused in local mode.
Session/keys never leave the shop (clean GDPR); number-ban risk is
documented in the UI disclaimer.

**Pro bot over Evolution** (§5.7): with `whatsapp-bot` entitlement +
bot term accepted (`whatsappBotDisclaimerAt`/`UserId` — separate from the
transport disclaimer), Evolution posts `MESSAGES_UPSERT` to
`POST /api/public/whatsapp/evolution/inbound` with the secret in the
`x-oficinaos-webhook-token` header (the legacy `/inbound/:token` variant in
the path is still accepted for already-registered webhooks; public hosts are
registered in HTTPS) and the app replies
through the shared pipeline with anti-ban protections: ignores
fromMe/groups/broadcast/newsletters, non-text and numbers without a customer
record escalate to staff, dedupe by id, "typing…" presence + 3–8 s delay,
10 replies/h per number, daily cap per instance
(`whatsappBotDailyCap`, default 200), and a session error suspends the bot
(`whatsappBotSuspendedAt`) until re-acceptance.

### SMS channel (Pro — local Android gateway or Cloud)

```
Outbound: event → notification-dispatch → outbox →
  POST http://<phone>:8080/message (Basic auth, LAN — sms-gate.app)
Inbound:  customer SMS → SMS Gateway for Android → webhook
  POST /api/public/sms/inbound/:token (route-security: CSRF off + rate limit)
  → only processes with fresh `sms` or `ai-inbox` (isModuleEnabled — free
    answers 200 without reading, except PARAR/STOP) → handleInboundSms →
    with `sms`: same bot intents (bot-intents.ts shared with
    whatsapp-bot) → automatic reply; only `ai-inbox`: recorded in the
    inbox, no reply
```

100% LAN transport: the SMS itself only leaves via the mobile network — Meta is
not involved. **Attention (WP0.4): composing the automatic reply goes
through the Cloud** even on this channel — the bot rules (status, quote,
REP codes) live in `/ai/bot-reply` and the app sends it the repair
context — the `vistaCliente` projection (closed field list, no internal
ids except the pending quote's) — with or without AI active. Cloud down →
the customer gets only a generic ack ("the shop will reply soon") and the
conversation escalates to staff — no rules reply and no AI. PARAR/STOP is
the deliberate exception: consent revocation always runs locally.
Without a dedicated SMS template, dispatch uses the WhatsApp body with
`*bold*` stripped (SMS doesn't render markdown). Since the owner's decision
of 2026-11-23 **all SMS is Pro — including LAN sending**: the outbox's
`getSmsConfig` only resolves the gateway with
`isModuleEnabled(settings, "sms")` (entitlement + `cloudSyncedAt` < 24 h)
and `PUT /settings/sms` + `POST /settings/sms/test` return 402 without it.
**Inbound** is also Pro: the public route only calls `handleInboundSms`
with the same fresh check (`sms` **or** `ai-inbox` — with only `ai-inbox` the
message is recorded in the inbox, no automatic reply); with neither the LAN
webhook returns 200 with no bot and no recording — **except PARAR/STOP**,
which revokes consent even without the module (opt-out is legal and doesn't
depend on payment; same rule as the Evolution bot). This only applies to the
device posting to the LAN: the Cloud SMS-queue poller runs only with the
`sms` entitlement.
Responsibility lies with the shop: the SIM is theirs, so are the carrier bill
and anti-spam limits.
Shared consent (`whatsappConsent` = opt-in to automated messages, any
channel) — recorded even without Pro, ready for when the shop activates the
module. Gateway password encrypted (AES-256-GCM); webhook token generated by
`generateSmsWebhookToken`. Automatic replies go out transliterated to GSM-7
(`toSmsText`) — accents outside it cost UCS-2 and split the message.

### `sms` module (Pro — Android SMS via Cloud, multi-shop)

The same SMS Gateway for Android in **server/cloud mode**: the phone
connects to the Cloud (`SmsDevice`, Basic auth + configurable `gatewayUrl` —
today sms-gate's public cloud, tomorrow our private server with the same
API). The app sends via `POST /sms/send` on the Cloud (402 without
entitlement), which queues on the device and then falls to the LAN gateway
as fallback when configured.

```
Inbound:  customer SMS → device → webhook POST /webhooks/sms-gate/:secret
  on the Cloud → SmsInbound queue → app's 12 s poller → handleInboundSms
Routing:  SmsRoute(deviceId, customerPhone, shopId) — a reply goes to
  the shop of the last send; REP-code in the body is the explicit override
State:    SmsOutbound links delivery events (sms:sent/delivered/failed)
  to the shop outbox
Multi-shop: one phone can serve several shops of the same owner
  (SmsDevice.ownerId → User, Shop.smsDeviceId)
"Shop closed" fallback: inbound RECEIVED unconsumed for >5 min
  (SmsInbound/WhatsAppInbound without ack) → the Cloud sends the shop's
  text ("We received your message. The shop will reply when it opens.")
  and marks fallbackSentAt — max 1 per number/12 h
```

### `whatsapp-bot` module — shared engine + automatic templates

The three channels (SMS, official WhatsApp, Evolution) share the same
reply pipeline (`server/services/bot-intents.ts`): deterministic rules
first (quote YES/NO, REP-code, STOP) and only then AI with tools running
in the app over `vistaCliente()` (job sheet with a closed field list —
`holdReason`, IMEI, suppliers and codes never leave). AI =
`POST /ai/bot-reply` on the Cloud (`{type:"reply"|"tool_calls"}`,
zod-validated, counters in `AiBotUsage`, per-channel entitlement —
`sms`/`whatsapp-bot`).

24 h window (Meta): shop-initiated messages always go out as
**template**; a reply to a customer message <24 h is free text.
Inbound older than the window gets an ack with no reply.

Automatic templates (§5.6 C.2): the texts of the WHATSAPP
`NotificationTemplate`s are submitted to Meta as `UTILITY`/`pt_PT`
templates with positional parameters `{{1}}…` in the order of the
`{{var}}`s — only in Pro/cloud mode, delegating to
`POST /whatsapp/templates/sync` + `GET /whatsapp/templates` on the Cloud.
Per-template state in `ShopSettings.whatsappTemplatesJson` → chip in the
UI + "Resubmit". The outbox records `templateParams` in the same
order and sends `type:"template"` when the transport is Meta/Cloud.

### `ai-inbox` module (unified inbox + staff AI)

The staff inbox and the team AI assistant — its own module,
contractable alone (commercial name and price TBD —
`{{AI_INBOX_NOME}}`/`{{AI_INBOX_PRECO}}`).

- **Inbox:** all received/sent WhatsApp (official + Evolution) and SMS
  messages — including the bot's — land in `BusinessMessage`
  (`channel`, `direction`, `customerId`, `externalId`,
  `conversationKey`, `conversationStatus`, `assignedToId`,
  `handledBy`). "Messages" UI: conversations, filters, assignment and
  manual reply.
- **Tools in the app:** a single `staffInboxTools` set
  (list/read/search conversations, customer summary, assign, draft,
  `enviar_rascunho` only after human approval) runs on the local DB
  with the user's permissions — never on the Cloud.
- **Permanent app → Cloud connection** (`/ai-inbox/link`, WebSocket/SSE
  initiated by the app, shop token, backoff reconnection): the Cloud
  sends `{callId, tool, args, userId}` and the app returns the result.
  No open ports in the shop; app offline → "The shop is offline".
- **`POST /ai/staff-reply`** (Cloud): same stateless pattern as
  `/ai/bot-reply` — the app sends the staff conversation + tool
  results, the Cloud returns `tool_calls` or the final reply. System
  prompt and tool schemas exist only on the Cloud. Model: any
  OpenAI-compatible API, with the shop's own key encrypted on the Cloud
  (never returned) or the included model with usage metering.
- **`/mcp` on the Cloud** (`cloud.oficinaos.app/mcp`, Streamable HTTP):
  hosted MCP server — Claude, ChatGPT, Cursor, Gemini CLI, LM
  Studio/Open WebUI and other clients connect with a **personal token
  per user** (the Cloud stores only the hash; that profile's
  permissions; created/revoked in Settings → AI → "Connect another
  AI"). Each call is routed through the `/ai-inbox/link` connection to
  the right app. There is no `/mcp` in the app or on the LAN.
- **Security:** sending always in two steps (draft → human approval in
  the app); customer text marked as untrusted; every call goes to
  `AuditLog`; `deviceUnlockCode`/`imei`/signatures never leave.
- **Needs a channel that receives:** Evolution on the LAN (works with
  this module alone — records in the inbox but the bot doesn't reply)
  or `whatsapp-bot`/`sms`. Without entitlement → 402 on
  `/ai/staff-reply`, `/mcp` and the connection.

### Messaging channels — free/Pro matrix (canonical rule)

**Owner's decision (2026-11-23): free sends NOTHING — every message
(SMS + WhatsApp, all transports, sending and receiving) is Pro.** The
self-hosted transports (Evolution, LAN Android gateway) continue to
exist, but they are Pro transports: the Evolution disclaimer and the
shop's responsibility (SIM, carrier, ban/ToS) remain.

| Channel | Free | Pro |
|---|---|---|
| WhatsApp | nothing — channel resolves `null`, routes 402, UI locked | `whatsapp-bot`: Meta Business API relay (`POST /whatsapp/send`), direct local Meta or Evolution (unofficial, disclaimer); templates auto-synced on the Cloud |
| SMS | nothing — config resolves `null`, routes 402, UI locked | `sms`: Android connected to the Cloud (`SmsDevice`/`SmsRoute`, multi-shop) or LAN gateway as fallback |

Rules:

- The gate is always the fresh entitlement (`isModuleEnabled`, cache
  <24h) checked at channel resolve, dispatch, outbox and routes —
  never transport removal. Never Baileys/scraping on the Cloud.
- **Status: migrated 2026-11-23.** Evolution and SMS-Android stopped
  being free; `PUT /settings/sms`, `PUT /settings/whatsapp`,
  `POST /settings/sms/test`, `POST /settings/whatsapp/evolution/pair`
  and the notification test return 402 `CLOUD_MODULE_REQUIRED` without
  a module. In the UI the cards/buttons stay visible but locked —
  clicking shows "This option only exists in OficinaOS Pro.".
- Direct local Meta (`whatsappApiTokenEncrypted`) is an alternative Pro
  transport to the relay — the local token is wiped on the first
  successful Cloud send.
- `customer.whatsappConsent` is the single opt-in for all automated
  messaging — recorded even without Pro (ready for when it activates).
- Opt-out ("PARAR"/"STOP") on free: the LAN webhooks (SMS and
  Evolution) revoke consent without replying or recording; on the other
  channels staff turns it off on the customer record.
- `POST /api/public/quote-respond` stays free — a public quote-response
  page, not a messaging channel.
- Free inbound: SMS/Evolution webhooks answer 200 without processing
  (only PARAR/STOP revokes consent).

### Customer notifications — when they fire and where they live

Single pipeline for all events: domain code calls
`notify()` (`notification-dispatch.ts`) → looks up per-channel template in
`NotificationTemplate` (editable in Settings → Notifications) → active-channel
+ consent gates → `notification-outbox` (queue/retry/cancel) → resolved
transport (meta/cloud/evolution or sms-android). SMS without its own
template uses the WhatsApp body with `*bold*` stripped.

| Event | Fires when | Customer receives | Where in the code |
|---|---|---|---|
| `job_created` | repair created (intake) | "registered" + tracking link | `job.service.ts` — create |
| `job_in_repair` | status → IN_REPAIR | "in repair" + tracking | `updateStatus` — `STATUS_TEMPLATE_MAP` |
| `job_waiting_parts` | status → WAITING_FOR_PARTS | "waiting for parts" + tracking | idem |
| `job_on_hold` | status → ON_HOLD | "on hold" + tracking | idem |
| `job_done` | status → DONE | **"repaired and ready for pickup"** + tracking | idem |
| `job_delivered` | status → DELIVERED | "delivered" + receipt/warranty + review link | idem |
| `job_returned` | status → RETURNED | "returned" | idem |
| `job_cancelled` | status → CANCELLED | "cancelled" | idem |
| `job_overdue` | scheduler: `estimatedDate` passed and job open | "taking longer" + tracking | `jobs/overdue-scheduler.ts` |
| `job_done_reminder` | scheduler: job in DONE for 3+ days undelivered (timestamp read from the `STATUS_CHANGED` audit), re-reminds every 72h | "come pick it up" + tracking | `jobs/pickup-reminder-scheduler.ts` |
| `quote_sent` | staff clicks "send quote" | amount + link to approve/decline | `job-quote.service.ts` |
| `warranty_return_created` | warranty return created | "we registered the return" + tracking | `routes/jobs.ts` |
| `signature_link` | staff clicks "send link" in the signature dialog (sheet or term) | `/sign/:token` link — only appears if the URL is reachable outside the shop (cloud relay or public APP_URL/trackingBase); pure LAN doesn't offer the button | `POST /sign-sessions/:token/send` → `signature-link.service.ts` |

Staff-only (IN_APP): `pre_check_submitted`, `return_claim_resolved`,
`part_low_stock`, and an IN_APP copy of every job event for the OWNER.
`quote_approved`/`quote_rejected` also only notify staff — the customer's
quote response shouldn't echo back to the customer.

**Transactional consent:** `signature_link` is in
`STAFF_INITIATED_TEMPLATES` (`notification-outbox.service.ts`) — events
staff fires by hand for a specific customer (equivalent to copying the
link into the shop's WhatsApp) pass without the `whatsappConsent` opt-in,
which exists for automated messages. At intake the customer may not yet
have a DB record — the gate would be fatal for the main use case. The
active-channel and configuration gates remain; sending is audited
(`NOTIFICATION_SENT`, masked recipient, never the bearer URL).

### `diag-intake` + `ai-reports` modules

`oficinaos-diag` runs 100% local on the customer's PC. If the user enters
the shop code → `POST` intake → Cloud → app collects as a **Request**
(`server/services/intake-request.service.ts`) → convertible into a repair.
`ai-reports`: raw scan data → `POST /reports/diagnostic` → report in plain
language generated on the Cloud.

## Endpoints and environments

| What | Where |
|---|---|
| Shop app | `http://localhost:4000` (Docker) — or LAN IP |
| Production Cloud | `https://cloud.oficinaos.app` (Docker Compose) |
| WhatsApp webhook | `https://cloud.oficinaos.app/webhooks/whatsapp` (verify token + HMAC `WA_APP_SECRET`) |
| Privacy policy (Meta requirement) | `https://cloud.oficinaos.app/privacy` |
| Public site | `https://oficinaos.app` (GitHub Pages — auto-deploys on push to `main`) |
| Diag releases | `github.com/braindeadpt/oficinaos-diag/releases` |

## Pro modules — identifiers

| Module ID | Name | Where in the code | Status |
|---|---|---|---|
| `portal` | Customer portal | app: `server/services/portal.service.ts`; cloud: `src/routes/portal.ts`, `public/portal.html` | Live, E2E tested |
| `signature-remote` | Remote signature | app: `server/services/signature-relay.service.ts`; cloud: `src/routes/signature.ts`, `public/sign.html`, `SignatureRelaySession` | Implemented |
| `whatsapp-bot` | Official WhatsApp (bot + Meta relay) | app: `whatsapp-bot.service.ts` + `whatsapp-channel.ts`; cloud: webhook + `WhatsAppInbound` + relay `POST /whatsapp/send`. Since 2026-11-23 gates ALL WhatsApp transports: cloud relay, local Meta and Evolution | Live, E2E proven (YES → real APPROVED) |
| `diag-intake` | Diagnostics intake | app: `intake-request.service.ts` (queue in Requests); cloud: `src/routes/intake.ts` | Implemented |
| `ai-reports` | AI reports | cloud: `src/routes/reports.ts`, `src/ai-report.ts` | Implemented |
| `market` | B2B part-sourcing | app: `part-requests.service.ts`; cloud: `src/routes/part-requests.ts` | Live |
| `storefront` | Shop online store | app: `storefront.service.ts`; cloud: `src/routes/storefront.ts`, `public/storefront.html` | Live |
| `storefront-plus` | Storefront customization | color/logo/layout — `Storefront.accentColor/logoImage/template` | Live |
| `remarketing` | WhatsApp remarketing | app: `remarketing.service.ts` (hourly sweep, Meta template) | Live |
| `market-prices` | Aggregated market prices | app: `market-prices.service.ts`; cloud: `src/routes/prices.ts` (≥3 shops per benchmark) | Live |
| `invoicing` | InvoiceXpress invoicing | app: `invoicing.service.ts` (FR/FS, VAT-included→net) | Live, validated demo account |
| `multi-shop` | Multi-shop dashboard | app: `shop-metrics.service.ts` (daily snapshot); cloud: `src/routes/metrics.ts` + `ShopMetric`, UI in the owner dashboard | Live |
| `ai-inbox` | Inbox + staff AI | app: `staffInboxTools` + permanent connection; cloud: `/ai/staff-reply`, `/ai-inbox/link`, `/mcp` (personal tokens, hash only) | In development — name/price TBD |
| `ponto` | Time-tracking via WhatsApp/SMS | app: `server/services/ponto/` + `server/routes/ponto.ts` (Cloud proxy); cloud: `src/routes/ponto.ts` — `POST /ponto/evaluate` runs on the Cloud, `PontoToken` ~24 h, public page `/ponto/:qrId` (`/ponto/:slug` is only the temporary legacy redirect); the `TimeEntry` records stay in the app | In beta — name/price TBD |

(The `sms` channel became a Pro module again on 2026-11-23 — including the
LAN gateway, which remains as the fallback for the Cloud path. See the
section above.)

Activation/deactivation: Cloud side (`scripts/grant.ts` / dashboard). The app hides
the feature if the module is absent from entitlements — but the local cache
is only a **UI hint valid for 24h** (`cloudSyncedAt`): real enforcement is
server-side, on each module's Cloud endpoint (e.g. `/whatsapp/send`
requires `whatsapp-bot`).

## Where everything lives (for those arriving at the code)

- **App security**: `server/plugins/security.ts` (SSOT — relaxed for LAN HTTP on purpose, see CLAUDE.md)
- **WhatsApp token**: on the Cloud (`shops.whatsappAccessToken`, AES-GCM `SECRETS_KEY`); local legacy `whatsappApiTokenEncrypted` (AES-256-GCM, `server/lib/crypto.ts`) until migration
- **WhatsApp channel (cloud vs local)**: `server/services/whatsapp-channel.ts`
- **Entitlements + poller**: `server/services/cloud.service.ts`
- **WhatsApp credentials in the UI**: menu **Notifications → Setup → WhatsApp** (`src/components/modules/notifications/channel-settings.tsx`), API `PUT /api/settings/whatsapp`
- **Pairing in the UI**: **Settings → Cloud tab** (`src/components/modules/settings/settings-cloud-tab.tsx`)
- **Meta webhook**: `oficinaos-cloud/src/index.ts` + WhatsApp route
- **Site copy** (all public text): `oficinaos-website/src/i18n/{pt,en,es}.ts` — data-driven, `Copy` derives from `pt.ts`
- **User docs**: `oficinaos-website` `/docs` + `/docs/{portal,whatsapp,diag}` — the site, not the `.md` files, is the source for customers
- **Technical docs**: `reparilo/docs/` (pro-modules.md, remote-access.md, mobile-access.md, privacy-and-data.md, this map)
- **Approved roadmap (not implemented)**: `docs/marketplace.md` — B2B classifieds between shops, post-beta; `oficinaos-diag/docs/roadmap.md` — scrcpy license (Apache-2.0, commercially OK) + deterministic auto-quote plan
- **Recorded idea (not approved)**: `docs/ai-counter.md` — WhatsApp "AI Counter": estimated quotes, scheduling, LLM fallback. Only moves forward with free traction + Pro interest

## Cross-cutting rules (apply to all repos)

- **Bun only** in JS projects — never npm/pnpm/npx
- **No local license files** — Pro is always server-side entitlement
- **Privacy-first**: nothing leaves the shop by default; each module documents what leaves
- **OficinaOS branding** — never reintroduce "Reparilo" in visible strings
- **No secrets in code/docs** — Meta tokens, app secrets and the like live in `.env`/encrypted DB

## Current state (beta) and known gaps

- ✅ App + Cloud + site + Meta webhook: live and E2E proven (portal link, bot replies, YES approves a real quote)
- ⏳ Meta Business Verification — needed for real shop numbers (coexistence) and embedded signup
- ⏳ Approved WhatsApp templates — needed for proactive notifications outside the 24h window
- ⏳ Diag tests with a real phone (Android and iPhone)
- ⏳ Onboarding of the 1st real beta shop + price validation
