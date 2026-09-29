// Defensive: neutralize spreadsheet formula prefixes.
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;
// Cells with these characters need RFC 4180 quoting.
const NEEDS_QUOTING_RE = /[",\n\r]/;

/**
 * Generic CSV export: builds an RFC 4180-style CSV string and triggers a
 * browser download. Cells are quoted when needed and formula-injection
 * characters (=, +, -, @) are neutralized for spreadsheet apps.
 */
export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const escapeCell = (cell: string | number | null | undefined): string => {
    if (cell === null || cell === undefined) {
      return "";
    }
    let value = String(cell);
    if (FORMULA_PREFIX_RE.test(value)) {
      value = `'${value}`;
    }
    if (NEEDS_QUOTING_RE.test(value)) {
      value = `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
): void {
  const csv = toCsv(headers, rows);
  // BOM so Excel detects UTF-8 (accents in pt/fr locales).
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
