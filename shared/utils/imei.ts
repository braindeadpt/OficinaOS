import { z } from "zod";

/**
 * Luhn checksum validation for IMEI (15 digits) and MEID (16 digits).
 * Normalizes first: strips spaces/dashes and any "IMEI:" label prefix.
 */
const IMEI_PREFIX_RE = /^imei\s*:/i;
const NON_IMEI_CHARS_RE = /[\s-]/g;
const IMEI_SHAPE_RE = /^\d{15,16}$/;

export function normalizeImei(raw: string): string {
  return raw.trim().replace(IMEI_PREFIX_RE, "").replace(NON_IMEI_CHARS_RE, "");
}

export function isValidImei(raw: string): boolean {
  const imei = normalizeImei(raw);
  if (!IMEI_SHAPE_RE.test(imei)) {
    return false;
  }

  // Only the first 14 digits carry the Luhn check digit (last digit).
  const checkable = imei.slice(0, 14);
  const providedCheck = Number(imei.at(-1));

  let sum = 0;
  for (let i = 0; i < checkable.length; i++) {
    let digit = Number(checkable.at(-1 - i));
    // Every second digit from the right is doubled (Luhn).
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === providedCheck;
}

/** Optional IMEI field: empty passes; non-empty must pass Luhn. Normalization happens in services. */
export const imeiField = z
  .string()
  .trim()
  .max(24, { error: "validations.imei_invalid" })
  .optional()
  .or(z.literal(""))
  .refine((v) => !v || isValidImei(v), { error: "validations.imei_invalid" });
