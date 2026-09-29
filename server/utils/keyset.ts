import { AppError } from "@shared/errors/app-error.js";

export type SortDirection = "asc" | "desc";

/** The last row of a page: its id plus the value it was sorted by. */
export interface KeysetCursor<T> {
  id: string;
  sortValue: T;
}

/** Normalises a `where.AND` that may be absent, a single filter, or a list. */
function asConditions(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * `where` fragment that resumes a keyset page after `cursor`.
 *
 * Rows are ordered by `sortField` and then by `id`, both in `direction`. The
 * fragment keeps everything strictly past the cursor on the primary key, plus
 * the rows that tie on it and are ordered by id — that tiebreak is what makes
 * the ordering total, so a page boundary is never ambiguous.
 *
 * A bare `id: { lt: cursor }` pages correctly only when the query is sorted by
 * id. On any other sort it silently re-emits rows the caller already has and
 * skips rows it never showed.
 *
 * The condition is appended to `AND` rather than merged into `OR`, because
 * callers legitimately filter on `OR` themselves (searching two columns) and
 * overwriting it would drop the search.
 */
export function withKeyset<T extends Record<string, unknown>>(
  where: T,
  cursor: KeysetCursor<unknown>,
  sortField: string,
  direction: SortDirection = "desc"
): T {
  const condition =
    direction === "desc"
      ? {
          OR: [
            { [sortField]: { lt: cursor.sortValue } },
            { [sortField]: cursor.sortValue, id: { lt: cursor.id } },
          ],
        }
      : {
          OR: [
            { [sortField]: { gt: cursor.sortValue } },
            { [sortField]: cursor.sortValue, id: { gt: cursor.id } },
          ],
        };

  return { ...where, AND: [...asConditions(where.AND), condition] };
}

/**
 * `orderBy` matching `withKeyset`. Sorting by the id tiebreak makes the result
 * deterministic, which is what allows the cursor to identify a position.
 */
export function keysetOrderBy(
  sortField: string,
  direction: SortDirection = "desc"
): Record<string, unknown>[] {
  return [{ [sortField]: direction }, { id: direction }];
}

/**
 * Resolves a client-supplied cursor id into the sort value it was returned at.
 *
 * A cursor that no longer resolves — the row was deleted between pages — means
 * the client is holding a position that can never be honoured, so it is
 * rejected rather than silently restarting from the top of the list.
 */
export function requireKeysetCursor<T>(
  row: { [K: string]: T } | null | undefined,
  field: string
): KeysetCursor<T> {
  if (!row) {
    throw new AppError("INVALID_CURSOR");
  }
  return { id: String(row.id), sortValue: row[field] as T };
}
