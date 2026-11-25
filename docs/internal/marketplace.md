# B2B Marketplace — OficinaOS (roadmap, post-beta)

> **Status**: approved design, **not implemented**. Priority: after the
> first real beta shops — a marketplace without liquidity is worthless.
> Validate demand with the beta shops (or a WhatsApp group moderated by
> the operator) before writing code.

## What it is

A **professionals-only** classifieds platform: repair shops and technical
centers list and buy from each other:

- Pulled / used OEM parts (screens, batteries, boards)
- Used phones and trade-ins
- New equipment and surplus stock
- Lots ("lot of 20 batteries", "mixed screens lot")

## Business model — classifieds + contact (decision made)

The listing shows the selling shop's contact; **the deal closes outside the
platform** (bank transfer between companies, CTT shipping, pickup).
The platform **never touches money**:

- No escrow, no PSP, no payment disputes — zero regulatory burden
- Revenue = Pro subscription, not per-transaction fees
- Model advantage: since the shop already paid for the module, there's no
  incentive to "leave the platform" to avoid commissions — the opposite of
  commission marketplaces

**Never implement payments/escrow inside the platform** without an explicit
decision — that's another business (fintech), not a module.

## The differentiator: verified diagnostics

What sets this apart from a WhatsApp group: the **OficinaDiag report
attached to the listing** is the condition certificate.

Flow: scan in diag → "List on marketplace" → listing draft on the
cloud → technician sets price + photos → listing published with a
"verified by OficinaDiag" badge showing:

- Real battery health (%, cycles)
- Functional checklist (powers on, screen, touch, cameras, audio)
- Confirmed model (name resolution, not the codename)

### Privacy rule — MANDATORY

The `DeviceReport` contains **serial/IMEI — it never goes in the public
listing** (fraud and cloning vector). The listing shows only: model,
battery health, checklist, OS. The serial is validated between the two
shops when closing the deal. Ideal: report stored on the cloud referenced
by hash, so the buyer knows it wasn't tampered with.

## Why it fits the architecture

It's a normal Pro module — zero new complexity:

- Needs shop↔shop reach → lives in the **Cloud** (private repo), not the app
- Sellers are **verified** shops (account + pairing already exist)
- `market` (or `b2b`) entitlement — the cloud admin already grants/revokes
- App: entitlement-gated page, like the portal today

## Phases

### Phase 0 — validation (before any code)

With 3–5 beta shops: ask directly whether they trade with each other, what
and how. Optional: WhatsApp group moderated by the operator to prove demand.

### Phase 1 — "classifieds" MVP (~1 week, all on existing infra)

- **Cloud**: `MarketListing` (type: `part | used-device | new-device | lot`,
  title, condition, price, qty, photos, region, `shipsByMail`), CRUD +
  search, `requireModule("market")`; admin: remove listing, suspend shop
- **App**: Marketplace page — search + create listing from a stock part
  or device ("list this part")
- **Diag**: "List" button after scan → draft with report attached
- Contact = reveal the selling shop's phone/WhatsApp/email

### Phase 2

- Structured offers: buyer proposes price → seller accepts → contact exchange
- Saved-search alerts ("tell me when an iPhone 12 OEM screen appears")
- Hash-verified diag report

### Phase 3 — probably never

Payments/escrow. Only with a partner like Stripe Connect and if volume
justifies it. Default: **don't do it**.

## Pricing nuance

Gating everything behind Pro kills liquidity at launch. Option to evaluate
then: **viewing/listing free, posting requires Pro** — any shop enters and
sees value, but only Pro shops sell. Decided when it's built, with beta data.
