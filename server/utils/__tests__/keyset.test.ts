import { AppError } from "@shared/errors/app-error.js";
import { describe, expect, it } from "vitest";
import {
  keysetOrderBy,
  requireKeysetCursor,
  type SortDirection,
  withKeyset,
} from "../keyset.js";

interface Row {
  id: string;
  sort: number;
}

type Branch = Record<string, Record<string, number | string> | number | string>;

/** The filter `withKeyset` generates for a descending list, verbatim. */
function branches(cursor: { id: string; sortValue: number }): Branch[] {
  const where = withKeyset({}, cursor, "sort", "desc") as {
    AND: { OR: Branch[] }[];
  };
  return where.AND[0].OR;
}

/** Orders like Prisma would, across the numeric and string columns. */
function before(a: number | string, b: number | string): boolean {
  return typeof a === "number" && typeof b === "number"
    ? a < b
    : String(a) < String(b);
}

/**
 * Evaluates the generated filter the way Prisma would: a row passes when it
 * satisfies at least one branch, and every key/constraint pair in a branch must
 * hold. Testing the traversal against this — rather than eyeballing the shape —
 * is what proves the page boundary leaves no gap.
 */
function matches(
  row: Row,
  cursor: { id: string; sortValue: number },
  direction: SortDirection = "desc"
): boolean {
  const where = withKeyset({}, cursor, "sort", direction) as {
    AND: { OR: Branch[] }[];
  };
  return where.AND[0].OR.some((branch) =>
    Object.entries(branch).every(([field, constraint]) => {
      const value = field === "id" ? row.id : row.sort;
      // A bare value is an equality tie-break ("sort: 100"); an object is a
      // range ("sort: { lt: 100 }").
      if (typeof constraint !== "object" || constraint === null) {
        return value === constraint;
      }
      const [op, operand] = Object.entries(constraint)[0] as [
        "lt" | "gt",
        number | string,
      ];
      return op === "lt" ? before(value, operand) : before(operand, value);
    })
  );
}

describe("keysetOrderBy", () => {
  it("ties the ordering on the unique id", () => {
    expect(keysetOrderBy("name", "asc")).toEqual([
      { name: "asc" },
      { id: "asc" },
    ]);
  });

  it("defaults to descending", () => {
    expect(keysetOrderBy("createdAt")).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });
});

describe("withKeyset — generated filter", () => {
  const cursor = { id: "m5", sortValue: 100 };

  it("filters on the sort column, not just the id", () => {
    // The regression: a list sorted by name/createdAt paged on `id` alone,
    // which is what re-emitted and skipped rows.
    expect(branches(cursor)).toEqual([
      { sort: { lt: 100 } },
      { sort: 100, id: { lt: "m5" } },
    ]);
  });

  it("inverts the comparison for ascending lists", () => {
    const where = withKeyset(
      {},
      { id: "p5", sortValue: "Bracket" },
      "name",
      "asc"
    ) as { AND: { OR: Branch[] }[] };
    expect(where.AND[0].OR).toEqual([
      { name: { gt: "Bracket" } },
      { name: "Bracket", id: { gt: "p5" } },
    ]);
  });
});

describe("withKeyset — traversal", () => {
  it("breaks ties on the id, so the boundary is unambiguous", () => {
    // Descending list, cursor sits between "c" and "d" on a shared sort value.
    const cursor = { id: "c", sortValue: 2 };
    // The cursor row itself is never re-emitted.
    expect(matches({ id: "c", sort: 2 }, cursor)).toBe(false);
    // Tied on sort, id sorts ahead of the cursor -> already seen.
    expect(matches({ id: "d", sort: 2 }, cursor)).toBe(false);
    // Tied on sort, id sorts behind the cursor -> next page.
    expect(matches({ id: "b", sort: 2 }, cursor)).toBe(true);
    // Strictly older on the sort key -> next page.
    expect(matches({ id: "z", sort: 1 }, cursor)).toBe(true);
    // Newer on the sort key -> already seen.
    expect(matches({ id: "a", sort: 3 }, cursor)).toBe(false);
  });

  it("walks a descending list exactly once, with no gaps or repeats", () => {
    // Three rows share a sort value — the case a plain id cursor gets wrong.
    const rows: Row[] = [
      { id: "a", sort: 3 },
      { id: "b", sort: 2 },
      { id: "c", sort: 2 },
      { id: "d", sort: 2 },
      { id: "e", sort: 1 },
    ].sort((x, y) => y.sort - x.sort || y.id.localeCompare(x.id));

    const visited: string[] = [];
    let cursor: { id: string; sortValue: number } | null = null;

    for (;;) {
      const page = rows
        .filter((row) => (cursor ? matches(row, cursor) : true))
        .slice(0, 2);
      if (page.length === 0) {
        break;
      }
      visited.push(...page.map((row) => row.id));
      const last = page.at(-1);
      if (!last) {
        break;
      }
      cursor = { id: last.id, sortValue: last.sort };
    }

    // Descending on both keys, so the three tied rows read d, c, b.
    expect(visited).toEqual(["a", "d", "c", "b", "e"]);
    expect(new Set(visited).size).toBe(visited.length);
  });

  it("walks an ascending list exactly once", () => {
    const rows: Row[] = [
      { id: "a", sort: 1 },
      { id: "b", sort: 2 },
      { id: "c", sort: 2 },
      { id: "d", sort: 3 },
    ].sort((x, y) => x.sort - y.sort || x.id.localeCompare(y.id));

    const visited: string[] = [];
    let cursor: { id: string; sortValue: number } | null = null;

    for (;;) {
      const page = rows
        .filter((row) => (cursor ? matches(row, cursor, "asc") : true))
        .slice(0, 2);
      if (page.length === 0) {
        break;
      }
      visited.push(...page.map((row) => row.id));
      const last = page.at(-1);
      if (!last) {
        break;
      }
      cursor = { id: last.id, sortValue: last.sort };
    }

    expect(visited).toEqual(["a", "b", "c", "d"]);
  });
});

describe("withKeyset — composition", () => {
  const cursor = { id: "m5", sortValue: 100 };

  it("ANDs onto existing filters instead of overwriting them", () => {
    // A search already occupies `OR`; clobbering it would drop the search.
    const where: Record<string, unknown> = {
      OR: [{ name: { contains: "screen" } }],
    };
    const result = withKeyset(where, cursor, "createdAt", "desc");
    expect(result.OR).toEqual([{ name: { contains: "screen" } }]);
    expect(result.AND).toHaveLength(1);
  });

  it("preserves filters that already use AND", () => {
    const where: Record<string, unknown> = { AND: [{ isActive: true }] };
    const result = withKeyset(where, cursor, "createdAt", "desc");
    expect(result.AND).toHaveLength(2);
    expect((result.AND as unknown[])[0]).toEqual({ isActive: true });
  });

  it("does not mutate the caller's where object", () => {
    const where: Record<string, unknown> = { AND: [{ isActive: true }] };
    withKeyset(where, cursor, "createdAt", "desc");
    expect(where.AND).toHaveLength(1);
  });
});

describe("requireKeysetCursor", () => {
  it("resolves the sort value from the cursor row", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    expect(requireKeysetCursor({ createdAt, id: "m1" }, "createdAt")).toEqual({
      id: "m1",
      sortValue: createdAt,
    });
  });

  it("rejects a cursor whose row no longer exists", () => {
    expect(() => requireKeysetCursor(null, "createdAt")).toThrow(AppError);
    expect(() => requireKeysetCursor(null, "createdAt")).toThrow(
      "errors.invalid_cursor"
    );
  });
});
