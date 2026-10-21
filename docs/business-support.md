# Support tickets, shared parties and commercial management

This extension adds `/tickets`, `/messages` and `/agreements` to the workshop fork. It reuses existing customers, suppliers, tasks, automatic task rules and internal workflow states. It does not enable a cloud module or change the public customer portal.

## Available functionality

- Support tickets have a unique sequential number, a free-text support area (for example websites or platforms), description, priority, existing customer/supplier references, editing, tasks and internal states. Rules triggered by ticket states use the same scheduler and completion chains as other modules.
- Administrators can associate an existing supplier with an existing customer from the supplier detail page. The original IDs, records and histories remain intact. Each role has its existing contact record; contact fields are not silently overwritten or continuously synchronised. One customer can correspond to one supplier. Remove the association to separate their combined history again.
- Tickets, orders, messages and agreements reuse the existing customer and supplier directories. Customer and supplier history links include both roles of a linked entity. Message history also includes messages linked to that customer's repairs, orders and tickets, even when the message itself has no direct customer reference.
- The message area records existing messages or drafts for email, Facebook, Instagram, Messenger, WhatsApp, SMS and internal notes. A message can be linked to multiple repairs, orders, tickets, customers, suppliers or commercial agreements. Messages can have tasks and state-triggered rules. Links can be removed without deleting the original message.
- Product and parts orders record the supplier, purchase website/link, inventory part, repair, customer, total purchase cost and customer quote. Purchase and sales VAT rates are separate and input VAT deductibility is configurable. Cost and quote are totals including VAT; include delivery and other acquisition costs in the purchase total. Parts orders do not automatically receive stock, pay a supplier or issue an invoice.
- Commissions, licences, retainers and other agreements record parties, period, amount, VAT, paid amount, status, references, notes and start/renewal/end dates. Commission amounts are recalculated server-side from the net commission basis and percentage, then VAT is added. These are tracking records; they do not automatically invoice or charge anyone, renew third-party subscriptions or generate renewals. References are not a secret storage vault: do not store licence activation secrets here.
- List-wide status management panels are removed. Repair internal-state selection/management is next to the existing repair status selector. Other modules retain state management inside their record's tasks/status area. Internal states supplement the native repair lifecycle; they do not bypass QC, delivery, stock, warranty or public tracking transitions.

## Messages: connection boundary

**This version is a manual message register and draft manager. Saving never sends a message.** No account has been connected to the unified message register. Existing independent WhatsApp/SMS notification features keep their existing behaviour and are not automatically imported into it.

Automatic reception, historical import and sending for external channels remain a separate integration step, requiring the relevant accounts, OAuth/API access, webhook configuration and provider permissions. The UI explicitly shows this limitation and the API accepts only `CAPTURED` or `DRAFT`, never a fabricated `SENT` delivery confirmation. No customer communication is sent when testing this module.

## Access and financial calculation

Tickets use `jobs.view/edit`; order visibility uses `parts.viewCatalog`, while financial fields additionally require `parts.viewCost` and writes require `parts.manageCatalog` plus `parts.viewCost`. Unified messages, commercial agreements and linking party identities currently require `settings.edit` (administrator). Generic task and workflow endpoints apply the same module permissions. None of these administrative records is published to customer tracking pages.

EUR money is calculated using integer cents. Tax-exclusive amounts round to the nearest cent. The margin shown is:

```
net revenue = customer quote including VAT / (1 + sales VAT rate)
cost = deductible-VAT purchase net cost, otherwise purchase gross cost
profit after VAT = net revenue - cost
margin percentage = profit after VAT / net revenue * 100
```

A zero net quote has no margin percentage. Purchase VAT and sales VAT can differ. The displayed VAT balance is output VAT less deductible input VAT. **This is margin after VAT, not profit after all taxes**: income taxes, overheads and costs not included in the purchase total are excluded. VAT rates default to zero and must be set to the shop's applicable treatment; no tax rate or deductibility is inferred.

## Migration and testing

`20261108000000_business_support` adds the new tables, optional party/order relationships and order amounts with zero defaults. It preserves old orders, existing IDs and all prior tasks. User FKs protect message/ticket authorship, party identity is unique, message links cascade on message deletion, and database checks guard financial ranges and capture statuses.

Validation covers VAT arithmetic (including non-deductible VAT, losses and rounding), server-side commissions, permissions, absent link targets, shared histories, title-only edits preserving old costs, ticket/message form submissions and identity linking. All 81 migrations were also applied to a temporary PGlite PostgreSQL instance, with a legacy order inserted before this migration; preservation, new record insertion, uniqueness, FKs and checks were verified. This supplements route tests and does not replace validation on the shop's PostgreSQL 16 backup before production use.

The new strings are provided in English and European Portuguese. The new French/Spanish keys currently use English fallback text.

## Update the separate test installation

Run on the Ubuntu server, in the existing test directory. Back up before rebuilding because startup applies migrations:

```sh
cd ~/OficinaOS-teste
sudo docker compose -p oficinaos-teste -f compose.test.yaml exec -T db-backup bash /scripts/run-backup.sh
git pull --ff-only origin inove/workshop-workflow
sudo docker compose -p oficinaos-teste -f compose.test.yaml up -d --no-deps --build app
sudo docker compose -p oficinaos-teste -f compose.test.yaml logs --tail=60 app
curl -sS http://127.0.0.1:4001/health
```

Do not seed or reset the database during an update. Keep the Node-compatible Dockerfile and existing test compose configuration. Test the new sections on port 4001 before considering a production update on port 4000.
