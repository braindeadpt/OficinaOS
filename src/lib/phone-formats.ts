const PHONE_FORMATS: Record<string, string> = {
  PT: "+351 XXX XXX XXX",
  DZ: "+213 XX XXX XXXX",
  FR: "+33 X XX XX XX XX",
  US: "+1 (XXX) XXX-XXXX",
  GB: "+44 XXXX XXXXXX",
  DE: "+49 XXX XXXXXXX",
  TN: "+216 XX XXX XXX",
  MA: "+212 XX XXX XXXX",
};

export function getPhonePlaceholder(countryCode?: string): string {
  if (!countryCode) {
    return "+X XXX XXX XXXX";
  }
  return PHONE_FORMATS[countryCode.toUpperCase()] ?? "+X XXX XXX XXXX";
}
