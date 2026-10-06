import i18next from "i18next";
import { z } from "zod";

const VALIDATION_PREFIX = "validations.";
// Interpolation params ride along in the message after this separator:
// `validations.max_length|{"max":120}`.
const PARAMS_SEPARATOR = "|";

type ZodIssue = z.core.$ZodRawIssue;

function withParams(key: string, params: Record<string, unknown>): string {
  return `${VALIDATION_PREFIX}${key}${PARAMS_SEPARATOR}${JSON.stringify(params)}`;
}

function sizeMessage(
  origin: unknown,
  bound: "min" | "max",
  value: unknown
): string {
  const n = Number(value);
  if (origin === "string") {
    if (bound === "min" && n <= 1) {
      return `${VALIDATION_PREFIX}required`;
    }
    return withParams(`${bound}_length`, { [bound]: n });
  }
  if (origin === "array" || origin === "set") {
    if (bound === "min" && n <= 1) {
      return `${VALIDATION_PREFIX}required`;
    }
    return withParams(`${bound}_items`, { [bound]: n });
  }
  if (origin === "date") {
    return `${VALIDATION_PREFIX}invalid_date`;
  }
  return withParams(`${bound}_value`, { [bound]: n });
}

const FORMAT_KEYS: Record<string, string> = {
  cuid: "invalid_id",
  cuid2: "invalid_id",
  date: "invalid_date",
  datetime: "invalid_date",
  email: "email",
  url: "invalid_url",
  uuid: "invalid_id",
};

/**
 * Maps a Zod issue that has no schema-level message to a `validations.*`
 * key, so the API never leaks Zod's built-in English text ("Invalid input:
 * expected number, received undefined"). Schema-level `{ error: "..." }`
 * messages take precedence over this map (Zod's error precedence), so
 * existing hand-written keys are untouched.
 */
export function zodIssueToMessageKey(issue: ZodIssue): string {
  const raw = issue as unknown as Record<string, unknown>;
  switch (issue.code) {
    case "invalid_type": {
      if (raw.input === undefined || raw.input === null) {
        return raw.expected === "date"
          ? `${VALIDATION_PREFIX}invalid_date`
          : `${VALIDATION_PREFIX}required`;
      }
      if (raw.expected === "number" || raw.expected === "int") {
        return `${VALIDATION_PREFIX}invalid_number`;
      }
      if (raw.expected === "date") {
        return `${VALIDATION_PREFIX}invalid_date`;
      }
      return `${VALIDATION_PREFIX}invalid_value`;
    }
    case "too_small":
      return sizeMessage(raw.origin, "min", raw.minimum);
    case "too_big":
      return sizeMessage(raw.origin, "max", raw.maximum);
    case "invalid_format": {
      const key = FORMAT_KEYS[String(raw.format)] ?? "invalid_value";
      return `${VALIDATION_PREFIX}${key}`;
    }
    case "invalid_value":
      return `${VALIDATION_PREFIX}invalid_option`;
    default:
      return `${VALIDATION_PREFIX}invalid_value`;
  }
}

// Installed once, server-side: every schema parsed in this process gets
// localizable keys instead of Zod's English defaults.
z.config({ customError: zodIssueToMessageKey });

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
  const es = await import("../../src/i18n/locales/es.json");
  const fr = await import("../../src/i18n/locales/fr.json");
  const pt = await import("../../src/i18n/locales/pt.json");
  validationI18n.addResourceBundle("en", "validations", en.validations);
  validationI18n.addResourceBundle("es", "validations", es.validations);
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
  const sep = message.indexOf(PARAMS_SEPARATOR);
  const key = message.slice(
    VALIDATION_PREFIX.length,
    sep === -1 ? undefined : sep
  );
  let params: Record<string, unknown> = {};
  if (sep !== -1) {
    try {
      params = JSON.parse(message.slice(sep + 1)) as Record<string, unknown>;
    } catch {
      params = {};
    }
  }
  return validationI18n.t(key, {
    ...params,
    defaultValue: message.slice(0, sep === -1 ? undefined : sep),
    lng: locale,
  });
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

/** Same as resolveZodErrors, for routes that return the raw issue list. */
export function localizeZodIssues<T extends { message: string }>(
  issues: readonly T[],
  locale: string
): T[] {
  return issues.map((issue) => ({
    ...issue,
    message: resolveValidationMessage(issue.message, locale),
  }));
}
