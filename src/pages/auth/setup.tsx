import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import LanguageToggle from "@/components/modules/language-toggle";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import api, { type ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

/**
 * First-run setup («Criar a sua oficina»). Shown while the database has no
 * users — the login page redirects here. The server only accepts it from
 * the shop PC itself (loopback) or with the one-time ?token= from .env.
 */

interface SetupStatus {
  allowed: boolean;
  needsSetup: boolean;
}

type FieldName = "shopName" | "name" | "login" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

const MIN_PASSWORD = 8;

function isApiError(err: unknown): err is ApiError {
  return typeof err === "object" && err !== null && "code" in err;
}

function fieldErrorsFrom(err: ApiError): FieldErrors {
  const details = err.details as
    | { errors?: Record<string, string[] | undefined> }
    | undefined;
  const out: FieldErrors = {};
  for (const [field, messages] of Object.entries(details?.errors ?? {})) {
    if (messages?.[0]) {
      out[field as FieldName] = messages[0];
    }
  }
  return out;
}

function NotLocalNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4" role="alert">
      <div className="flex items-center justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-container">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-2xl text-on-primary-container"
          >
            desktop_windows
          </span>
        </div>
      </div>
      <h2 className="text-center font-bold font-headline text-on-surface text-xl">
        {t("setup_not_local_title")}
      </h2>
      <p className="text-center text-on-surface-variant text-sm">
        {t("setup_not_local_desc")}
      </p>
      <p className="text-center text-on-surface-variant/70 text-xs">
        {t("setup_not_local_hint")}
      </p>
      <Button className="w-full" onClick={onRetry} variant="secondary">
        {t("setup_retry")}
      </Button>
    </div>
  );
}

export default function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? undefined;
  const login = useAuthStore((s) => s.login);

  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [form, setForm] = useState({
    shopName: "",
    name: "",
    login: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get<SetupStatus>("/setup/status", {
        params: token ? { token } : undefined,
      });
      setStatus(res.data);
    } catch {
      // If the check itself fails, fall back to the normal login screen.
      setStatus({ needsSetup: false, allowed: false });
    }
  }, [token]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  function update(field: FieldName, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate(): FieldErrors {
    const out: FieldErrors = {};
    if (!form.shopName.trim()) {
      out.shopName = t("validations.required");
    }
    if (!form.name.trim()) {
      out.name = t("validations.required");
    }
    if (form.login.trim().length < 3) {
      out.login = t("validations.setup_login_invalid");
    }
    if (form.password.length < MIN_PASSWORD) {
      out.password = t("validations.password_min");
    }
    if (form.password !== form.confirmPassword) {
      out.confirmPassword = t("setup_passwords_mismatch");
    }
    return out;
  }

  function handleSetupError(err: unknown) {
    if (!isApiError(err)) {
      setFormError(t("setup_error"));
      return;
    }
    if (err.code === "SETUP_ALREADY_DONE" || err.code === "NOT_FOUND") {
      navigate("/login", { replace: true });
    } else if (err.code === "SETUP_NOT_LOCAL") {
      setStatus({ needsSetup: true, allowed: false });
    } else if (err.code === "VALIDATION_ERROR") {
      setErrors(fieldErrorsFrom(err));
    } else {
      setFormError(err.message || t("setup_error"));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const localErrors = validate();
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/setup", { ...form, token });
    } catch (err) {
      setSubmitting(false);
      handleSetupError(err);
      return;
    }

    // Owner created — sign straight in with the same credentials.
    try {
      await login(form.login, form.password, true);
      navigate("/", { replace: true });
    } catch {
      setSubmitting(false);
      navigate("/login", {
        replace: true,
        state: { notice: "setup_login_after_failed" },
      });
    }
  }

  if (status && !status.needsSetup) {
    return <Navigate replace to="/login" />;
  }

  let body: React.ReactNode;
  if (!status) {
    body = (
      <p
        aria-busy="true"
        className="text-center text-on-surface-variant text-sm"
        role="status"
      >
        {t("setup_checking")}
      </p>
    );
  } else if (status.allowed) {
    body = (
      <>
        <div className="mb-8">
          <h2 className="mb-1 font-bold font-headline text-2xl text-on-surface">
            {t("setup_title")}
          </h2>
          <p className="text-on-surface-variant text-sm">
            {t("setup_subtitle")}
          </p>
        </div>

        <form
          aria-label={t("setup_title")}
          className="space-y-5"
          noValidate
          onSubmit={handleSubmit}
        >
          {formError && (
            <div
              className="rounded-lg bg-error-container px-4 py-3 font-medium text-on-error-container text-sm"
              role="alert"
            >
              {formError}
            </div>
          )}

          <Field error={errors.shopName} label={t("setup_shop_name")} required>
            <Input
              autoComplete="organization"
              iconStart="storefront"
              maxLength={120}
              name="shopName"
              onChange={(e) => update("shopName", e.target.value)}
              placeholder={t("setup_shop_name_placeholder")}
              required
              value={form.shopName}
            />
          </Field>

          <Field error={errors.name} label={t("setup_your_name")} required>
            <Input
              autoComplete="name"
              iconStart="badge"
              maxLength={100}
              name="name"
              onChange={(e) => update("name", e.target.value)}
              placeholder={t("setup_your_name_placeholder")}
              required
              value={form.name}
            />
          </Field>

          <Field
            error={errors.login}
            hint={t("setup_login_hint")}
            label={t("setup_login")}
            required
          >
            <Input
              autoCapitalize="none"
              autoComplete="username"
              iconStart="person"
              maxLength={254}
              name="login"
              onChange={(e) => update("login", e.target.value)}
              placeholder={t("setup_login_placeholder")}
              required
              spellCheck={false}
              value={form.login}
            />
          </Field>

          <Field
            error={errors.password}
            hint={t("setup_password_hint")}
            label={t("setup_password")}
            required
          >
            <Input
              autoComplete="new-password"
              iconStart="lock"
              minLength={MIN_PASSWORD}
              name="password"
              onChange={(e) => update("password", e.target.value)}
              required
              type={showPassword ? "text" : "password"}
              value={form.password}
            />
          </Field>

          <Field
            error={errors.confirmPassword}
            label={t("setup_confirm_password")}
            required
          >
            <Input
              autoComplete="new-password"
              iconStart="lock"
              minLength={MIN_PASSWORD}
              name="confirmPassword"
              onChange={(e) => update("confirmPassword", e.target.value)}
              required
              type={showPassword ? "text" : "password"}
              value={form.confirmPassword}
            />
          </Field>

          <Button
            className="w-full"
            icon={showPassword ? "visibility_off" : "visibility"}
            onClick={() => setShowPassword((v) => !v)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {showPassword ? t("auth_hide_password") : t("auth_show_password")}
          </Button>

          <Button
            className="w-full"
            disabled={submitting}
            loading={submitting}
            size="lg"
            type="submit"
          >
            {submitting ? t("setup_submitting") : t("setup_submit")}
          </Button>
        </form>
      </>
    );
  } else {
    body = <NotLocalNotice onRetry={loadStatus} />;
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
        <LanguageToggle />
      </header>

      <section className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-md">{body}</div>
      </section>
    </main>
  );
}
