# OficinaOS — Repair Shop Management System

Single-location mobile phone repair shop management. Web + Android (Capacitor). Trilingual (PT-PT / EN / FR).

**Fork of [Reparilo](https://github.com/cranknet/reparilo)** (upstream remote: `upstream`) — Portuguese-market adaptation. The upstream license does not cover the "Reparilo" name, so this distribution is branded **OficinaOS**. Never reintroduce "Reparilo" in user-facing strings; referencing the upstream project name in docs/attribution is fine.

# Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## General Rules

- `AGENTS.md` and `GEMINI.md` mirror `CLAUDE.md` (upstream uses symlinks; on Windows they are plain files — keep them in sync when editing this file)
- The project uses ultracite for code quality and formatting. use bun run check or bun run fix to fix any lint warnings.
- For Impeccable detector use bunx impeccable --json "File".
- The project uses Bun for package management and runtime. Use `bun install`, `bun add`, `bun run`, and `bunx` instead of pnpm/npm/npx.
- Add locale keys to `src/i18n/locales/en.json`, then run `bun run sync-locales` to sync/auto-translate, then `python scripts/fix-pt-pt.py` to normalize pt.json to European Portuguese (Google Translate output leans pt-BR).
- Never suppress lint warnings — always apply best practices
- Explain tasks, errors, and solutions in plain English with minimal jargon
- When I bring you an issue, your job is not to fix it directly. Instead, open a brief discussion: ask clarifying questions, explore the problem space, and propose industry best-practice solutions. Always lean toward the approach that reflects current standards, and walk me through the reasoning so we decide together.
- When dealing with Coderabbit CLI it takes long time to review so use longer timeout.
- `shared/errors/AppError` is the SSOT error handler; do not create, invent, or throw custom errors; reuse it.
- `server/plugins/security.ts` is the SSOT for backend security; reuse or improve it when working with APIs.
- When you dispatch "EXPLORE" agent in parallel, make sure to collect all issues found including minor ones; do not rely solely on the "EXPLORE" agent's recommendation.
- Do not create or use Barrel files; apply best practice with explicit imports.

- Create Prisma manual migrations after every schema change
- Use the Postgres URL from `.env` for DB access

## Deployment & LAN/HTTP patches

- Production deployment target: `docker compose up -d` (Postgres 16 + Bun app on port 4000). See `README.md`.
- This fork relaxes upstream's HTTPS-only assumptions for trusted-LAN HTTP use: no `upgrade-insecure-requests` in CSP, no HSTS, non-`Secure` session cookies, `localhost` added to allowed origins. Relevant files: `server/plugins/security.ts`, `server/lib/auth.ts`.
- If you pull from `upstream` (`git pull upstream main`), re-check those files — upstream may reintroduce HTTPS-only headers that blank the page on LAN HTTP.
- The DB credentials inside `docker-compose.yml` (`reparilo` user/db) are internal-only and intentionally unchanged — renaming them would orphan the existing Docker volume.
- Never give users a `raw.githubusercontent.com` link to a `.bat`/`.cmd`/`.ps1` — raw serves the LF blob and `cmd.exe` misparses LF scripts (`'x' is not recognized` cascade). Distribute Windows scripts only inside release zips or as release assets (which preserve CRLF bytes).

## QA & Dev

- After creating a new worktree, run `bun run setup-worktree`
- Use Chrome DevTools for QA — login with `admin` and the configured `SEED_ADMIN_PASSWORD`
- Always collect and flag console errors
- When running tests, build, or lint — always collect output in a single run
- Check existing code for navigation patterns and follow them
