# Tasks and RMA workflow

The tickets, messages, shared-parties and commercial-management extension is described in [business-support.md](business-support.md) (English).

## Implemented

- Tasks on the owner, technician and front-desk dashboards, integrated into repair sheets.
- Tasks linked to repairs, RMAs, intake requests, returns, orders, trade-ins, suppliers or customers.
- New **Orders** area: description, supplier, reference and notes; creation and editing, tasks and follow-up status.
- Per-module follow-up statuses: the administrator can create, rename, deactivate and reactivate statuses.
- Follow-up statuses complement the original operational statuses — they don't replace the transitions that move stock or payments.
- Automatic rules for follow-up statuses of any module, beyond the existing per-repair-status rules.
- One rule creates one task per record, even if it returns to the same status. Reassigning or restarting doesn't duplicate tasks.
- The dashboard respects each module's permissions and the individual scope of returns.
- AI: OpenAI, Google Gemini and Mistral AI presets, with editable model and a compatible-service option.
- Assignee (active technician or owner), priority, notes, scheduled start and deadline.
- Completing a task creates the indicated next task, immediately or after a number of hours — transactionally (double-clicks don't duplicate).
- Rules per repair status, managed only by those with settings-edit permission.
- Rules are checked every 30 seconds and at boot.
- New photos classified as Intake, Repair or Completion.
- RMAs linked to a repair by number, with navigation links both ways.
- Active owners available in technician selection, keeping owner permissions.

## Example

In **Tasks**, create a rule for **Waiting for parts** titled **Order part** with next task **Wait for part arrival**.

The next task is scheduled for completion time plus the delay. It is not a confirmation of order or real arrival.

Pending tasks can be edited in the table: title, assignee, priority, notes, dates and next-task configuration.

## Installation and validation

The added Prisma migration must be applied before starting the app.
Before installing in a shop: back up database, uploads and `.env`; validate the migration on a database copy.

Tasks and their notes are internal. They are not returned in the public repair-tracking endpoints.

## Remaining requested scope — not yet implemented

1. Documents uploaded once and linked to several repairs, tasks, parts, invoices and RMAs.
2. Complete per-supplier history with receptions, parts, costs, invoices, credit notes, payments and warranties.
3. Diagnostic documents PC/Mobile with Before/After phase and controlled sharing in customer tracking.
4. Photos: captions, phase change after upload, grouping by phase and customer visibility verified server-side.
5. Internal calendar and public bookings, Google Calendar sync, conflict management, cancellations.
6. Replacement of native operational statuses with a fully configurable flow.
7. Importer improvements: column mapping, preview, source references, dates/statuses/values, idempotency, XLS.
8. Brother DK-22205 label: device, customer, contact and intake, besides reference/QR.

This list distinguishes requirements from already-existing features. Integrations and remaining modules must not be advertised as complete.
