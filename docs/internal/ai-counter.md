# AI Counter — WhatsApp with quotes and scheduling (roadmap)

> **Status**: recorded idea, **not approved nor implemented**.
> Condition to move forward: traction in the free core + proven Pro
> interest in beta shops. Without free users there's no funnel to Pro.

## What it is

Evolution of the `whatsapp-bot` module from "answers the status" to an
**automatic service counter** on the shop's WhatsApp:

- Answering "is it ready yet?" — **already exists** (deterministic intents)
- Estimated quote by model + fault ("how much is an iPhone 13 screen?")
  — new
- Booking drop-offs/pickups — new (no scheduling concept exists)
- Proactive repair status — partial (outbox exists; WhatsApp outside
  the 24h window requires approved Meta templates — blocked on
  Business Verification)
- Charging: €/shop/month (normal Pro model — but real billing is a
  separate project; today grants are manual)

## What remains to build (honest gaps)

1. **Source of truth for estimates** — `RepairCatalog` has price per
   repair type, not per model. Options: model×repair matrix in the
   shop → fallback range from `market-prices` → always with the
   "estimate, final price after diagnosis" disclaimer. The LLM never
   invents prices.
2. **Scheduling** — new schema (Booking/Appointment) + UI + bot flow.
   It's the biggest piece.
3. **LLM layer** — today the bot is deterministic (keywords). Proposal:
   **hybrid** — known intents reply as today (fast, free, zero risk);
   unrecognized free text → LLM with read tools (job status, catalog)
   and strict instruction to never invent values; human handoff remains.
4. **Privacy** — customer text would pass through a third-party LLM
   (cloud calls, like `ai-reports`); document in the module's privacy doc.
5. **Meta templates** — proactive notifications need approved templates
   (pending Business Verification). SMS already does proactive.

## Pending decisions (when built)

- New module (`ai-counter`) or evolution of `whatsapp-bot`? Affects
  entitlements and price.
- "AI Counter" is a good marketing name — but keep the module ID neutral.
- Real billing: Stripe, invoices via InvoiceXpress (already integrated)
  or direct debit? Separate project, outside the bot's scope.

## Suggested phase (if/when there's traction)

1. New deterministic intents in the current bot: estimate via catalog +
   benchmark, price replies to non-customers — testable with beta shops
   as soon as they activate.
2. LLM fallback (cloud-side, `ai-reports` pattern).
3. Drop-off scheduling.
