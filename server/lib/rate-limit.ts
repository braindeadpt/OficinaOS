import { createRequire } from "node:module";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyRequest } from "fastify";

// @fastify/rate-limit ships its store as CommonJS without a typed export.
const require = createRequire(import.meta.url);
const LocalStore = require("@fastify/rate-limit/store/LocalStore") as new (
  continueExceeding: boolean,
  exponentialBackoff: boolean,
  cache?: number
) => RateLimitStore;

/**
 * Upper bound for a single penalty window. Exponential backoff used to grow
 * without limit (timeWindow · 2^n), so a browser that kept retrying ended up
 * locked out for "9×10¹² seconds" — in practice forever. 15 minutes is long
 * enough to blunt abuse and short enough that a shop that tripped the limit
 * by accident is working again before the next customer walks in.
 */
export const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;

interface StoreEntry {
  current: number;
  ttl: number;
}

type StoreCallback = (err: Error | null, res: StoreEntry) => void;

interface RateLimitStore {
  child(routeOptions: Record<string, unknown>): RateLimitStore;
  incr(key: string, cb: StoreCallback, timeWindow: number, max: number): void;
  read?(key: string, cb: StoreCallback, timeWindow: number, max: number): void;
}

/**
 * The in-memory store from @fastify/rate-limit, with every window capped at
 * {@link MAX_RATE_LIMIT_BACKOFF_MS}. The cap is applied to the stored entry
 * (not just the reported TTL) so the client is really let back in when the
 * Retry-After it was given expires.
 */
export class CappedBackoffStore implements RateLimitStore {
  private readonly inner: RateLimitStore & {
    lru: {
      get(key: string): (StoreEntry & { iterationStartMs: number }) | undefined;
    };
  };
  private readonly maxTtlMs: number;

  constructor(
    params: {
      cache?: number;
      continueExceeding?: boolean;
      exponentialBackoff?: boolean;
    } = {},
    maxTtlMs = MAX_RATE_LIMIT_BACKOFF_MS
  ) {
    this.inner = new LocalStore(
      params.continueExceeding ?? false,
      params.exponentialBackoff ?? false,
      params.cache
    ) as CappedBackoffStore["inner"];
    this.maxTtlMs = maxTtlMs;
  }

  incr(key: string, cb: StoreCallback, timeWindow: number, max: number) {
    this.inner.incr(
      key,
      (err, res) => {
        if (!err && res.ttl > this.maxTtlMs) {
          const entry = this.inner.lru.get(key);
          if (entry) {
            entry.ttl = this.maxTtlMs;
          }
          cb(null, { ...res, ttl: this.maxTtlMs });
          return;
        }
        cb(err, res);
      },
      timeWindow,
      max
    );
  }

  read(key: string, cb: StoreCallback, timeWindow: number, max: number) {
    if (!this.inner.read) {
      cb(null, { current: 0, ttl: 0 });
      return;
    }
    this.inner.read(
      key,
      (err, res) => cb(err, { ...res, ttl: Math.min(res.ttl, this.maxTtlMs) }),
      timeWindow,
      max
    );
  }

  child(routeOptions: Record<string, unknown>): CappedBackoffStore {
    return new CappedBackoffStore(
      routeOptions as ConstructorParameters<typeof CappedBackoffStore>[0],
      this.maxTtlMs
    );
  }
}

/**
 * Requests that never count against the API budget: the health probe and
 * everything that is not an API call — hashed JS/CSS chunks, fonts, icons
 * and the SPA shell. A single page load fetches dozens of assets, so
 * counting them made a normal reload burn the whole 100 req/min budget.
 */
export function isRateLimitExempt(
  request: Pick<FastifyRequest, "method" | "url">
): boolean {
  const pathname = request.url.split("?", 1)[0] ?? request.url;
  if (pathname === "/health") {
    return true;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  return !(pathname.startsWith("/api/") || pathname === "/ws");
}

/**
 * Always a proper 429 with the seconds to wait, through the shared AppError
 * path — the global error handler turns it into `{ code, message, details }`.
 * The ban stage (403 by default) is folded into 429 too: for the client both
 * mean "wait and retry", and the UI only needs one message for it.
 */
export function buildRateLimitError(
  _request: FastifyRequest,
  context: { ttl: number }
): AppError {
  const retryAfter = Math.max(
    1,
    Math.ceil(Math.min(context.ttl, MAX_RATE_LIMIT_BACKOFF_MS) / 1000)
  );
  return new AppError("RATE_LIMITED", { retryAfter });
}
