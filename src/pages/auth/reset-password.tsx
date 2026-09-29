import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import api from "@/lib/api";

const KNOWN_ERROR_KEYS = [
  "auth_reset_invalid_token",
  "auth_reset_expired",
  "auth_password_min_length",
  "auth_password_mismatch",
] as const;

function isErrorKey(key: string): key is (typeof KNOWN_ERROR_KEYS)[number] {
  return KNOWN_ERROR_KEYS.includes(key as (typeof KNOWN_ERROR_KEYS)[number]);
}

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");
  const tokenError = searchParams.get("error");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    tokenError ? "auth_reset_expired" : null
  );
  const [success, setSuccess] = useState(false);

  const hasValidContext = token || tokenError;
  if (!hasValidContext) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm text-center">
          <span
            aria-hidden="true"
            className="material-symbols-outlined mb-4 text-5xl text-error"
          >
            error_circle_rounded
          </span>
          <h1 className="mb-2 font-bold font-headline text-2xl text-on-surface">
            {t("auth_reset_invalid_link")}
          </h1>
          <p className="mb-6 text-on-surface-variant text-sm">
            {t("auth_reset_invalid_link_desc")}
          </p>
          <button
            className="rounded-xl bg-primary px-6 py-3 font-bold text-on-primary"
            onClick={() => {
              navigate("/login");
            }}
            type="button"
          >
            {t("auth_back_to_sign_in")}
          </button>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-container">
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-2xl text-on-primary-container"
              >
                check_circle
              </span>
            </div>
          </div>
          <h1 className="mb-2 font-bold font-headline text-2xl text-on-surface">
            {t("auth_reset_success")}
          </h1>
          <p className="mb-6 text-on-surface-variant text-sm">
            {t("auth_reset_success_desc")}
          </p>
          <button
            className="rounded-xl bg-primary px-6 py-3 font-bold text-on-primary"
            onClick={() => {
              navigate("/login");
            }}
            type="button"
          >
            {t("auth_sign_in")}
          </button>
        </div>
      </main>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("auth_password_min_length");
      return;
    }

    if (password !== confirmPassword) {
      setError("auth_password_mismatch");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { newPassword: password, token });
      setSuccess(true);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { message?: string; code?: string } };
      };
      const code = axiosErr.response?.data?.code;
      if (code === "RESET_PASSWORD_DISABLED" || code === "INVALID_TOKEN") {
        setError("auth_reset_invalid_token");
      } else {
        setError("auth_reset_failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span
            aria-hidden="true"
            className="material-symbols-outlined mb-4 text-5xl text-primary"
          >
            lock_reset
          </span>
          <h1 className="mb-1 font-bold font-headline text-2xl text-on-surface">
            {t("auth_reset_password_title")}
          </h1>
          <p className="text-on-surface-variant text-sm">
            {t("auth_reset_password_subtitle")}
          </p>
        </div>

        {error && (
          <div
            className="mb-6 flex items-start gap-3 rounded-lg bg-error-container px-4 py-3"
            role="alert"
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined mt-0.5 text-lg text-on-error-container"
            >
              error
            </span>
            <p className="font-medium text-on-error-container text-sm">
              {isErrorKey(error) ? t(error) : t("auth_reset_failed")}
            </p>
          </div>
        )}

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label
              className="font-label font-semibold text-on-surface-variant text-xs uppercase tracking-wider"
              htmlFor="new-password"
            >
              {t("auth_new_password")}
            </label>
            <div className="group relative">
              <span
                aria-hidden="true"
                className="material-symbols-outlined pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant/40 transition-colors group-focus-within:text-primary"
              >
                key
              </span>
              <input
                autoComplete="new-password"
                className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-14 font-medium text-on-surface transition-colors placeholder:text-on-surface-variant/40 focus-visible:bg-surface-container-lowest"
                id="new-password"
                name="new-password"
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                placeholder={t("auth_password_placeholder")}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={
                  showPassword
                    ? t("auth_hide_password")
                    : t("auth_show_password")
                }
                className="absolute end-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-on-surface-variant/40 transition-colors hover:bg-surface-container-high hover:text-on-surface-variant"
                onClick={() => {
                  setShowPassword((v) => !v);
                }}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-xl"
                >
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              className="font-label font-semibold text-on-surface-variant text-xs uppercase tracking-wider"
              htmlFor="confirm-password"
            >
              {t("auth_confirm_new_password")}
            </label>
            <div className="group relative">
              <span
                aria-hidden="true"
                className="material-symbols-outlined pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant/40 transition-colors group-focus-within:text-primary"
              >
                key
              </span>
              <input
                autoComplete="new-password"
                className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-4 font-medium text-on-surface transition-colors placeholder:text-on-surface-variant/40 focus-visible:bg-surface-container-lowest"
                id="confirm-password"
                name="confirm-password"
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                }}
                placeholder={t("auth_password_placeholder")}
                required
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
              />
            </div>
          </div>

          <button
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold font-headline text-on-primary text-sm uppercase tracking-wider transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? t("auth_saving") : t("auth_reset_password_submit")}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            className="font-label font-semibold text-on-surface-variant text-xs uppercase tracking-wider transition-colors hover:text-primary"
            onClick={() => {
              navigate("/login");
            }}
            type="button"
          >
            {t("auth_back_to_sign_in")}
          </button>
        </div>
      </div>
    </main>
  );
}
