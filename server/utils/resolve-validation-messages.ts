import i18next from "i18next";

const VALIDATION_PREFIX = "validations.";

const validationI18n = i18next.createInstance(
  {
    resources: {},
    fallbackLng: "en",
    ns: ["validations"],
    defaultNS: "validations",
  },
  // biome-ignore lint/suspicious/noEmptyBlockStatements: i18next init callback — intentionally empty
  () => {}
);

let initialized = false;

export async function initValidationI18n() {
  if (initialized) {
    return;
  }
  const en = await import("../../src/i18n/locales/en.json");
  const fr = await import("../../src/i18n/locales/fr.json");
  const pt = await import("../../src/i18n/locales/pt.json");
  validationI18n.addResourceBundle("en", "validations", en.validations);
  validationI18n.addResourceBundle("fr", "validations", fr.validations);
  validationI18n.addResourceBundle("pt", "validations", pt.validations);
  initialized = true;
}

export function resolveValidationMessage(
  message: string,
  locale: string
): string {
  if (!message.startsWith(VALIDATION_PREFIX)) {
    return message;
  }
  const key = message.slice(VALIDATION_PREFIX.length);
  return validationI18n.t(key, { defaultValue: message, lng: locale });
}

export function resolveZodErrors(
  errors: Record<string, string[] | undefined>,
  locale: string
): Record<string, string[]> {
  const resolved: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (messages) {
      resolved[field] = messages.map((m) =>
        resolveValidationMessage(m, locale)
      );
    }
  }
  return resolved;
}
