import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";
import { executeGetSchema, executeQueryDatabase } from "../tools.js";

interface PrismaMock {
  prisma: PrismaClient;
  queries: string[];
  rows: unknown[];
  setStatements: string[];
  tx: {
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(rows: unknown[] = []): PrismaMock {
  const queries: string[] = [];
  const setStatements: string[] = [];

  const tx = {
    $executeRawUnsafe: vi.fn((sql: string) => {
      setStatements.push(sql);
      return Promise.resolve(0);
    }),
    $queryRawUnsafe: vi.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve(rows);
    }),
  };

  const prisma = {
    ...tx,
    $queryRaw: vi.fn(() => Promise.resolve([])),
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) =>
      Promise.resolve(fn(tx))
    ),
  };

  return {
    prisma: prisma as unknown as PrismaClient,
    queries,
    rows,
    setStatements,
    tx,
  };
}

/** Runs a query and reports whether it reached the database. */
async function run(sql: string, rows: unknown[] = []) {
  const mock = makePrisma(rows);
  const result = await executeQueryDatabase(mock.prisma, sql);
  return { executed: mock.queries.length > 0, queries: mock.queries, result };
}

describe("executeQueryDatabase — protected columns", () => {
  it("rejects a wildcard select on a table with protected columns", async () => {
    // Regression: the wildcard used to short-circuit the column check
    // entirely, returning every users.password hash to the model.
    const { executed, result } = await run("SELECT * FROM users");
    expect(executed).toBe(false);
    expect(result.data).toContain("Wildcard columns are not allowed");
  });

  it("rejects qualified wildcards on a table with protected columns", async () => {
    for (const sql of [
      "SELECT users.* FROM users",
      "SELECT u.* FROM users u",
    ]) {
      const { executed } = await run(sql);
      expect(executed, sql).toBe(false);
    }
  });

  it("rejects an explicitly named protected column", async () => {
    const { executed, result } = await run(
      "SELECT id, username, email, password FROM users"
    );
    expect(executed).toBe(false);
    expect(result.data).toContain("Access to column 'password'");
  });

  it("rejects a protected column selected through a correlated subquery", async () => {
    const { executed } = await run(
      "SELECT (SELECT password FROM users LIMIT 1) AS x FROM jobs"
    );
    expect(executed).toBe(false);
  });

  it("allows aggregates over protected tables", async () => {
    const { executed } = await run("SELECT COUNT(*) FROM users");
    expect(executed).toBe(true);
  });

  it("allows explicit non-protected columns", async () => {
    const { executed } = await run("SELECT id, username, email FROM users");
    expect(executed).toBe(true);
  });

  it("redacts protected columns from the result set as a last resort", async () => {
    // Defence in depth: even if a projection shape slipped past the static
    // checks, a row carrying the column is scrubbed before it is returned —
    // regardless of which table produced it.
    const { executed, result } = await run("SELECT id FROM jobs", [
      { id: "j1", password: "$2b$10$hash", username: "ana" },
    ]);
    expect(executed).toBe(true);
    expect(result.data).not.toContain("$2b$10$hash");
    expect(result.data).toContain("ana");
  });
});

describe("executeQueryDatabase — table allow-list", () => {
  it("rejects blocked tables", async () => {
    for (const table of ["accounts", "sessions", "shop_settings"]) {
      const { executed } = await run(`SELECT * FROM ${table}`);
      expect(executed, table).toBe(false);
    }
  });

  it("rejects tables outside the allow-list", async () => {
    const { executed } = await run("SELECT * FROM pg_tables");
    expect(executed).toBe(false);
  });

  it("accepts comma-separated joins of allowed tables", async () => {
    // The comma used to be captured as part of the table name ("jobs,"),
    // which rejected every legitimate multi-table FROM.
    const { executed } = await run(
      "SELECT jobs.id, customers.name FROM jobs, customers"
    );
    expect(executed).toBe(true);
  });
});

describe("executeQueryDatabase — statement safety", () => {
  it("rejects non-SELECT statements", async () => {
    for (const sql of [
      "DELETE FROM jobs",
      "UPDATE jobs SET status = 'DONE'",
      "INSERT INTO jobs (id) VALUES ('x')",
    ]) {
      const { executed } = await run(sql);
      expect(executed, sql).toBe(false);
    }
  });

  it("rejects stacked statements and comments", async () => {
    expect((await run("SELECT * FROM jobs; DROP TABLE jobs")).executed).toBe(
      false
    );
    expect((await run("SELECT * FROM jobs -- comment")).executed).toBe(false);
  });

  it("rejects UNION and catalog access", async () => {
    expect(
      (await run("SELECT id FROM jobs UNION SELECT id FROM users")).executed
    ).toBe(false);
    expect((await run("SELECT * FROM pg_catalog.pg_user")).executed).toBe(
      false
    );
  });

  it("allows SQL keywords that appear inside string literals", async () => {
    // Blocklist matching must ignore quoted data, or a customer whose
    // company is literally named "UNION" becomes unsearchable.
    const { executed, queries } = await run(
      "SELECT * FROM customers WHERE name = 'UNION'"
    );
    expect(executed).toBe(true);
    expect(queries[0]).toContain("'UNION'");
  });

  it("rejects an over-long query and unbalanced literals", async () => {
    expect(
      (await run(`SELECT * FROM jobs WHERE a = '${"x".repeat(3000)}'`)).executed
    ).toBe(false);
    expect((await run("SELECT * FROM jobs WHERE a = 'oops")).executed).toBe(
      false
    );
  });
});

describe("executeQueryDatabase — resource bounds", () => {
  it("applies a default LIMIT when the query has none", async () => {
    const { queries } = await run("SELECT id FROM jobs");
    expect(queries[0]).toContain("LIMIT 100");
  });

  it("caps an oversized LIMIT instead of honouring it", async () => {
    const { queries } = await run("SELECT id FROM jobs LIMIT 999999999");
    expect(queries[0]).toContain("LIMIT 1000");
    expect(queries[0]).not.toContain("999999999");
  });

  it("keeps a LIMIT that is already within bounds", async () => {
    const { queries } = await run("SELECT id FROM jobs LIMIT 5");
    expect(queries[0]).toContain("LIMIT 5");
  });

  it("runs the query under a transaction-scoped statement timeout", async () => {
    const mock = makePrisma();
    await executeQueryDatabase(mock.prisma, "SELECT id FROM jobs");
    expect(mock.setStatements[0]).toContain("SET LOCAL statement_timeout");
  });
});

describe("executeGetSchema", () => {
  it("rejects tables outside the allow-list", async () => {
    const mock = makePrisma();
    const result = await executeGetSchema(mock.prisma, "sessions");
    expect(result.success).toBe(false);
    expect(result.data).toContain("is not allowed");
    expect(mock.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("defaults to tables that exist in the schema", async () => {
    // The previous defaults ("parts", "repairs") did not match the @@map
    // names, so two of the five lookups always errored.
    const mock = makePrisma();
    const result = await executeGetSchema(mock.prisma);
    expect(result.success).toBe(true);
    expect(result.data).toContain("parts_catalog");
    expect(result.data).toContain("repair_catalog");
    expect(result.data).not.toContain('"parts"');
  });
});
