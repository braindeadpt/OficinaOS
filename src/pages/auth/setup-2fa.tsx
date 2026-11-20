import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import LanguageToggle from "@/components/modules/language-toggle";
import { TwoFactorCard } from "@/components/modules/profile/two-factor-card";
import { useAuthStore } from "@/stores/auth";

/**
 * Forced TOTP enrolment: an Owner session exists but every API route
 * refuses until twoFactorEnabled (TWO_FACTOR_SETUP_REQUIRED). The page
 * stands alone — no dashboard chrome, no way forward without a code.
 */
export default function Setup2faPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const enabled = useAuthStore((s) => s.user?.twoFactorEnabled === true);

  return (
    <main className="flex min-h-dvh w-full flex-col bg-background font-body text-on-surface antialiased">
      <header className="flex shrink-0 items-center justify-between border-outline-variant/30 border-b px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <img
            alt=""
            aria-hidden="true"
            className="h-9 w-9"
            height={36}
            src="/logo-mark.svg"
            width={36}
          />
          <h1 className="font-bold font-headline text-lg text-on-surface tracking-tight">
            OficinaOS
          </h1>
        </div>
        <LanguageToggle />
      </header>

      <section className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h2 className="mb-1 font-bold font-headline text-2xl text-on-surface">
              {t("twofactor_required_title")}
            </h2>
            <p className="text-on-surface-variant text-sm">
              {t("twofactor_required_desc")}
            </p>
          </div>

          {enabled ? (
            <p className="text-on-surface-variant text-sm">{t("loading")}</p>
          ) : (
            <TwoFactorCard
              forced
              onActivated={() => navigate("/", { replace: true })}
            />
          )}

          <button
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-surface-container-highest py-3 font-bold font-headline text-on-surface text-sm uppercase tracking-wider transition-colors hover:bg-surface-container-high"
            onClick={logout}
            type="button"
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-lg"
            >
              logout
            </span>
            {t("auth_sign_out_instead")}
          </button>
        </div>
      </section>
    </main>
  );
}
