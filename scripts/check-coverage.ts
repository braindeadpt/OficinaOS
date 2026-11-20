import fs from "node:fs/promises";

/**
 * Coverage ratchet. `coverage-budget.json` is the floor, not a target: the
 * check fails the moment a metric drops below it, so the floor only moves in
 * the direction a human commits. When coverage improves, run
 * `bun run coverage:update` to raise the floor to the measured values (it
 * never lowers them) and commit the file in the same commit.
 *
 * Usage:
 *   bun run scripts/check-coverage.ts                 compare coverage/ vs the floor
 *   bun run scripts/check-coverage.ts --update        raise the floor to the measured values
 *   bun run scripts/check-coverage.ts --base <file>   also fail if the floor was lowered vs <file>
 */

const SUMMARY_PATH = "coverage/coverage-summary.json";
const BUDGET_PATH = "scripts/coverage-budget.json";

const METRICS = ["lines", "statements", "functions", "branches"] as const;
type Metric = (typeof METRICS)[number];
type Budget = Record<Metric, number>;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function asBudget(value: unknown, source: string): Budget {
  const budget = {} as Budget;
  for (const metric of METRICS) {
    const pct = (value as Record<string, { pct?: number }>)[metric]?.pct;
    if (typeof pct !== "number") {
      throw new Error(`${source}: missing numeric pct for "${metric}"`);
    }
    budget[metric] = pct;
  }
  return budget;
}

function asFlatBudget(value: unknown, source: string): Budget {
  const budget = {} as Budget;
  for (const metric of METRICS) {
    const pct = (value as Record<string, number>)[metric];
    if (typeof pct !== "number") {
      throw new Error(`${source}: missing numeric "${metric}"`);
    }
    budget[metric] = pct;
  }
  return budget;
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const baseIdx = args.indexOf("--base");
  const basePath = baseIdx === -1 ? undefined : args[baseIdx + 1];

  let summaryRaw: unknown;
  try {
    summaryRaw = await readJson(SUMMARY_PATH);
  } catch {
    console.error(
      `${SUMMARY_PATH} not found — run \`bun run test:coverage\` first.`
    );
    process.exit(1);
  }
  const measured = asBudget(
    (summaryRaw as { total: unknown }).total,
    SUMMARY_PATH
  );
  const floor = asFlatBudget(await readJson(BUDGET_PATH), BUDGET_PATH);

  if (basePath) {
    const base = asFlatBudget(await readJson(basePath), basePath);
    const lowered = METRICS.filter((m) => floor[m] < base[m]);
    if (lowered.length > 0) {
      console.error(
        `Coverage floor was lowered vs the base branch: ${lowered
          .map((m) => `${m} ${base[m]} -> ${floor[m]}`)
          .join(", ")}. The floor only goes up.`
      );
      process.exit(1);
    }
  }

  const below = METRICS.filter((m) => measured[m] < floor[m]);
  if (below.length > 0) {
    console.error(
      `Coverage below the ratchet floor: ${below
        .map((m) => `${m} ${measured[m].toFixed(2)}% < ${floor[m]}%`)
        .join(", ")}`
    );
    process.exit(1);
  }

  if (update) {
    const raised = {} as Budget;
    let changed = false;
    for (const metric of METRICS) {
      const next = Math.max(floor[metric], measured[metric]);
      raised[metric] = Number(next.toFixed(2));
      changed = changed || raised[metric] !== floor[metric];
    }
    if (changed) {
      await fs.writeFile(BUDGET_PATH, `${JSON.stringify(raised, null, 2)}\n`);
      console.log(
        `Coverage floor raised: ${METRICS.map(
          (m) => `${m} ${floor[m]} -> ${raised[m]}`
        ).join(", ")}`
      );
    } else {
      console.log("Coverage floor unchanged (nothing measured above it).");
    }
    return;
  }

  const above = METRICS.filter((m) => measured[m] > floor[m]);
  console.log(
    `Coverage OK: ${METRICS.map(
      (m) => `${m} ${measured[m].toFixed(2)}% (floor ${floor[m]}%)`
    ).join(", ")}`
  );
  if (above.length > 0) {
    console.log(
      "Coverage improved — run `bun run coverage:update` and commit scripts/coverage-budget.json to raise the floor."
    );
  }
}

await main();
