# Access recovery (forgotten password)

Since v1.0.22 no user gets locked out of OficinaOS. There are three
paths, in order of preference:

## 1. Email — when the shop has SMTP configured

"Forgot password" on the login sends a link to the account email. The
link opens `/reset-password?token=…` **on the origin where the request
was made** (localhost, LAN IP or `http://<hostname>.local:<port>` when
the installer configured mDNS) — so it works away from the server PC
and survives IP changes. The token is single-use and expires after 1
hour; all the user's sessions are terminated after the reset.

Without SMTP (`SMTP_HOST/PORT/USER/PASS` missing in `.env`) the login
shows an honest panel instead of pretending it sent an email, and the
API answers `503 EMAIL_NOT_CONFIGURED`.

## 2. Reset by an administrator — for staff

Settings → Users → **Reset password** (key icon on the user's row). The
administrator sets a temporary password; after the reset the modal
shows it with a **Copy** button. `mustChangePassword` forces changing it
at first login and old sessions are terminated. Audited as
`PASSWORD_RESET`.

## 3. Local recovery — for the owner/admin who locked themselves out

No HTTP route: physical access to the server is the proof of authorization.

| Installation | How |
|---|---|
| Windows (service) | OficinaOS tray icon → **"Recover access…"** → UAC → pick the account → the temporary password appears once with "Copy" |
| Portable | `RECUPERAR-ACESSO.bat` in the portable folder (asks for admin, lists accounts, asks for the username) |
| Docker/Linux | `docker compose exec app bun run recover-access -- --user <username>` |
| Dev | `bun run recover-access` (list) / `-- --user <username>` |

The script (`server/scripts/recover-access.ts`):

- with no arguments lists OWNER accounts (inactive ones come marked);
- `--user <username>` generates a random 18-character temporary
  password without ambiguous glyphs (0/O, 1/l/I), stores the hash,
  enables `mustChangePassword`, terminates sessions, clears the
  failed-attempts lockout (`failedLoginAttempts`/`lockedUntil` —
  otherwise the temporary one would be refused during the rest of the
  lockout) and audits `PASSWORD_RESET` with `toValue` "Local recovery
  (server)";
- prints the password **only once** on stdout — never to files or logs;
- inactive accounts are refused; `--reactivate` reactivates (audited in
  `metadata.reactivated`);
- disabled in `DEMO_MODE`, like the other management actions.

## Note on backups

The daily backup is a full `pg_dump` — restoring brings back the
**same** forgotten password. Backup protects against data loss, not
against lockout; that's what local recovery is for.
