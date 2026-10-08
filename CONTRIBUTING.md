# Contributing to OficinaOS

OficinaOS is a Portuguese-market fork of [Reparilo](https://github.com/cranknet/reparilo), maintained by [@braindeadpt](https://github.com/braindeadpt). Contributions are welcome — please read this short guide first.

## Before you start

**Open an issue first** for anything bigger than a typo or a one-line bug fix. Aligning on scope up front is better than rejecting a finished PR.

OficinaOS is intentionally a **single-tenant, single-location** repair-shop tool. Features that push it toward multi-tenant SaaS or generic ERP territory will likely be declined. The Portuguese (pt-PT) locale is a first-class citizen — user-facing changes must not degrade it.

## Prerequisites

- [Bun](https://bun.sh) `1.3.13` (pinned in `package.json`)
- PostgreSQL (locally or via Docker)
- Or, for the full deployment: Docker Desktop (`docker compose up -d`)
- For Android work: Android Studio + JDK 17+

## Setup

```bash
git clone https://github.com/braindeadpt/OficinaOS.git
cd OficinaOS
bun install

cp .env.example .env
# Fill in DATABASE_URL, BETTER_AUTH_SECRET, AI_ENCRYPTION_KEY, and SEED_ADMIN_PASSWORD
# (dev only — or leave it unset and create the owner on the /setup screen).
# Generate secrets with:
#   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

bun run db:migrate
bun run db:seed
bun run dev
```

If you work in a git worktree, run `bun run setup-worktree` once after creating it.

### Running the tests on a fresh clone

The unit tests don't need a running database (`vitest.setup.ts` fills in
placeholder env vars), but they import the generated Prisma client, which is
not committed. Generate it once before the first run:

```bash
bun install
bun run test:setup   # prisma generate (uses a placeholder DATABASE_URL if .env is missing)
bun run test
```

Re-run `bun run test:setup` whenever `prisma/schema.prisma` changes.

## Development workflow

```bash
bun run dev          # frontend (vite) + server (fastify) with hot reload
bun run test         # vitest
bun run check        # ultracite lint
bun run fix          # auto-fix lint
bun run db:studio    # Prisma Studio
```

### Before every commit

1. `bun run check` passes (zero warnings — we don't suppress lints).
2. `bun run test` passes.
3. No new TypeScript errors.
4. Your changes are scoped to one concern. Don't refactor adjacent code unless your change needs it.

A `husky` pre-commit hook runs these for you, but please run them locally before pushing — failed CI is slow feedback.

## Project conventions

These are documented more fully in `CLAUDE.md` at the repo root. Highlights:

- **Errors:** `shared/errors/AppError` is the single source of truth. Don't introduce custom error classes — extend or reuse `AppError`.
- **Security:** `server/plugins/security.ts` is the SSOT for backend security headers, CSRF, rate limiting, etc. Improve it rather than working around it. Note: this fork ships relaxed headers/cookies for trusted-LAN HTTP deployment — see `CLAUDE.md` before "fixing" them.
- **No barrel files.** Use explicit imports.
- **No suppressed lints.** Fix the underlying issue.
- **i18n:** Add new strings to `src/i18n/locales/en.json`. Then run `bun run sync-locales` to sync and auto-translate the other locales, followed by `python scripts/fix-pt-pt.py` to normalize `pt.json` into European Portuguese (auto-translation leans Brazilian). Hard-coded user-facing strings will be rejected.
- **Branding:** The product name is **OficinaOS**. Do not reintroduce "Reparilo" in user-facing strings — the upstream license does not cover the name.
- **Database changes:** Every schema change needs a Prisma migration generated via `bun run db:migrate`. Don't ship schema edits without the migration file.

## Commits and PRs

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(returns): add partial-refund resolution flow
fix(auth): clear session cookie on logout error
docs(readme): correct Docker prerequisites
chore(deps): bump prisma to 7.7.1
test(jobs): cover overdue-alert edge case
```

Type prefixes we use: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`, `style`.

### Pull requests

- One concern per PR. Smaller PRs get reviewed and merged faster.
- Reference the issue it closes: `Closes #123`.
- Include screenshots or short clips for any UI change. Test in all three locales (PT, EN, FR) if your change touches text or layout.
- For database changes, include the generated migration file and call out any data backfill needed.
- Don't bump unrelated dependencies in the same PR.

### When we'll likely say no

- Multi-tenant or SaaS-shaped features.
- Adding heavyweight dependencies for small wins.
- Refactors with no behavior change and no clear payoff.
- Changes that only serve a specific deployment that isn't the reference one.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be respectful. Reports go to the address in that file.

## Security

If you've found a security issue, **do not open a public issue or PR**. See [SECURITY.md](./SECURITY.md) for private reporting channels.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
