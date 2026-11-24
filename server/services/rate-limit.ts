const DIGITS_RE = /\D/g;
const DEFAULT_LIMIT_PER_HOUR = 20;

// In-memory flood limiter — reset on restart, which is fine: worst case
// a flood source gets one extra window. Shared by the customer bot
// channels and the ponto module (own "ponto" scope).
const rateBuckets = new Map<string, { n: number; resetAt: number }>();

export function rateOk(
  phone: string,
  limit = DEFAULT_LIMIT_PER_HOUR,
  scope?: string
): boolean {
  const now = Date.now();
  // Normalize — WhatsApp delivers "351912…" while sms-gate may send
  // "+351912…" or "0912…"; the same sender must share one bucket.
  // `scope` separa quotas independentes no mesmo número: os alertas ao
  // staff (media/sem cliente) têm o seu contador e não esgotam a janela
  // das respostas automáticas (e vice-versa).
  const digits = phone.replace(DIGITS_RE, "").slice(-9);
  const key = scope ? `${scope}:${digits}` : digits;
  let b = rateBuckets.get(key);
  if (!b || b.resetAt < now) {
    b = { n: 0, resetAt: now + 3_600_000 };
    rateBuckets.set(key, b);
  }
  return ++b.n <= limit;
}
