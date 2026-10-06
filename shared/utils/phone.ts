/**
 * Canonical form of a phone number for duplicate detection: separators
 * (spaces, dashes, dots, parentheses) are dropped and an international
 * "00" prefix becomes "+". "912 345 678", "912-345-678" and "912345678"
 * all normalize to "912345678"; "00351 912…" and "+351 912…" match too.
 *
 * Deliberately does not guess country codes: "912345678" and
 * "+351912345678" stay distinct, since the shop's default country is a
 * setting, not something the number itself says.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }
  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }
  return digits;
}
