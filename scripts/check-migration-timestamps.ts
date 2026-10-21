/**
 * Fails when a PR adds a migration directory whose timestamp prefix is
 * already taken — on main or by another new directory. Legacy duplicate
 * pairs that predate this check are exempt (we never rename migrations).
 *
 * Usage: bun scripts/check-migration-timestamps.ts [base-ref]
 * Default base-ref is origin/main; CI passes FETCH_HEAD.
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "origin/main";
const migrationsDir = join(import.meta.dir, "..", "prisma", "migrations");

const headDirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

let baseDirs: string[];
try {
  baseDirs = execSync(
    `git ls-tree --name-only ${base}:prisma/migrations`,
    { encoding: "utf8" }
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
} catch {
  console.error(`Cannot list migrations on base ref '${base}'.`);
  console.error("Fetch it first (git fetch origin main) or pass a base ref.");
  process.exit(2);
}

const baseSet = new Set(baseDirs);
const basePrefixes = new Map<string, number>();
for (const dir of baseDirs) {
  const prefix = dir.split("_")[0];
  basePrefixes.set(prefix, (basePrefixes.get(prefix) ?? 0) + 1);
}

const newDirs = headDirs.filter((d) => !baseSet.has(d));
const failures: string[] = [];
const seenNew = new Map<string, string>();
for (const dir of newDirs) {
  const prefix = dir.split("_")[0];
  if (basePrefixes.has(prefix)) {
    failures.push(
      `${dir} reuses timestamp ${prefix} already present on ${base}`
    );
  } else if (seenNew.has(prefix)) {
    failures.push(`${dir} and ${seenNew.get(prefix)} share timestamp ${prefix}`);
  } else {
    seenNew.set(prefix, dir);
  }
}

if (failures.length) {
  console.error("Duplicate Prisma migration timestamps:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `Migration timestamps OK (${newDirs.length} new, ${baseDirs.length} on ${base}).`
);
