import axios from "axios";
import { toast } from "sonner";
import i18n from "@/i18n";

export interface ApiError {
  code: string;
  details?: unknown;
  message: string;
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as ApiError).message || fallback;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

/**
 * Friendly, localized text for a 429: how long to wait, from the Retry-After
 * header (or the body's details.retryAfter), rounded to something a person
 * at the counter can act on.
 */
export function rateLimitMessage(
  retryAfterSeconds: number | undefined
): string {
  if (!(retryAfterSeconds && Number.isFinite(retryAfterSeconds))) {
    return i18n.t("errors.rate_limited");
  }
  if (retryAfterSeconds < 60) {
    return i18n.t("errors.rate_limited_seconds", {
      count: Math.max(1, Math.ceil(retryAfterSeconds)),
    });
  }
  return i18n.t("errors.rate_limited_minutes", {
    count: Math.ceil(retryAfterSeconds / 60),
  });
}

function retryAfterFrom(response: {
  data?: { details?: { retryAfter?: unknown } };
  headers?: Record<string, unknown>;
}): number | undefined {
  const header = Number(response.headers?.["retry-after"]);
  if (Number.isFinite(header) && header > 0) {
    return header;
  }
  const body = Number(response.data?.details?.retryAfter);
  return Number.isFinite(body) && body > 0 ? body : undefined;
}

const baseURL = import.meta.env.VITE_API_BASE_URL || "";

const api = axios.create({
  baseURL: `${baseURL}/api`,
  timeout: 15_000,
  withCredentials: true,
});

let csrfToken: string | null = null;
let csrfPromise: Promise<string | null> | null = null;

// Consecutive-failure counter for CSRF token fetch
let csrfFetchFailures = 0;
let csrfCooldownUntil = 0;
const CSRF_FAILURE_THRESHOLD = 3;
const CSRF_COOLDOWN_MS = 30_000;

export function fetchCsrfToken(): Promise<string | null> {
  if (csrfToken) {
    return Promise.resolve(csrfToken);
  }

  // Check if we're in cooldown after repeated failures
  if (Date.now() < csrfCooldownUntil) {
    return Promise.resolve(null);
  }
  // Cooldown expired — reset
  if (csrfCooldownUntil > 0) {
    csrfFetchFailures = 0;
    csrfCooldownUntil = 0;
  }

  if (csrfPromise) {
    return csrfPromise;
  }

  csrfPromise = axios
    .get(`${baseURL}/api/csrf-token`, { withCredentials: true })
    .then((res) => {
      csrfFetchFailures = 0;
      csrfToken = res.data.token;
      return csrfToken;
    })
    .catch(() => {
      csrfFetchFailures += 1;
      if (csrfFetchFailures >= CSRF_FAILURE_THRESHOLD) {
        csrfCooldownUntil = Date.now() + CSRF_COOLDOWN_MS;
      }
      return null;
    })
    .finally(() => {
      csrfPromise = null;
    });

  return csrfPromise;
}

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

api.interceptors.request.use(async (config) => {
  if (MUTATION_METHODS.has(config.method?.toLowerCase() ?? "")) {
    const token = await fetchCsrfToken();
    if (token) {
      config.headers["X-CSRF-Token"] = token;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 429) {
      const retryAfter = retryAfterFrom(error.response);
      const message = rateLimitMessage(retryAfter);
      // One toast however many requests were rejected at once.
      toast.error(message, { id: "rate-limited" });
      const apiErr: ApiError = {
        code: "RATE_LIMITED",
        message,
        details: { retryAfter },
      };
      return Promise.reject(apiErr);
    }
    if (error.response?.status === 403) {
      const message: string = error.response?.data?.message ?? "";
      if (message.toLowerCase().includes("csrf")) {
        csrfToken = null;
        const originalRequest = error.config;
        if (!originalRequest._csrfRetry) {
          originalRequest._csrfRetry = true;
          const token = await fetchCsrfToken();
          if (token) {
            originalRequest.headers["X-CSRF-Token"] = token;
            return api(originalRequest);
          }
        }
      }
    }

    if (error.response?.status === 401) {
      const url = error.config?.url ?? "";
      const authEndpoints = [
        "/auth/sign-in",
        "/auth/sign-out",
        "/auth/get-session",
        "/auth/change-password",
        "/auth/must-change-password",
        "/auth/request-password-reset",
        "/auth/reset-password",
      ];
      const isAuthEndpoint = authEndpoints.some((ep) => url.includes(ep));
      if (!isAuthEndpoint) {
        window.location.href = "/login";
      }
    }
    const apiError = error.response?.data as
      | { code?: string; message?: string; details?: unknown }
      | undefined;
    if (apiError?.code) {
      const message =
        apiError.message && typeof apiError.message === "string"
          ? i18n.t(apiError.message, apiError.message)
          : i18n.t("errors.generic");
      const apiErr: ApiError = {
        code: apiError.code,
        message,
        details: apiError.details,
      };
      return Promise.reject(apiErr);
    }
    return Promise.reject(error);
  }
);

export default api;
