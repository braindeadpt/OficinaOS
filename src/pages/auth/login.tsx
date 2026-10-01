import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import LanguageToggle from "@/components/modules/language-toggle";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

const KNOWN_ERROR_KEYS = [
  "auth_login_failed",
  "auth_account_disabled",
] as const;

function isErrorKey(key: string): key is (typeof KNOWN_ERROR_KEYS)[number] {
  return KNOWN_ERROR_KEYS.includes(key as (typeof KNOWN_ERROR_KEYS)[number]);
}

function SignInForm({
  username,
  setUsername,
  password,
  setPassword,
  rememberMe,
  setRememberMe,
  loading,
  onSubmit,
  error,
  onForgotPassword,
}: {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  rememberMe: boolean;
  setRememberMe: (v: boolean) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
  onForgotPassword: () => void;
}) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      aria-label={t("auth_sign_in")}
      className="space-y-5"
      onSubmit={onSubmit}
    >
      {error && (
        <div
          className="flex items-start gap-3 rounded-lg bg-error-container px-4 py-3"
          role="alert"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined mt-0.5 text-lg text-on-error-container"
          >
            error
          </span>
          <div className="flex-1">
            <p className="font-medium text-on-error-container text-sm">
              {isErrorKey(error) ? t(error) : t("auth_login_failed")}
            </p>
            {error === "auth_login_failed" && (
              <p className="mt-1 text-on-error-container/70 text-xs">
                {t("auth_login_failed_hint")}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label
          className="font-label font-semibold text-on-surface-variant text-xs uppercase tracking-wider"
          htmlFor="username"
        >
          {t("auth_username")}
        </label>
        <div className="group relative">
          <span
            aria-hidden="true"
            className="material-symbols-outlined pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant/40 transition-colors group-focus-within:text-primary"
          >
            person
          </span>
          <input
            autoComplete="username"
            className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-4 font-medium text-on-surface transition-colors placeholder:text-on-surface-variant/40 focus-visible:bg-surface-container-lowest"
            id="username"
            maxLength={128}
            name="username"
            onChange={(e) => {
              setUsername(e.target.value);
            }}
            placeholder={t("auth_username_placeholder")}
            required
            type="text"
            value={username}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          className="font-label font-semibold text-on-surface-variant text-xs uppercase tracking-wider"
          htmlFor="password"
        >
          {t("auth_password")}
        </label>
        <div className="group relative">
          <span
            aria-hidden="true"
            className="material-symbols-outlined pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant/40 transition-colors group-focus-within:text-primary"
          >
            lock
          </span>
          <input
            autoComplete="current-password"
            className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-14 font-medium text-on-surface transition-colors placeholder:text-on-surface-variant/40 focus-visible:bg-surface-container-lowest"
            id="password"
            name="password"
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
              showPassword ? t("auth_hide_password") : t("auth_show_password")
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

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label
          className="flex cursor-pointer items-center gap-2"
          htmlFor="remember-me"
        >
          <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
            <input
              checked={rememberMe}
              className="peer h-4 w-4 rounded accent-primary"
              id="remember-me"
              name="remember-me"
              onChange={(e) => {
                setRememberMe(e.target.checked);
              }}
              type="checkbox"
            />
          </span>
          <span className="font-label text-on-surface-variant text-xs">
            {t("auth_remember_me")}
          </span>
        </label>
        <button
          className="min-h-[44px] rounded font-label font-semibold text-primary text-xs uppercase tracking-wider transition-colors hover:text-primary/80"
          onClick={onForgotPassword}
          type="button"
        >
          {t("auth_forgot_password")}
        </button>
      </div>

      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold font-headline text-on-primary text-sm uppercase tracking-wider transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={loading}
        type="submit"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined animate-spin text-lg">
              progress_activity
            </span>
            {t("auth_signing_in")}
          </span>
        ) : (
          t("auth_authorize")
        )}
      </button>
    </form>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      await api.post("/auth/request-password-reset", { email, redirectTo });
      setSent(true);
    } catch {
      setSubmitError("auth_reset_failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div aria-live="polite" className="space-y-4 py-4">
        <div className="flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-container">
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-2xl text-on-primary-container"
            >
              mail
            </span>
          </div>
        </div>
        <p className="text-center font-medium text-on-surface-variant">
          {t("auth_reset_sent")}
        </p>
        <p className="text-center text-on-surface-variant/70 text-sm">
          {t("auth_reset_sent_desc")}
        </p>
        <button
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-surface-container-highest py-3 font-bold font-headline text-on-surface text-sm uppercase tracking-wider transition-colors hover:bg-surface-container-high"
          onClick={onBack}
          type="button"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-lg"
          >
            arrow_back
          </span>
          {t("auth_back_to_sign_in")}
        </button>
      </div>
    );
  }

  return (
    <form
      aria-label={t("auth_forgot_password")}
      className="space-y-5"
      onSubmit={handleSubmit}
    >
      {submitError && (
        <div
          className="flex items-start gap-3 rounded-lg bg-error-container px-4 py-3"
          role="alert"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined mt-0.5 text-lg text-on-error-container"
          >
            error
          </span>
          <p className="font-medium text-on-error-container text-sm">
            {t(submitError)}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <label
          className="font-label font-semibold text-on-surface-variant text-xs uppercase tracking-wider"
          htmlFor="reset-email"
        >
          {t("auth_email")}
        </label>
        <div className="group relative">
          <span
            aria-hidden="true"
            className="material-symbols-outlined pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant/40 transition-colors group-focus-within:text-primary"
          >
            mail
          </span>
          <input
            autoComplete="email"
            className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-4 font-medium text-on-surface transition-colors placeholder:text-on-surface-variant/40 focus-visible:bg-surface-container-lowest"
            id="reset-email"
            maxLength={254}
            name="email"
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            placeholder={t("auth_email_placeholder")}
            required
            type="email"
            value={email}
          />
        </div>
      </div>
      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold font-headline text-on-primary text-sm uppercase tracking-wider transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={submitting}
        type="submit"
      >
        {submitting ? t("auth_sending_reset") : t("auth_send_reset")}
      </button>
      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface-container-highest py-3 font-bold font-headline text-on-surface text-sm uppercase tracking-wider transition-colors hover:bg-surface-container-high"
        onClick={onBack}
        type="button"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-lg">
          arrow_back
        </span>
        {t("auth_back_to_sign_in")}
      </button>
    </form>
  );
}

export default function LoginPage() {
  const { t } = useTranslation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const navigate = useNavigate();

  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password, rememberMe);
      navigate("/", { replace: true });
    } catch {
      // error is set in the store
    } finally {
      setLoading(false);
    }
  }

  function handleBackToSignIn() {
    setShowForgotPassword(false);
    clearError();
  }

  return (
    <main className="flex min-h-dvh w-full flex-col bg-background font-body text-on-surface antialiased">
      <header className="flex shrink-0 items-center justify-between border-outline-variant/30 border-b px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <img
            alt=""
            aria-hidden="true"
            className="h-9 w-9"
            height={36}
            src="/logo-mark.svg"
            width={36}
          />
          <div>
            <h1 className="font-bold font-headline text-lg text-on-surface tracking-tight">
              OficinaOS
            </h1>
            <p className="font-label font-medium text-on-surface-variant/60 text-xs uppercase tracking-widest">
              {t("app_tagline")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            aria-label={t("help_nav")}
            className="material-symbols-outlined min-h-11 min-w-11 rounded-full p-2.5 text-on-surface-variant transition-colors hover:bg-surface-container-high"
            title={t("help_nav")}
            to="/help"
          >
            help
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-sm">
          {showForgotPassword ? (
            <>
              <div className="mb-8">
                <h2 className="mb-1 font-bold font-headline text-2xl text-on-surface">
                  {t("auth_forgot_password")}
                </h2>
                <p className="text-on-surface-variant text-sm">
                  {t("auth_forgot_password_desc")}
                </p>
              </div>

              <ForgotPasswordForm onBack={handleBackToSignIn} />
            </>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="mb-1 font-bold font-headline text-2xl text-on-surface">
                  {t("auth_sign_in")}
                </h2>
                <p className="text-on-surface-variant text-sm">
                  {t("auth_identify")}
                </p>
              </div>

              <SignInForm
                error={error}
                loading={loading}
                onForgotPassword={() => {
                  setShowForgotPassword(true);
                }}
                onSubmit={handleSignIn}
                password={password}
                rememberMe={rememberMe}
                setPassword={setPassword}
                setRememberMe={setRememberMe}
                setUsername={setUsername}
                username={username}
              />
            </>
          )}
        </div>
      </section>

      <footer className="flex shrink-0 items-center justify-between border-outline-variant/30 border-t px-4 py-3 pb-[env(safe-area-inset-bottom,16px)] sm:px-6 lg:px-8">
        <span className="font-label text-on-surface-variant/40 text-xs">
          {t("auth_copyright")}
        </span>
        <span className="flex items-center gap-1.5 font-label text-on-surface-variant/40 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {t("auth_system_status")}
        </span>
      </footer>
    </main>
  );
}
