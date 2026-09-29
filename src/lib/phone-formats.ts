const PHONE_FORMATS: Record<string, string> = {
  PT: "+351 XXX XXX XXX",
  FR: "+33 X XX XX XX XX",
  US: "+1 (XXX) XXX-XXXX",
  GB: "+44 XXXX XXXXXX",
};

export function getPhonePlaceholder(countryCode?: string): string {
  if (!countryCode) {
    return "+X XXX XXX XXXX";
  }
  return PHONE_FORMATS[countryCode.toUpperCase()] ?? "+X XXX XXX XXXX";
}
