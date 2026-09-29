import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import api, { type ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/** Form fields the server can report a validation error against. */
type ChangePasswordField =
  | "confirmPassword"
  | "newPassword"
  | "oldPassword"
  | "username";

const SERVER_FIELD_NAMES: readonly ChangePasswordField[] = [
  "username",
  "oldPassword",
  "newPassword",
];

/**
 * Split a failed change-password response into per-field messages and a single
 * form-level message. Field errors used to be flattened into one banner that
 * showed only the first problem, so a user with a weak password and a mismatched
 * confirmation only ever learned about one of them.
 */
export function splitApiErrors(
  apiErr: ApiError,
  fallbackMessage: string
): {
  fieldErrors: Partial<Record<ChangePasswordField, string>>;
  formError: string | null;
} {
  const serverErrors = (
    apiErr.details as { errors?: Record<string, string[]> } | undefined
  )?.errors;

  const fieldErrors: Partial<Record<ChangePasswordField, string>> = {};
  let formError: string | null = null;

  for (const [field, messages] of Object.entries(serverErrors ?? {})) {
    const message = messages?.[0];
    if (!message) {
      continue;
    }
    if ((SERVER_FIELD_NAMES as readonly string[]).includes(field)) {
      fieldErrors[field as ChangePasswordField] = message;
    } else if (!formError) {
      formError = message;
    }
  }

  if (!formError) {
    formError = apiErr.code ? apiErr.message : fallbackMessage;
  }

  return { fieldErrors, formError };
}

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const currentUsername = useAuthStore((s) => s.user?.username) ?? "";
  const [username, setUsername] = useState(currentUsername);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ChangePasswordField, string>>
  >({});
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: t("auth_password_mismatch") });
      return;
    }

    if (!PASSWORD_POLICY.test(newPassword)) {
      setFieldErrors({ newPassword: t("auth_password_requirements") });
      return;
    }

    const trimmedUsername = username.trim();

    setLoading(true);
    try {
      await api.post("/auth/change-password", {
        oldPassword,
        newPassword,
        ...(trimmedUsername && trimmedUsername !== currentUsername
          ? { username: trimmedUsername }
          : {}),
      });
      useAuthStore.setState((state) => ({
        user: state.user
          ? {
              ...state.user,
              mustChangePassword: false,
              username: trimmedUsername || state.user.username,
            }
          : state.user,
        isAuthenticated: true,
        isLoading: false,
      }));
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const { fieldErrors: next, formError } = splitApiErrors(
        err as ApiError,
        t("auth_change_password_error")
      );
      setFieldErrors(next);
      setError(formError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="material-symbols-outlined mb-4 text-5xl text-primary">
            lock_reset
          </span>
          <h1 className="font-extrabold font-headline text-3xl text-on-surface">
            {t("auth_change_password_title")}
          </h1>
          <p className="mt-2 font-medium text-on-surface-variant">
            {t("auth_change_password_subtitle")}
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-xl bg-error/10 px-4 py-3 font-medium text-error text-sm">
            <span className="material-symbols-outlined text-lg">error</span>
            <span>{error}</span>
          </div>
        )}

        <form className="space-y-5" onSubmit={handleSubmit}>
          <Field
            error={fieldErrors.username}
            label={t("auth_username")}
            required
          >
            <Input
              autoComplete="username"
              className="font-medium placeholder:text-outline-variant"
              iconStart="person"
              name="username"
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("auth_username_placeholder")}
              required
              type="text"
              value={username}
            />
          </Field>

          <Field
            endAdornment={
              <button
                aria-label={
                  showOld ? t("auth_hide_password") : t("auth_show_password")
                }
                className="absolute end-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-outline-variant transition-colors hover:text-primary"
                onClick={() => setShowOld((v) => !v)}
                type="button"
              >
                <span className="material-symbols-outlined">
                  {showOld ? "visibility_off" : "visibility"}
                </span>
              </button>
            }
            error={fieldErrors.oldPassword}
            label={t("auth_current_password")}
            required
          >
            <Input
              autoComplete="current-password"
              className="pe-12 font-medium placeholder:text-outline-variant"
              iconStart="lock"
              name="oldPassword"
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder={t("auth_password_placeholder")}
              required
              type={showOld ? "text" : "password"}
              value={oldPassword}
            />
          </Field>

          <Field
            endAdornment={
              <button
                aria-label={
                  showNew ? t("auth_hide_password") : t("auth_show_password")
                }
                className="absolute end-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-outline-variant transition-colors hover:text-primary"
                onClick={() => setShowNew((v) => !v)}
                type="button"
              >
                <span className="material-symbols-outlined">
                  {showNew ? "visibility_off" : "visibility"}
                </span>
              </button>
            }
            error={fieldErrors.newPassword}
            hint={t("auth_password_requirements")}
            label={t("auth_new_password")}
            required
          >
            <Input
              autoComplete="new-password"
              className="pe-12 font-medium placeholder:text-outline-variant"
              iconStart="key"
              name="newPassword"
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("auth_password_placeholder")}
              required
              type={showNew ? "text" : "password"}
              value={newPassword}
            />
          </Field>

          <Field
            endAdornment={
              <button
                aria-label={
                  showConfirm
                    ? t("auth_hide_password")
                    : t("auth_show_password")
                }
                className="absolute end-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-outline-variant transition-colors hover:text-primary"
                onClick={() => setShowConfirm((v) => !v)}
                type="button"
              >
                <span className="material-symbols-outlined">
                  {showConfirm ? "visibility_off" : "visibility"}
                </span>
              </button>
            }
            error={fieldErrors.confirmPassword}
            label={t("auth_confirm_new_password")}
            required
          >
            <Input
              autoComplete="new-password"
              className="pe-12 font-medium placeholder:text-outline-variant"
              iconStart="key"
              name="confirmPassword"
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("auth_password_placeholder")}
              required
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
            />
          </Field>

          <button
            className="atelier-gradient flex w-full items-center justify-center gap-2 rounded-xl py-4 font-bold font-headline text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            <span>
              {loading
                ? t("auth_changing_password")
                : t("auth_change_password_submit")}
            </span>
            {!loading && (
              <span className="material-symbols-outlined text-lg">
                arrow_forward
              </span>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            className="font-semibold text-on-surface-variant text-sm transition-colors hover:text-primary"
            onClick={() => logout()}
            type="button"
          >
            {t("auth_sign_out_instead")}
          </button>
        </div>
      </div>
    </main>
  );
}
