import type { PrismaClient } from "@generated/client";
import { Prisma } from "@generated/client";
import { logger } from "../utils/logger.js";

const SQL_COMMENT_REGEX = /--|\/\*/;
const LIMIT_VALUE_RE = /\bLIMIT\s+(\d+)/i;

interface ToolResult {
  data: string;
  success: boolean;
}

const ALLOWED_TABLES = new Set([
  "jobs",
  "customers",
  "devices",
  "job_repairs",
  "job_parts",
  "job_notes",
  "job_photos",
  "job_parts_waiting",
  "repair_catalog",
  "parts_catalog",
  "audit_logs",
  "users",
]);

const BLOCKED_TABLES = new Set([
  "accounts",
  "sessions",
  "verifications",
  "shop_settings",
]);

const BLOCKED_COLUMNS: Record<string, Set<string>> = {
  users: new Set(["password"]),
};

/**
 * Columns that must never reach the model, however the query projected them
 * (wildcard, alias, correlated subquery, CTAS…). The static analysis in
 * `validateTables` rejects the shapes it recognises; `redactProtectedColumns`
 * then enforces the same rule on the actual result set, so a gap in the
 * analysis can never leak a credential into the model's context.
 */
const PROTECTED_COLUMNS = new Set(
  Object.values(BLOCKED_COLUMNS).flatMap((columns) =>
    [...columns].map((column) => column.toLowerCase())
  )
);

/** Tables offered to the model when it calls getSchema() without arguments. */
const DEFAULT_SCHEMA_TABLES = [
  "jobs",
  "customers",
  "parts_catalog",
  "repair_catalog",
  "users",
];

const MAX_QUERY_LENGTH = 2000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
/** Server-side ceiling for analyst queries, independent of the model's LIMIT. */
const STATEMENT_TIMEOUT_MS = 5000;

const SELECT_ONLY_REGEX = /^\s*SELECT\s/i;
const SELECT_KEYWORD_RE = /\bSELECT\b/gi;
const FROM_KEYWORD_RE = /\bFROM\b/i;
const AS_ALIAS_RE = /.*\bas\s+/i;
const TABLE_PREFIX_RE = /.*\./;
const WILDCARD_COLUMN_RE = /(^|,)\s*(\w+\s*\.\s*)?\*/;
const TABLE_REFERENCE_RE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([^\s(]+)/gi;
const QUOTE_RE = /["`]/g;
const STRING_LITERAL_RE = /'(?:[^']|'')*'/g;
const TRAILING_COMMA_RE = /,$/;

const BLOCKED_PATTERNS = [
  /\bpg_catalog\b/i,
  /\bpg_toast\b/i,
  /\bpg_read_file\b/i,
  /\bpg_write_file\b/i,
  /\bdblink\b/i,
  /\blo_import\b/i,
  /\blo_export\b/i,
  /\bUNION\b/i,
  /\bWITH\s/i,
  /\binformation_schema\b/i,
  /\bpg_sleep\b/i,
  /\bwaitfor\b/i,
  /\bbenchmark\b/i,
];

/**
 * Replace string literals with an empty placeholder. All keyword and table
 * analysis runs on this copy, so user-supplied data can neither smuggle a
 * keyword past the blocklist nor be mistaken for one — a customer literally
 * named "UNION" must not have their row rejected.
 */
function stripStringLiterals(sql: string): string {
  return sql.replace(STRING_LITERAL_RE, "''");
}

function extractTableNames(sql: string): string[] {
  const tables: string[] = [];
  for (const match of sql.matchAll(TABLE_REFERENCE_RE)) {
    const table = (match[1] ?? "")
      .replace(QUOTE_RE, "")
      .replace(TRAILING_COMMA_RE, "")
      .toLowerCase();
    if (table) {
      tables.push(table);
    }
  }
  return tables;
}

/**
 * Yields the projection of every SELECT in the query, not just the outermost
 * one. A correlated subquery (`SELECT (SELECT password FROM users LIMIT 1)`)
 * has an inner projection that a single non-greedy match would skip over.
 */
function* selectProjections(sql: string): Generator<string> {
  for (const match of sql.matchAll(SELECT_KEYWORD_RE)) {
    const start = (match.index ?? 0) + match[0].length;
    const rest = sql.slice(start);
    const fromMatch = FROM_KEYWORD_RE.exec(rest);
    if (fromMatch) {
      yield rest.slice(0, fromMatch.index);
    }
  }
}

function checkBlockedColumns(
  sql: string,
  table: string,
  blocked: Set<string>
): string | null {
  const protectedList = [...blocked].join(", ");
  const projections = [...selectProjections(sql)];

  // Fail closed: without a readable projection we cannot prove the protected
  // columns are absent, and this table is known to carry them.
  if (projections.length === 0) {
    return `Columns for table '${table}' must be listed explicitly (protected columns: ${protectedList})`;
  }

  for (const projection of projections) {
    if (WILDCARD_COLUMN_RE.test(projection)) {
      return `Wildcard columns are not allowed on table '${table}' because it has protected columns (${protectedList})`;
    }
    for (const rawColumn of projection.split(",")) {
      const column = rawColumn.trim().toLowerCase();
      if (!column) {
        continue;
      }
      const columnName = column
        .replace(AS_ALIAS_RE, "")
        .replace(TABLE_PREFIX_RE, "");
      if (blocked.has(columnName)) {
        return `Access to column '${columnName}' on table '${table}' is not allowed`;
      }
    }
  }

  return null;
}

function validateTables(sql: string, tables: string[]): string | null {
  for (const table of tables) {
    if (BLOCKED_TABLES.has(table)) {
      return `Access to table '${table}' is not allowed`;
    }
    if (!ALLOWED_TABLES.has(table)) {
      return `Table '${table}' is not in the allowed list`;
    }
    const blocked = BLOCKED_COLUMNS[table];
    if (blocked) {
      const columnError = checkBlockedColumns(sql, table, blocked);
      if (columnError) {
        return columnError;
      }
    }
  }
  return null;
}

/** Guarantees a bounded row count, tightening (never loosening) a model LIMIT. */
function enforceLimit(sql: string): string {
  const match = sql.match(LIMIT_VALUE_RE);
  if (!match) {
    return `${sql} LIMIT ${DEFAULT_LIMIT}`;
  }
  const requested = Number.parseInt(match[1] ?? "0", 10);
  if (requested <= MAX_LIMIT) {
    return sql;
  }
  return sql.replace(LIMIT_VALUE_RE, `LIMIT ${MAX_LIMIT}`);
}

/**
 * Last line of defence: drops protected columns from the result rows by key
 * name, so an aliased or subquery-wrapped projection still cannot surface a
 * credential even if the static checks are ever fooled.
 */
function redactProtectedColumns(result: unknown): unknown {
  if (!Array.isArray(result)) {
    return result;
  }
  return result.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (PROTECTED_COLUMNS.has(key.toLowerCase())) {
        continue;
      }
      redacted[key] = value;
    }
    return redacted;
  });
}

export async function executeGetSchema(
  prisma: PrismaClient,
  tableName?: string
): Promise<ToolResult> {
  const requested = tableName ? [tableName] : DEFAULT_SCHEMA_TABLES;

  // The model supplies this name, so it must clear the same allow-list that
  // guards queryDatabase — otherwise it could map the schema of `sessions`
  // or `accounts`, the very tables BLOCKED_TABLES exists to hide.
  for (const table of requested) {
    if (!ALLOWED_TABLES.has(table.toLowerCase())) {
      return {
        success: false,
        data: `Access to table '${table}' is not allowed`,
      };
    }
  }

  const results: Record<string, unknown> = {};
  for (const table of requested) {
    try {
      const columns = await prisma.$queryRaw(
        Prisma.sql`SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = ${table} AND table_schema = 'public'
         ORDER BY ordinal_position`
      );
      results[table] = columns;
    } catch (error) {
      logger.warn({ err: error, table }, "AI schema lookup failed");
      results[table] = { error: `Table '${table}' not found` };
    }
  }
  return { success: true, data: JSON.stringify(results) };
}

export async function executeQueryDatabase(
  prisma: PrismaClient,
  sql: string
): Promise<ToolResult> {
  const trimmed = sql.trim().replace(/\s+/g, " ");

  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { success: false, data: "Query exceeds maximum allowed length" };
  }

  // Everything below inspects the literal-free copy; the original `trimmed`
  // is what actually reaches the database.
  const analyzed = stripStringLiterals(trimmed);

  const unbalancedQuotes = (trimmed.match(/'/g) ?? []).length % 2 !== 0;
  if (unbalancedQuotes) {
    return { success: false, data: "Unbalanced string literals in query" };
  }

  if (analyzed.includes(";")) {
    return { success: false, data: "Only single statements are allowed" };
  }

  if (SQL_COMMENT_REGEX.test(analyzed)) {
    return { success: false, data: "SQL comments are not allowed" };
  }

  if (!SELECT_ONLY_REGEX.test(trimmed)) {
    return { success: false, data: "Only SELECT queries are allowed" };
  }

  const parenDepth = [...analyzed].reduce((acc, ch) => {
    if (ch === "(") {
      return acc + 1;
    }
    if (ch === ")") {
      return acc - 1;
    }
    return acc;
  }, 0);
  if (parenDepth !== 0) {
    return { success: false, data: "Unbalanced parentheses in query" };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(analyzed)) {
      return {
        success: false,
        data: "Access to system objects is not allowed",
      };
    }
  }

  const tableError = validateTables(analyzed, extractTableNames(analyzed));
  if (tableError) {
    return { success: false, data: tableError };
  }

  const finalSql = enforceLimit(trimmed);

  try {
    // SET LOCAL is transaction-scoped, so the ceiling applies to this query
    // only and never leaks onto the pooled connection.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`
      );
      return await tx.$queryRawUnsafe(finalSql);
    });
    return {
      success: true,
      data: JSON.stringify(redactProtectedColumns(result)),
    };
  } catch (err) {
    return {
      success: false,
      data: `Query error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
