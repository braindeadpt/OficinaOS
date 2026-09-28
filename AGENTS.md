# Agent Instructions — OficinaOS

> This file mirrors [`CLAUDE.md`](./CLAUDE.md) (upstream used symlinks; on Windows this is a plain file). Read `CLAUDE.md` for the full guidelines — the summary below covers the rules agents most often break.

## Critical rules

- **Package/runtime:** Bun only — `bun install`, `bun add`, `bun run`, `bunx`. Never npm/pnpm/npx.
- **Lint:** `bun run check` / `bun run fix` (ultracite). Zero warnings, never suppress.
- **i18n:** new strings go in `src/i18n/locales/en.json` → `bun run sync-locales` → `python scripts/fix-pt-pt.py` (normalizes to pt-PT).
- **Errors:** `shared/errors/AppError` is the single source of truth — reuse it, don't invent error classes.
- **Security:** `server/plugins/security.ts` is the SSOT. This fork intentionally relaxes headers/cookies for trusted-LAN HTTP — see `CLAUDE.md` before "fixing".
- **Branding:** product name is **OficinaOS** (fork of Reparilo — the name isn't MIT-licensed, never reintroduce it in user-facing strings).
- **DB:** Prisma manual migration after every schema change; Postgres URL comes from `.env`.
- **No barrel files** — explicit imports only.
- **Deploy:** `docker compose up -d` (Postgres + app on :4000).
- **Login for QA:** username `admin` + `SEED_ADMIN_PASSWORD` from `.env`.
