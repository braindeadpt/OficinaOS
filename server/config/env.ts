import { z } from "zod";

const PLACEHOLDER_PATTERNS = [/change-?me/i, /placeholder/i, /example/i];
const LOCALHOST_REGEX = /localhost|127\.0\.0\.1/;
const GITHUB_REPO_REGEX = /^[\w.-]+\/[\w.-]+$/;

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

// Secrets that must never reach the public demo — real credentials on a
// shared, hourly-reset instance would leak the moment anyone hit Settings.
const DEMO_FORBIDDEN_ENV =
  /^(OPENAI_|EMAIL_|WHATSAPP_|SMTP_|META_|EVOLUTION_|OFICINAOS_CLOUD_|CLOUD_|GITHUB_|INVOICEXPRESS_|IX_|TRADE_|MARKET_|S3_|R2_|AWS_|BACKUP_|SEED_ADMIN_|SETUP_TOKEN)/;
// Catch-all for credentials we didn't enumerate by prefix: anything that
// LOOKS like a secret is forbidden in demo — except the few the app
// genuinely needs to boot (session/crypto keys stay local, never leave
// the container).
const DEMO_FORBIDDEN_SUFFIX =
  /(_TOKEN|_SECRET|_PASSWORD|_PASS|_KEY|_API_KEY|_APIKEY|_CREDENTIALS|_DSN)$/;
const DEMO_ALLOWED_SECRETS = new Set([
  "BETTER_AUTH_SECRET",
  "COOKIE_SECRET",
  "AI_ENCRYPTION_KEY",
]);

function isDemoForbiddenEnv(key: string): boolean {
  if (DEMO_ALLOWED_SECRETS.has(key)) {
    return false;
  }
  return DEMO_FORBIDDEN_ENV.test(key) || DEMO_FORBIDDEN_SUFFIX.test(key);
}

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

    // ── LAN discovery (optional) ──────────────────────────────
    // Advertises <MDNS_HOSTNAME>.local via mDNS so devices keep connecting
    // when the PC's IP changes. Off by default — set by the Windows
    // installer/portable env; meaningless inside NAT'd Docker.
    MDNS_HOSTNAME: z
      .string()
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i, "must be a DNS label")
      .optional(),

    // ── Email (optional) ──────────────────────────────────────
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    // ── Seeding (optional) ────────────────────────────────────
    // Only for dev/CI/E2E — production installs create the first owner on
    // the first-run setup screen instead of seeding a known password.
    SEED_ADMIN_PASSWORD: z.string().optional(),

    // ── First-run setup (optional) ────────────────────────────
    // One-time token that lets /setup run from a non-loopback address
    // (e.g. Docker, where the browser on the host is not 127.0.0.1 to the
    // container). Dead once the first user exists.
    SETUP_TOKEN: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().min(16).optional()
    ),

    // ── In-app feedback → GitHub issues (optional) ───────────
    GITHUB_FEEDBACK_TOKEN: z.string().optional(),
    GITHUB_FEEDBACK_REPO: z
      .string()
      .regex(GITHUB_REPO_REGEX, "must be owner/repo")
      .default("braindeadpt/OficinaOS"),

    // ── Demo mode ─────────────────────────────────────────────
    // Public demo at demo.oficinaos.app: fictional shop, hourly reset,
    // everything that could reach the outside world switched off.
    DEMO_MODE: boolish,
    // Trust CF-Connecting-IP for rate-limit keys. Optional because the
    // header is client-controlled the moment someone reaches the origin
    // without going through Cloudflare — only turn on if the edge proxy
    // does not already strip/replace it AND requests can also arrive
    // from a public socket IP (Docker-internal peers are trusted anyway).
    DEMO_TRUST_CF_CONNECTING_IP: boolish,

    // ── Timezone ──────────────────────────────────────────────
    TZ: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // The demo must never hold real credentials: it is public, seeded with
    // fictional data and reset hourly. Real secrets defined alongside
    // DEMO_MODE mean a misconfigured deploy — refuse to start.
    if (val.DEMO_MODE) {
      const forbidden = Object.keys(process.env).filter(isDemoForbiddenEnv);
      for (const key of forbidden) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            "must not be set when DEMO_MODE=true (demo never uses real credentials)",
        });
      }
    }

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
  // Operator-facing: keep Zod's English messages here even though the
  // server installs a global error map that emits i18n keys for API errors.
  const parsed = schema.safeParse(process.env, {
    error: z.locales.en().localeError,
  });
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
