/**
 * GSM-7 helpers for SMS output (3GPP 23.038 default alphabet).
 *
 * - toSmsText(): transliterates accented Latin to base letters (ã→a, ç→c…)
 *   so the message stays inside the GSM-7 charset — used for every automatic
 *   reply (rules and AI).
 * - smsSegmentCount(): segments the text costs as-is (GSM-7 → 160/153
 *   septets per segment; anything else → UCS-2 → 70/67).
 * - staffSmsText(): manual staff messages keep accents unless keeping them
 *   would cost an extra segment.
 */

// GSM-7 basic alphabet (1 septet each).
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
);
// GSM-7 extension table (ESC + char → 2 septets each).
const GSM7_EXT = new Set("{}\\[]~|€^");

const ACCENT_MAP: Record<string, string> = {
  à: "a",
  á: "a",
  â: "a",
  ã: "a",
  ä: "a",
  å: "a",
  æ: "ae",
  ç: "c",
  è: "e",
  é: "e",
  ê: "e",
  ë: "e",
  ì: "i",
  í: "i",
  î: "i",
  ï: "i",
  ñ: "n",
  ò: "o",
  ó: "o",
  ô: "o",
  õ: "o",
  ö: "o",
  ø: "o",
  ù: "u",
  ú: "u",
  û: "u",
  ü: "u",
  ý: "y",
  ÿ: "y",
  ß: "ss",
  À: "A",
  Á: "A",
  Â: "A",
  Ã: "A",
  Ä: "A",
  Å: "A",
  Æ: "AE",
  Ç: "C",
  È: "E",
  É: "E",
  Ê: "E",
  Ë: "E",
  Ì: "I",
  Í: "I",
  Î: "I",
  Ï: "I",
  Ñ: "N",
  Ò: "O",
  Ó: "O",
  Ô: "O",
  Õ: "O",
  Ö: "O",
  Ø: "O",
  Ù: "U",
  Ú: "U",
  Û: "U",
  Ü: "U",
  Ý: "Y",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
};

function isGsm7Char(ch: string): boolean {
  return GSM7_BASIC.has(ch) || GSM7_EXT.has(ch);
}

/** Number of GSM-7 septets the text costs, or null when not encodable. */
export function gsm7Septets(text: string): number | null {
  let n = 0;
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) {
      n += 1;
    } else if (GSM7_EXT.has(ch)) {
      n += 2;
    } else {
      return null;
    }
  }
  return n;
}

/** Segments the text costs as-is: 160/153 for GSM-7, 70/67 for UCS-2. */
export function smsSegmentCount(text: string): number {
  const septets = gsm7Septets(text);
  if (septets !== null) {
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  const len = text.length;
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

/** Full transliteration into GSM-7 — every automatic/AI SMS reply uses this. */
export function toSmsText(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isGsm7Char(ch)) {
      out += ch;
    } else {
      const mapped = ACCENT_MAP[ch];
      out += mapped ?? "?";
    }
  }
  return out;
}

/**
 * Staff-authored SMS: keeps accents when the message already fits a single
 * segment; transliterates when keeping them would split the message.
 */
export function staffSmsText(text: string): string {
  return smsSegmentCount(text) <= 1 ? text : toSmsText(text);
}
