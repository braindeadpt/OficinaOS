const SUPPORTED_LOCALES = new Set(["en", "es", "fr", "pt"]);

/**
 * The reset link must open the SPA — not the Better Auth API endpoint it
 * was generated with. The client already says where the user browsed from
 * (redirectTo → callbackURL), so we rebuild the link as
 * `<origin>/reset-password?token=<token>`. The origin is only honored when
 * it is in trustedOrigins (config + EXTRA_TRUSTED_ORIGINS + mDNS name);
 * anything else — including a forged Host/Origin header, which we never
 * read — falls back to appUrl.
 */
export function buildPasswordResetLink(
  resetUrl: string,
  appUrl: string,
  trustedOrigins: string[]
): string {
  let token = "";
  let callbackOrigin: string | null = null;
  try {
    const parsed = new URL(resetUrl);
    token = decodeURIComponent(
      parsed.pathname.split("/reset-password/")[1] ?? ""
    );
    const callback = parsed.searchParams.get("callbackURL");
    if (callback) {
      const origin = new URL(callback).origin;
      if (trustedOrigins.includes(origin)) {
        callbackOrigin = origin;
      }
    }
  } catch {
    // Unparseable Better Auth URL — emit a link that lands on the
    // invalid-token screen instead of crashing the callback.
  }
  const origin = callbackOrigin ?? appUrl;
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

export function localeFromRequest(request: Request | undefined): string {
  const acceptLanguage = request?.headers.get("accept-language");
  const preferred = acceptLanguage
    ?.split(",")[0]
    ?.split("-")[0]
    ?.trim()
    .toLowerCase();
  return preferred && SUPPORTED_LOCALES.has(preferred) ? preferred : "pt";
}
