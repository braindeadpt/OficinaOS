const MAX_REVENUE_GOAL = 99_999_999;
const SPACES_RE = /\s/g;
const COMMAS_RE = /,/g;
const DOTS_RE = /\./g;
const DECIMAL_RE = /^\d+(\.\d+)?$/;
// "2.500" / "12.500" — one dot followed by exactly three digits is a pt-PT
// thousands separator, never cents (a revenue goal has 2 decimals at most).
const THOUSANDS_RE = /^\d{1,3}\.\d{3}$/;

/**
 * Parses the admin's revenue goal input.
 *
 * - `null` means the field was deliberately left empty (goal disabled).
 * - `undefined` means the text is not a valid amount; the caller must show an
 *   error and keep the previous value instead of sending `null`.
 *
 * Accepts "4500", "4500,50", "4 500,50" and "2.500,50" (pt-PT thousands),
 * plus plain dot decimals like "4500.50".
 */
export function parseRevenueGoalInput(raw: string): number | null | undefined {
  const compact = raw.trim().replace(SPACES_RE, "");
  if (compact === "") {
    return null;
  }

  let normalized = compact;
  if (compact.includes(",")) {
    // European format: dots group thousands, the comma is the decimal mark.
    if ((compact.match(COMMAS_RE) ?? []).length > 1) {
      return;
    }
    normalized = compact.replace(DOTS_RE, "").replace(",", ".");
  } else if (
    (compact.match(DOTS_RE) ?? []).length > 1 ||
    THOUSANDS_RE.test(compact)
  ) {
    // Multiple dots with no comma can only be thousands separators.
    normalized = compact.replace(DOTS_RE, "");
  }

  if (!DECIMAL_RE.test(normalized)) {
    return;
  }

  const value = Number(normalized);
  if (!(Number.isFinite(value) && value >= 0 && value <= MAX_REVENUE_GOAL)) {
    return;
  }
  return value;
}
