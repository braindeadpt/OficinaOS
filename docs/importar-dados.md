# Importing and exporting data

Settings → **Data**. Only the **OWNER** profile (`settings:edit`) has access to
the `/api/export/*` and `/api/import/*` routes — front desk and technicians get
403, because these operations move personal data in bulk (customer name,
phone, email).

## Supported formats

| Format | Notes |
|---|---|
| `.csv` | UTF-8; if UTF-8 decoding fails, falls back to **Windows-1252** (what Portuguese Excel produces) |
| `.xlsx` | Modern Excel, read by `read-excel-file` |
| `.xls` | **Not supported** — the old Excel binary isn't read; save as `.xlsx` or `.csv` |

## Limits

- File: **10 MB** max.
- Rows: **20,000** per file.
- `.xlsx` is checked before opening: the declared uncompressed size in the ZIP
  cannot exceed **50 MB** (zip-bomb protection).
- The server POST accepts **5 MB** per request; the client automatically sends
  in blocks of **500 rows**.

## Separator and numbers

The separator is **detected once from the header** — `;`, `,` and TAB are
counted outside quotes and the most frequent wins (on tie, `;`). All rows are
split only on that separator, so commas inside a field (quoted or not) don't
break columns when the file is `;`.

Numbers in Portuguese format: comma is the decimal separator and dot is the
thousands separator.

| Written | Imported |
|---|---|
| `12,50` | `12.5` |
| `1.234,56` | `1234.56` |
| `1.000` | `1000` |
| `89.9` | `89.9` |

An empty cell is simply ignored (the field isn't changed). A non-numeric value
**never becomes `0`** — it becomes a row error.

## Per-row errors

Each row is validated individually (`safeParse`): an invalid row doesn't abort
the batch. The summary returns `created`, `updated`, `skipped` and
`errors: [{ row, field, message }]`, where `row` is the sheet row (the first
data row is 2, because 1 is the header). Messages are translated — never raw
Prisma text. On the import screen you can **download a CSV with the errors**
(`row;field;error`).

## Semantics per entity

### Parts and services

- **Case-insensitive** name matching. A name existing more than once in the
  catalog produces a conflict error — one is never updated at random.
- `category` **only changes if the column is in the file**; invalid values are
  row errors.
- Stock changes generate an `ADJUSTMENT` `StockMovement` with the delta
  (`new − old`), inside a per-row transaction — the stock ledger keeps the
  who/when/why trail.

### Jobs — historical import

- The customer is found by **normalized phone** (`normalizePhone` +
  `findByNormalizedPhone`, same as `customers.service.create`); if missing,
  created.
- The brand is looked up case-insensitive; if missing, created.
- `jobCode` and `ref`/`externalRef` serve to **deduplicate reimports**: a row
  whose reference already exists counts as `skipped`, never duplicated.
- `status`, `createdAt` and `deliveredAt` are optional. Historical import
  assumes `DELIVERED` by default. Dates accept ISO (`2025-12-01`,
  `2025-12-01T10:30:00Z`) and PT format (`01/12/2025`).
- Each imported job records `JOB_CREATED` in the audit log (and
  `STATUS_CHANGED → DELIVERED` stamped at `deliveredAt` when applicable, so
  the export shows the delivery date again).

## Export

- CSV `;`, UTF-8 with BOM; for Excel an `.xlsx` is generated client-side with
  numeric columns as real `Number`.
- **Formula-injection protection**: cells starting with `=`, `+`, `-`, `@`,
  TAB or CR are prefixed with `'` — the public pre-check stores third-party
  text in the DB, and that must not become formulas when opened in Excel.
- Export is **paginated** (blocks of 1000) instead of reading 50,000 rows at
  once.

## Auditing

Each operation records `DATA_EXPORTED` / `DATA_IMPORTED` in the audit log with
only `{ entity, rows }` — no names, phones, emails or row content
(the #81 denylist).
