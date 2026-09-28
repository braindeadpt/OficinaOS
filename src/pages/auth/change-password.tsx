import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import api, { type ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

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
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError(t("auth_password_mismatch"));
      return;
    }

    if (newPassword.length < 8) {
      setError(t("auth_password_min_length"));
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
      const apiErr = err as ApiError;
      const message = apiErr.code
        ? apiErr.message
        : t("auth_change_password_error");
      setError(message);
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
          <div className="space-y-1.5">
            <label
              className="block font-extrabold text-on-surface-variant text-xs uppercase tracking-wide"
              htmlFor="username"
            >
              {t("auth_username")}
            </label>
            <div className="group relative">
              <span className="material-symbols-outlined absolute start-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                person
              </span>
              <input
                autoComplete="username"
                className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-4 font-medium transition-all placeholder:text-outline-variant focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20"
                id="username"
                name="username"
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("auth_username_placeholder")}
                required
                type="text"
                value={username}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              className="block font-extrabold text-on-surface-variant text-xs uppercase tracking-wide"
              htmlFor="oldPassword"
            >
              {t("auth_current_password")}
            </label>
            <div className="group relative">
              <span className="material-symbols-outlined absolute start-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                lock
              </span>
              <input
                autoComplete="current-password"
                className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-12 font-medium transition-all placeholder:text-outline-variant focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20"
                id="oldPassword"
                name="oldPassword"
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={t("auth_password_placeholder")}
                required
                type={showOld ? "text" : "password"}
                value={oldPassword}
              />
              <button
                aria-label={
                  showOld ? t("auth_hide_password") : t("auth_show_password")
                }
                className="absolute end-4 top-1/2 -translate-y-1/2 text-outline-variant transition-colors hover:text-primary"
                onClick={() => setShowOld((v) => !v)}
                type="button"
              >
                <span className="material-symbols-outlined">
                  {showOld ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              className="block font-extrabold text-on-surface-variant text-xs uppercase tracking-wide"
              htmlFor="newPassword"
            >
              {t("auth_new_password")}
            </label>
            <div className="group relative">
              <span className="material-symbols-outlined absolute start-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                key
              </span>
              <input
                autoComplete="new-password"
                className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-12 font-medium transition-all placeholder:text-outline-variant focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20"
                id="newPassword"
                name="newPassword"
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("auth_password_placeholder")}
                required
                type={showNew ? "text" : "password"}
                value={newPassword}
              />
              <button
                aria-label={
                  showNew ? t("auth_hide_password") : t("auth_show_password")
                }
                className="absolute end-4 top-1/2 -translate-y-1/2 text-outline-variant transition-colors hover:text-primary"
                onClick={() => setShowNew((v) => !v)}
                type="button"
              >
                <span className="material-symbols-outlined">
                  {showNew ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              className="block font-extrabold text-on-surface-variant text-xs uppercase tracking-wide"
              htmlFor="confirmPassword"
            >
              {t("auth_confirm_new_password")}
            </label>
            <div className="group relative">
              <span className="material-symbols-outlined absolute start-4 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                key
              </span>
              <input
                autoComplete="new-password"
                className="w-full rounded-xl bg-surface-container-highest py-3.5 ps-12 pe-12 font-medium transition-all placeholder:text-outline-variant focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20"
                id="confirmPassword"
                name="confirmPassword"
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("auth_password_placeholder")}
                required
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
              />
              <button
                aria-label={
                  showConfirm
                    ? t("auth_hide_password")
                    : t("auth_show_password")
                }
                className="absolute end-4 top-1/2 -translate-y-1/2 text-outline-variant transition-colors hover:text-primary"
                onClick={() => setShowConfirm((v) => !v)}
                type="button"
              >
                <span className="material-symbols-outlined">
                  {showConfirm ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

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
