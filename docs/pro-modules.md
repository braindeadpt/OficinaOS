# Pro modules — OficinaOS Cloud

OficinaOS works **free and complete inside the shop**. Pro modules are
features that need to "reach the internet" — and that goes through
**OficinaOS Cloud** (`cloud.oficinaos.app`), the service connecting the shop
app to the outside world without exposing the shop PC.

```
Shop (local app)                OficinaOS Cloud                 Customer
──────────────                  ────────────────                ────────
Complete data    ── pairs ────►   Redacted snapshots/queues ──►   web portal
                 ◄── replies ──   / WhatsApp messages ◄──         whatsapp
```

- The shop creates a Cloud account and **pairs** the app with a token (done once)
- Each paid module is activated **server-side** (entitlement) — no
  license files
- The app asks the Cloud every ~2 min for news and pushes updates
- **No paired Cloud = everything local free all the same**; Pro modules
  simply don't appear

## Public / private separation

| Repository | Visibility | What lives there |
|---|---|---|
| `OficinaOS` (shop app) | public | Complete local core + Pro **adapters** |
| `oficinaos-cloud` | **private** | All paid logic — portal, bot, AI, queues |
| `oficinaos-diag` | public | Free bench tool |
| `oficinaos-website` | public | Site/docs — zero product logic |

Structural rule: **the paid value lives in the Cloud, not the app**. The app's
public repo contains only thin clients (`portal.service.ts`, `whatsapp-bot.service.ts`)
pushing redacted snapshots — cloning the public repo yields no working Pro
module, because:

- the processing (public pages, bot brain, AI reports) runs entirely
  in the private Cloud
- every Pro route on the Cloud requires server-side entitlement → `402 MODULE_NOT_ENTITLED`
- the app hides the entry points when the module is absent from
  entitlements — the local cache is only a **UI hint** valid for 24h
  (renewed by the ~2 min poller); real enforcement is always on the Cloud

**For future modules**: business logic (AI prompts, decision rules,
aggregation) goes into `oficinaos-cloud`; the app gets only the minimal client
to talk to it. Never paid code compiled into the public app.

## Module summary

| Module | What the customer gets | Where it's used |
|---|---|---|
| `portal` | Public link `cloud.oficinaos.app/t/...` with repair status + accept/decline quote | "Public link" button on the job detail |
| `whatsapp-bot` | Asks "is it ready?" on the shop's WhatsApp and gets an automatic reply; approves quotes with YES/NO | Notifications → Setup → WhatsApp |
| `diag-intake` | Receives diagnostics from `oficinaos-diag` sent by customers | Intake queue in the app |
| `ai-reports` | AI-generated diagnostic reports | Attached to jobs/diag |
| `remarketing` | Automatic recontact of inactive customers via approved WhatsApp template — **also requires `whatsapp-bot`** (sending uses the shop's WhatsApp channel) | Notifications → Setup → WhatsApp |
| `sms` | SMS through the shop's Android — connected **to the Cloud** (sms-gate server mode, multi-shop, works with the PC off) **or on the LAN** as fallback | Notifications → Setup → SMS |
| `ai-inbox` ⚠️ *in development — not yet sold/activatable in production* | Unified WhatsApp/SMS inbox + AI assistant for the team (any LLM, in-app chat or MCP) — **contractable alone** | Messages + Settings → AI |
| `ponto` ⚠️ *in beta — name and price TBD* | Time tracking via WhatsApp/SMS: printed fixed QR, commands (ENTRADA/PAUSA/VOLTEI/SAIDA/ESTADO), location proof within shop radius, records kept 5 years and printable worker information sheet | Settings → Cloud → Ponto section; `/ponto/qr` and `/ponto/info` sheets |

(Since 2026-11-23 **all SMS is Pro** — including the Android gateway on the
LAN, which went from "free core" to Pro transport/fallback. Free neither
sends nor receives any message.)

## Free/Pro table — messaging channels

> **Owner's decision (2026-11-23): free sends NOTHING.** Every
> message — SMS and WhatsApp, all transports and directions — is Pro.
> In the app the cards/buttons stay visible but locked ("This option
> only exists in OficinaOS Pro."); "PARAR" opt-out stays 100% manual;
> `POST /api/public/quote-respond` stays free because it's the public
> quote-response page, not a messaging channel.

| | Free | Pro |
|---|---|---|
| **SMS** | nothing | `sms`: Android connected to the Cloud (`SmsDevice`/`SmsRoute`) — multi-shop, inbound/outbound with PC off, automatic replies + AI — or LAN gateway as fallback |
| **Official WhatsApp** | nothing | `whatsapp-bot`: Meta Cloud API through the Cloud relay `POST /whatsapp/send`; during the 30-day migration direct app→Meta remains only until the Cloud upload is confirmed and afterwards only as the audited fallback. Auto-synced templates, 24 h window, AI |
| **Evolution WhatsApp** | nothing | `whatsapp-bot`: local transport (unofficial, disclaimer) + inbound bot with its own term + anti-ban protections (10/h per number, daily cap, dedupe, 3–8 s delay) |
| **Inbox + staff AI** | nothing | `ai-inbox` *(in development)*: unified WhatsApp/SMS inbox, tools in the app, AI chat in the app (`/ai/staff-reply`) and MCP on the Cloud (`/mcp`) — sending always with human approval |
| **Time tracking (`ponto`)** | nothing | time records enter through the Pro receiving channels above — official WhatsApp (interactive messages + template), Evolution (text + location/photo) and SMS; **requires at least one active Pro receiving channel** |

## Customer portal (`portal`)

When active, each job gets a **"Public link"** button on the detail
page. Clicking it:

1. The app publishes to the Cloud a **redacted** snapshot of the job (status,
   device, quote, deadline, timeline — no internal costs, private
   notes or customer phone)
2. The link is copied: `https://cloud.oficinaos.app/t/<code>` — send it to the
   customer by SMS/WhatsApp/paper
3. The customer opens it at home and sees the status; if there's a pending
   quote, they can **Accept/Decline** — the response enters the app in ≤2 min
   through the normal quote flow (with staff notification)
4. Status changes in the app re-publish automatically; removing the link
   deletes the Cloud page

Whoever has the link sees the page — treat it as a per-job secret.

## WhatsApp bot (`whatsapp-bot`)

The customer writes to the shop's WhatsApp number; the bot replies with real
job-sheet data:

| Customer writes | Bot replies |
|---|---|
| any text with an active job | Repair status + estimate |
| "quote" / "price" | Amount + "reply YES or NO" |
| "YES" / "accept" | Quote approved in the app (same flow as the counter) |
| "NO" / "decline" | Quote declined |
| code `REP-...` | That job's status |
| "help" / audio / image | Escalates to staff + notice in the app |
| unknown number | Default message with shop contact |

Works with the **shop's own number** (Meta "coexistence" — the WhatsApp
Business app keeps working on the phone in parallel).

### Setup — once per OficinaOS account (operator)

Done in the "OficinaOS" Meta App (developers.facebook.com):

1. Create Meta App → use case "Connect with customers through WhatsApp"
2. WhatsApp → API setup → provisioned test number
3. Webhook: Callback `https://cloud.oficinaos.app/webhooks/whatsapp`,
   verify token in `WA_VERIFY_TOKEN` (cloud .env) → **Verify and save**
4. Webhooks → WhatsApp Business Account → subscribe to the **messages** field
5. **Subscribe the app to the WABA** (mandatory — without this Meta doesn't deliver):
   `POST /{WABA_ID}/subscribed_apps` with a valid token
6. `WA_APP_SECRET` = the app's App Secret → cloud `.env` → restart
7. **Publish the app** (Publish → Live): requires a Privacy policy URL —
   served at `https://cloud.oficinaos.app/privacy`
8. Permanent token: Business Settings → System Users → create → link app +
   WABA → generate token with `whatsapp_business_messaging` +
   `whatsapp_business_management`

### Setup — per shop

1. Notifications → **Setup** → WhatsApp: `enabled` + API Token +
   Phone Number ID + Business ID. Saving keeps the token encrypted locally;
   it is uploaded to the Cloud only when staff ticks the explicit consent box
   for Cloud storage and relay. The Cloud validates the token +
   `phone_number_id` pair against the Graph API before storing it encrypted
   (`POST /shops/whatsapp-credentials`; AES-256-GCM, key material in the
   `SECRETS_KEY` environment variable, outside the database). The shared
   30-day migration window starts on the first boot of the app version that
   introduces the migration — even before this setup is opened. Shops still
   missing explicit consent see how many days remain in the WhatsApp settings.
   While that window is
   open, a shop whose upload is not yet confirmed can still send directly
   with the local token. Once the Cloud confirms the current credentials,
   sends go out through the relay `POST /whatsapp/send` and the retained
   local token is only an audited fallback for Cloud 5xx or clear connection
   failures; timeouts are ambiguous and do not fall back, avoiding duplicate
   customer messages. After the deadline direct Meta
   sending ends. Legacy tokens are wiped with an audit event; a token entered
   after the deadline is retained only while its consented Cloud upload is
   pending and is wiped once the Cloud confirms it. The same screen can revoke
   the Cloud credentials: once the Cloud confirms deletion (or that they are
   already gone), the app deletes the local encrypted copy and clears consent;
   reactivation requires re-entering a token and accepting the relay again.
2. Meta test number: only talks to verified numbers (max 5) —
   add them in WhatsApp → API setup → "To"
3. Real shop number (coexistence): requires Meta **business verification**
   and WhatsApp Business on the shop's phone

### Known limits

- Bot reply arrives in ~10–15 s (fast messaging poller); the rest of
  the sync keeps the ~2 min cycle
- Proactive notifications ("it's ready") outside the customer's 24h window
  go out as **templates** — the app submits them automatically to Meta and the
  UI shows the state (approved/in review/rejected + "Resubmit");
  template messages carry a Meta per-conversation cost
- Test number: max 5 verified recipients — enough for demos
- "Shop closed": inbound unconsumed for >5 min gets the Cloud fallback
  reply ("We received your message. The shop will reply when it opens."),
  max 1 per number/12 h

## Inbox + staff AI (`ai-inbox`)

> **In development — not yet available in production** (the app
> running in shops doesn't have the inbox or MCP yet).
> **Pending owner decision:** the commercial name and price aren't
> final — visible texts use the placeholder
> `{{AI_INBOX_NOME}}` / `{{AI_INBOX_PRECO}}` until then. In code only the
> technical identifier `ai-inbox` remains.

Its own module, **contractable alone** (doesn't require `whatsapp-bot`
or `sms`). Two pieces:

- **Unified inbox (app):** all WhatsApp (official + Evolution) and SMS
  messages — including the bot's — in `BusinessMessage`, with
  conversations, filters, assignment and manual reply in the "Messages"
  UI.
- **AI for the team:** a single tool set (`staffInboxTools`) runs **in
  the app**, on the local DB and with the staff member's permissions.
  The "brain" lives on the Cloud (system prompt + schemas + tool loop,
  `ai-inbox` entitlement → 402 without the module) and is served
  through two doors:
  - **in-app chat** — `POST /ai/staff-reply`: the shop picks any
    OpenAI-compatible API; the shop key stays encrypted on the Cloud
    (AES-256-GCM, never returned) or uses the included model with
    usage metering;
  - **MCP on the Cloud** — `cloud.oficinaos.app/mcp` (Streamable HTTP):
    Claude, ChatGPT, Cursor, LM Studio and other clients connect with a
    **personal token per user** (the Cloud stores only the hash).
    Calls reach the app through a permanent connection
    (`/ai-inbox/link`, initiated by the app — no open ports in the
    shop).

Sending always in two steps: the AI creates a draft and a human approves
in the app. Needs a channel that receives messages: Evolution on the LAN
works with this module alone (records in the inbox, no automatic
reply), or `whatsapp-bot`/`sms` for the official channels.

## Time tracking (`ponto`)

> **In beta** — commercial name and price TBD.

Digital time tracking for shop workers, no screen or tablet required: a
**printed QR** (sticker) points to the Cloud's public page
(`/ponto/<qrId>`), which issues a 4-digit code; the worker sends
`ENTRADA <code>` (or PAUSA/VOLTEI/SAIDA/ESTADO) through the shop
number's WhatsApp or SMS and shares their **location** — the time is
always the server's, never the phone's.

- **Proof:** clocking in at the shop requires a valid code + location
  within the configurable radius (default 100 m); pause/exit only ask
  for location. External workers (at customers' homes) register without
  radius and can send a proof photo. SMS only for those the shop marks
  "no WhatsApp" and always stays pending validation.
- **Evaluation on the Cloud:** every clock event (ENTRADA/PAUSA/VOLTEI/SAIDA)
  received through the channels passes `POST /ponto/evaluate` (`ponto`
  entitlement → 402) — a tampered app cannot register time. The ESTADO
  command skips that evaluation: it replies with a local summary of
  hours and records pending validation (the message transport —
  WhatsApp/SMS webhook — still arrives via Cloud). The request carries
  the phone and a photo flag, never the image. Internal corrections
  (exit presumed by the reminder, time declared by the worker) are
  recorded only in the app, no Cloud call. The Cloud **stores no**
  location, photos or records: only single-use `PontoToken`s for ~24 h
  for auditing.
- **In the shop:** `TimeEntry` is append-only (corrections are new rows),
  5-year retention (Labour Code, art. 202); proof photos deleted at 90
  days. The panel (now, validate, hours, missed clock-outs, export PDF)
  is in Ponto in the menu; manager decisions are reversible — the most
  recent validation is the effective one — and reading and export stay
  available even without the module active.
- **Worker information:** Settings → Cloud → Ponto section has the
  editable GDPR text; `/ponto/info` prints the signature sheet and
  `/ponto/qr` the QR sheet. The `qrId` is random and can be regenerated
  in the same section; regenerating immediately invalidates the
  previous sheet, so you need to print and replace it with the new one. See
  `docs/privacy-and-data.md`.

Requires **at least one active Pro receiving channel** (official WhatsApp,
Evolution or SMS) — commands arrive through those transports.

## Pairing with the Cloud

Done once per shop: the Cloud issues a pairing token → the shop pastes it in
the app (Settings → OficinaOS Cloud) → the app validates and stores it
encrypted. Active modules appear in Settings → OficinaOS Cloud → module list.

Granting modules to a shop (operator side, on the cloud):

```
bun run scripts/grant.ts "<shop name>" portal
bun run scripts/grant.ts "<shop name>" whatsapp-bot
```

## Interfaces for AI agents (roadmap)

The portal is already consumable by agents with no extra work:

- `GET /api/portal/<token>` returns clean JSON; the 16-char token in the URL is
  the credential — a customer assistant with browsing can already read the
  repair status from the link
- `POST /api/portal/<token>/reply` accepts `{kind:"quote",decision:"approve"|"reject",quoteId}` —
  rate-limited + anti-bot honeypot
- The `/t/<token>` page declares the JSON via `<link rel="alternate" type="application/json">`
  and `noindex`
- `oficinaos.app/llms.txt` indexes the documentation for LLMs/AI search

**Security rule**: per-repair credentials only (token in the link). Never a
"search by phone/email" endpoint — it would leak the existence of repairs.

**Possible future**: MCP server on the Cloud (`mcp.oficinaos.app`) exposing
`get_status` / `get_quote` / `respond_quote` tools with the portal token as
credential, under the `portal` entitlement — distinct from the `ai-inbox`
`/mcp` (section above), which is for **staff** with the inbox tools.
Build only if beta shops confirm demand — today the WhatsApp bot covers
the same use case in the channel customers actually use.
