# Privacy and data (GDPR)

A plain-language guide to where data lives when you use OficinaOS — written
for shop owners and whoever handles GDPR compliance.

## The golden rule

**OficinaOS runs on your shop's computer.** Customers, repairs,
stock, the till and photos stay on that computer by default — the core
sends nothing to our servers.

In practice, for GDPR this means:

- The shop is the **data controller** (as it always was, even with pen
  and paper)
- **With no Pro modules enabled, we are not a processor** — there is no
  cloud, no account of ours and no telemetry, and no processing
  agreement (Art. 28) with us is needed
- **If you pair OficinaOS Cloud** (Pro modules like the portal or the
  WhatsApp bot), we become a processor *only* for those flows — the
  table below says exactly what transits. The shop's full data stays on
  your PC.

This doesn't exempt you from the normal obligations (recording processing,
protecting access, answering customer requests), but it simplifies them
considerably: the processing happens almost entirely inside your shop, on
your equipment.

## What can leave the shop — only if you enable it

Some optional features talk to external services. Each one is your choice
and can stay off. This table is meant for your record of processing
activities (Art. 30):

| Feature | Who receives | What leaves | How to turn off |
|---|---|---|---|
| Remote access (Cloudflare Tunnel) | Cloudflare, Inc. (US, with EU clauses) | The traffic passing through the tunnel: pages and data consulted by whoever uses remote access or the public links | Don't enable the `tunnel` profile |
| Public customer links (tracking, quotes, receipts, pre-check) | Cloudflare, Inc. | The data shown on those public pages | Without a tunnel, the links only work inside the shop |
| WhatsApp notifications and bot | OficinaOS Cloud (relay) → Meta (WhatsApp Business) | The customer's phone number and the message text transit through our Cloud to reach Meta — **the Cloud neither stores nor logs the content** (logs carry only id, state and masked phone). With your explicit authorization, the Cloud stores your Meta token encrypted so it can send on your behalf; see the credential lifecycle below | Settings → WhatsApp → disable; **Revoke cloud credentials** deletes the Cloud and local copies and withdraws that authorization; unpairing the Cloud also deletes the stored token |
| Customer bot (rules + AI, SMS/WhatsApp) | OficinaOS Cloud → configured LLM provider | See the exact list in ["Customer bot (`/ai/bot-reply`)"](#customer-bot-aibot-reply) below. In short: the necessary message/conversation, the shop card and the `vistaCliente` projection of the number's active repairs — no internal customer/repair ids, no raw states, no IMEI, `holdReason`, suppliers or all names matched to the number. The Cloud **does not log content** — only usage counters (`AiBotUsage`) and the temporary queues with current retention. The Cloud never reads the shop's database | Disable the channel module or unpair the Cloud |
| Inbox + staff AI (`ai-inbox`) | OficinaOS Cloud → LLM provider the shop chooses | When a staff member uses the AI or an MCP client: the inbox tool results (`staffInboxTools` – conversations, customer summaries, drafts) pass through the Cloud **in transit** on the app→Cloud connection and are never stored or logged. Each user's **personal MCP token** is stored on the Cloud only as a **hash**; the shop's **AI key** is encrypted (AES-256-GCM) and never returned to the app. With a local model via MCP (LM Studio/Open WebUI), the model is local but the data still passes through the Cloud in transit. The Cloud never reads the shop's database | Settings → AI: disable or revoke each user's MCP token |
| SMS via Cloud (Pro) | OficinaOS Cloud → SMS Gateway (Android device) | Phone and text transit through the Cloud to the sending device; `SmsRoute` stores only the phone→shop mapping to route replies | Settings → SMS → the LAN fallback keeps working |
| Customer portal / online storefront | OficinaOS Cloud | Redacted snapshot of the repair or of the products you publish (no internal costs or private notes) | Remove the public link / unpublish the storefront |
| AI analyst | The provider you configure (e.g. OpenAI) | The content of the questions you ask the AI | Settings → AI → disable (off by default) |
| Google reviews | Google | Only the review link — no customer data leaves, the customer opens their own page | Settings → Reviews → disable |
| Time tracking (`ponto`, Pro) | OficinaOS Cloud → Pro channels (WhatsApp/SMS) | The commands and the **location only at clock-in time** (never tracking) transit through the channels to the app; proof photos travel as the channel's own media. The evaluation request to the Cloud (`POST /ponto/evaluate`) carries the phone, the location and a photo-exists flag — **never the image**. The Cloud **stores no** records — only `PontoToken` 24 h for auditing | Don't activate the `ponto` module; without it nothing is collected |

## WhatsApp Meta credentials — lifecycle

- You can save the Meta token in the app without sending it anywhere: it is
  encrypted locally and the settings API never returns its value — the token
  itself is represented only by a presence flag, while non-secret IDs and
  migration state may still be shown.
- The token leaves the shop only after someone with settings permission ticks
  the explicit consent for encrypted storage in OficinaOS Cloud and sending
  through the Cloud relay. The app records that consent once; the Cloud
  validates the token + phone number ID against Meta before replacing the
  stored credential.
- On the Cloud the token is stored with AES-256-GCM. The key material comes
  from the server `SECRETS_KEY` environment variable — it is not stored in the
  database — and no endpoint returns the token to the app.
- Sending then goes through the Cloud relay. The shared 30-day migration
  window starts on the first boot of the app version that introduces the
  migration, even before WhatsApp setup is opened. During that window a shop
  whose upload is not yet confirmed can still send directly with its encrypted
  local token; once the Cloud has the current credentials, direct app→Meta is
  only an audited fallback when the relay returns a temporary server error or
  clearly cannot be reached. After the deadline, direct app→Meta sending ends.
- **Revoke cloud credentials** asks the Cloud to delete its copy first. When
  deletion is confirmed (or the copy is already gone), the app deletes the
  local encrypted copy and clears the consent. Using official WhatsApp again
  requires re-entering a token and explicitly accepting the relay again.
  Shops migrated before this consent step existed must make that choice when
  the transition ends.

## Customer bot (`/ai/bot-reply`)

The bot's automatic replies — first the rules (status, REP code,
YES/NO to a quote) and only then AI — are composed on the Cloud. The app
sends, in the **first round** of each message:

- `channel` (`sms`, `whatsapp` or `evolution`) in every round, and —
  only in the first — `messageType` and `messageCreatedAt` of the
  received message;
- the customer's current message; with the inbox active, up to 6
  previous messages **of that conversation**; in later rounds the same
  conversation goes again, plus the results of the tools executed
  locally in that interaction (the Cloud is stateless) and the
  `continuationToken` — only when the Cloud issued it in the counted
  round: an opaque HMAC valid for 2 minutes, which proves to tool
  rounds that the message already counted towards the account's
  conversation quota (it contains no customer or conversation data);
- `shopLabel` and `shopCard` (the public "what the bot can say" text and
  the average repair days after the part arrives), `currency`,
  `timezone`, `aiEnabled` and `allowQuoteDecision`;
- `customerFirstName` — only the first name of the customer matched by
  the number, needed for greetings. The list of customers sharing that
  number never goes;
- `jobs`: that number's active repairs projected by `vistaCliente`:
  `aparelho`, `codigo`, `dataPrevista`, `diasAtraso`, `emPausa`,
  `emprestimo`, human-readable `estado`, `garantia`, `linkPortal`,
  `notasVisiveis`, `pecasEmEspera` (`nome`, `chegadaPrevista`),
  `reparacaoExterna.regressoPrevisto`, `valores` (`estimado`, `sinal`,
  `pago`, `emFalta`) and `orcamento` (`valor`, human-readable `estado`,
  `nota`, `enviadoEm`, `validade`, `versao` — plus the internal quote `id`
  when the quote is pending and the interaction can decide it).

## Time tracking (`ponto`) in detail

**Stays in the shop (server PC):**

- `TimeEntry` — each record (type, server time, transport, state,
  proofs) is **append-only**: the app blocks UPDATE/DELETE and a
  correction is always a new row (`correctsId`). **5-year** retention
  (Labour Code, art. 202 — legal retention, not profiling).
- External workers' proof photos: **never downloaded or stored** by the
  app. The record keeps only the temporal proof (`hasPhoto` /
  `photoSentAt`); the image stays in the company phone's WhatsApp/SMS.

**Leaves the shop (only with the module active and a Pro receiving
channel):**

- The worker's message — text and **location at clock-in time, only
  when no other proof of presence exists** — reaches the app through the
  active channel: on the Evolution channel the webhook delivers directly
  to the app, **without passing through OficinaOS Cloud** (on the Cloud
  relay the message transits through it; on official WhatsApp it arrives
  via Meta's webhook). The trip to the Cloud is a separate step and only
  happens on clock events (ENTRADA, PAUSA, VOLTEI, SAIDA): the app calls
  `POST /ponto/evaluate`, which validates code, radius and precision —
  the request carries the phone and a photo-exists flag, **never the
  image** (the photo travels as the channel's own media). **Location is
  minimised by design** (`proofs.kind`): when the command carries a code
  the app first evaluates **without coordinates** (`probe`); a scan of
  the rotating screen QR on the shop Wi-Fi proves presence and is
  approved as `screen_wifi` — location is never asked. Location is only
  requested when the Cloud answers `needLocation`: printed QR, a
  handwritten code (no scan → no network proof), a scan off the shop
  Wi-Fi, an expired code (then normal location rules apply — it can
  approve inside the radius), or no code at all. An invalid or
  already-used code also asks for location but the record always stays
  POR_VALIDAR for a person to decide (`manual` proof). An approval on
  current location inside the radius is `location`; external work with
  location + photo (image never stored) is `external_photo`. The
  classification appears in the ACT export (PDF/Excel) in all four
  languages; older records without `kind` show «—». The
  `pontoAlwaysAskLocation` setting — off by default — forces the
  location request even with a valid scan and **requires justification
  in the impact assessment (DPIA)**. **Telework** (DPIA risk R3):
  workers can have telework days of the week set in their team record;
  on those days the clock-in **never asks for location** — asking for it
  at home would reveal the worker's address. The record is `remote`
  («Telework — no proof of location» in the ACT export) and follows the
  validation rule the shop chooses: auto-approve or pending validation
  (the default). This stripping applies to the **evaluation** the app
  makes: even when a location request was started on an on-site day, the
  coordinates are never sent to `POST /ponto/evaluate` nor stored in the
  record if the answer lands on a telework day. The **reception** of the
  reply is a separate, earlier step that follows the channel's own
  rules: on the official WhatsApp relay the message (with the shared
  location) transits the Cloud inbox queue like any other reply — it is
  not retained as proof nor linked to the time record. ESTADO is a local records query and **makes no
  request to the Cloud** — but the **reply** (the records summary)
  leaves through the active channel and, if that channel is the
  WhatsApp Cloud relay or Cloud SMS, **transits through OficinaOS
  Cloud** like any sent message. The Cloud **stores no** location,
  photos or records — only the 4-digit `PontoToken`s for ~24 h, for
  single-use auditing.
- Corrections recorded by the app itself — the exit presumed by the
  exit reminder and the exit time declared by the worker replying to
  that reminder — stay **only in the shop**: they don't pass through
  the Cloud evaluation.
- Bot replies and reminders follow the active Pro channel (official
  WhatsApp, Evolution or SMS).

**Worker rights** (written information is mandatory — the module
generates the printable `/ponto/info` sheet with the
`ShopSettings.pontoInfoText` text or the base GDPR template):

- they are informed in writing about the processing;
- they can consult their time records;
- the processing uses neither biometrics nor continuous location;
- as it processes location, the shop should perform (or review) a
  **data protection impact assessment (DPIA)** — internal
  recommendation, not a guarantee.

This **is not a promise of "guaranteed compliance"**: the module supports
the Labour Code obligation, but responsibility for the processing always
lies with the shop.

## Technical calls (always active, no customer data)

There are two internet connections the app makes by itself, with no
personal data — listed here for full transparency:

| Call | Where it goes | What leaves | Note |
|---|---|---|---|
| New-version check | GitHub | The shop PC's IP when querying the latest version | Only serves to warn there's an update |
| Report a problem | GitHub | The text you write in the report + current page/version | Only when you click "Report" — never automatic |

Even the interface fonts (typeface and icons) are embedded in the app —
the page opens without talking to Google or any CDN, and works the same
with the internet down.

## What never leaves

Regardless of enabled options:

- The full database, repair photos, financial reports — stay on the
  shop PC's disk
- Staff passwords and sessions
- Documents and attachments stored in the app

## Practical recommendations for the shop

1. **The server PC is the vault.** Enable the Windows password, keep
   the PC updated, and use the built-in backup (Settings → Backups).
2. **Individual accounts.** Each staff member with their own account —
   don't share passwords. The profiles (owner, technician, front desk)
   already limit what each one sees.
3. **WhatsApp consent.** The app only sends WhatsApp to customers who
   gave consent — keep that consent on the customer record.
4. **Customer requests (GDPR).** If a customer asks for their data or
   erasure, you can export/edit on the customer record. Talk to your
   accountant or GDPR consultant for the formal procedure.
5. **If you enable remote access**, list Cloudflare as a processor in
   your record (the table above has what you need).
6. **If you use Pro modules** (paired Cloud), also list OficinaOS as a
   processor for those flows — the portal, the WhatsApp relay and the
   storefront process data on your behalf.

## Technical note

This document describes the behavior of the code as it is in the
repository — you can verify it yourself: there are no "hidden" network
calls in the app; every external connection matches a feature in the
table. For security details (headers, cookies, rate limits) see
`server/plugins/security.ts`.
