/** Longest phone string accepted by the forms and API (E.164 + separators). */
export const PHONE_MAX_LENGTH = 32;

/** Separators people actually type; anything else is not a phone number. */
const PHONE_ALLOWED_RE = /^\+?[\d\s().-]+$/;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

/**
 * Loose but real validation: optional leading "+", digits and the usual
 * separators only, with 7–15 digits (ITU E.164). This accepts "+351 912 345
 * 678", "912345678", "(21) 3456-7890" and rejects free text like "abc" or
 * a too-short "123", while leaving country-specific rules to the shop.
 */
export function isValidPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!PHONE_ALLOWED_RE.test(trimmed)) {
    return false;
  }
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

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

/** Portugal's country code, the one a search ignores. */
const PT_COUNTRY_CODE = "351";
/** A Portuguese national number is nine digits. */
const PT_NATIONAL_LENGTH = 9;

/**
 * The digits a phone search compares: separators are ignored, and so is a
 * Portuguese country prefix ("+351", "00351", or a bare "351" in front of
 * nine digits). "+351 912 345 678", "00351912345678" and "912 345 678" all
 * search as "912345678". Other country codes are kept, since only +351 is
 * implied by a local number. Returns "" when there are no digits.
 */
export function phoneSearchDigits(raw: string): string {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  const international = trimmed.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (
    digits.startsWith(PT_COUNTRY_CODE) &&
    (international ||
      digits.length >= PT_COUNTRY_CODE.length + PT_NATIONAL_LENGTH)
  ) {
    digits = digits.slice(PT_COUNTRY_CODE.length);
  }
  return digits;
}

/** Fewer digits than this match too many numbers to be a phone search. */
export const MIN_PHONE_SEARCH_DIGITS = 3;
