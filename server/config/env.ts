import { z } from "zod";

const PLACEHOLDER_PATTERNS = [/change-?me/i, /placeholder/i, /example/i];
const LOCALHOST_REGEX = /localhost|127\.0\.0\.1/;

const secretString = (minLength = 32) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !PLACEHOLDER_PATTERNS.some((p) => p.test(v)), {
      message: "looks like a placeholder — set a real random value",
    });

const csvList = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  );

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true");

/** Treat empty/whitespace-only strings as unset so defaults apply. */
/** Coerce to int, but let empty strings fall through to the default. */
const portNumber = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().int().positive().default(4000)
);

/** Let empty strings fall through to enum defaults (e.g. NODE_ENV=). */
const envEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(values)
  );

const schema = z
  .object({
    // ── Runtime ───────────────────────────────────────────────
    NODE_ENV: envEnum(["development", "test", "production"]).default(
      "development"
    ),
    PORT: portNumber,
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    TRUST_PROXY: boolish,

    // ── Database ──────────────────────────────────────────────
    DATABASE_URL: z.string().url(),

    // ── Secrets ───────────────────────────────────────────────
    BETTER_AUTH_SECRET: secretString(),
    COOKIE_SECRET: secretString().optional(),
    AI_ENCRYPTION_KEY: secretString(),

    // ── URLs (one required in prod, the rest optional) ───────
    APP_URL: z.string().url().optional(),
    API_URL: z.string().url().optional(),
    EXTRA_TRUSTED_ORIGINS: csvList,

    // ── Filesystem ────────────────────────────────────────────
    UPLOAD_DIR: z.string().default("./uploads"),

    // ── Email (optional) ──────────────────────────────────────
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    // ── Seeding (optional) ────────────────────────────────────
    SEED_ADMIN_PASSWORD: z.string().optional(),

    // ── Timezone ──────────────────────────────────────────────
    TZ: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== "production") {
      return;
    }
    if (!val.APP_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "APP_URL is required when NODE_ENV=production",
      });
    } else if (LOCALHOST_REGEX.test(val.APP_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "APP_URL must not be localhost in production",
      });
    }
    if (!val.COOKIE_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECRET"],
        message: "COOKIE_SECRET is required when NODE_ENV=production",
      });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) {
    return cached;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const pretty = Object.entries(errors)
      .map(([k, v]) => `  - ${k}: ${(v ?? []).join(", ")}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${pretty}\n\nFix .env and restart.`
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * Resolve derived URL settings:
 *   - appUrl:       the single public web origin (CORS, QR codes)
 *   - apiUrl:       where /api/auth/* is served (Better Auth baseURL)
 *   - trustedOrigins: appUrl + apiUrl + EXTRA_TRUSTED_ORIGINS
 *
 * In dev, falls back to localhost:5173 / localhost:4000 so you don't need
 * to set anything.
 */
export function resolveUrls(env: Env = loadEnv()) {
  const isProd = env.NODE_ENV === "production";
  const appUrl = env.APP_URL ?? (isProd ? "" : "http://localhost:5173");
  const apiUrl = env.API_URL ?? appUrl;
  const trustedOrigins = Array.from(
    new Set(
      [appUrl, apiUrl, ...env.EXTRA_TRUSTED_ORIGINS].filter(
        (o): o is string => typeof o === "string" && o.length > 0
      )
    )
  );
  return { appUrl, apiUrl, trustedOrigins };
}

export function resetEnvForTests(): void {
  cached = null;
}
