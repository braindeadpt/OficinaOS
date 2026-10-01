import { LANGUAGES } from "@shared/constants";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { type ApiError } from "@/lib/api";

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  const nextLang = () => {
    const normalizedLang = i18n.language.split("-")[0];
    const currentIdx = LANGUAGES.indexOf(
      normalizedLang as (typeof LANGUAGES)[number]
    );
    const resolvedIdx = currentIdx === -1 ? 0 : currentIdx;
    const next = LANGUAGES[(resolvedIdx + 1) % LANGUAGES.length];
    i18n.changeLanguage(next);
  };

  return (
    <button
      aria-label={t("language_switch")}
      className="material-symbols-outlined min-h-11 min-w-11 rounded-full p-2.5 text-on-surface-variant transition-colors hover:bg-surface-container-high"
      onClick={nextLang}
      type="button"
    >
      language
    </button>
  );
}

interface FormState {
  company: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deviceLabel: string;
  problem: string;
  whatsappOptIn: boolean;
}

const INITIAL: FormState = {
  company: "",
  customerEmail: "",
  customerName: "",
  customerPhone: "",
  deviceLabel: "",
  problem: "",
  whatsappOptIn: false,
};

export default function PreCheckPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const canSubmit =
    form.customerName.trim().length >= 2 &&
    form.customerPhone.trim().length >= 6 &&
    form.deviceLabel.trim().length >= 2 &&
    form.problem.trim().length >= 10;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post("/public/pre-check", {
        company: form.company || undefined,
        customerEmail: form.customerEmail.trim() || undefined,
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        deviceLabel: form.deviceLabel.trim(),
        problem: form.problem.trim(),
        whatsappOptIn: form.whatsappOptIn,
      });
      setSubmittedCode(res.data?.code ?? null);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || t("pre_check_error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <nav className="sticky top-0 z-50 w-full bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img
              alt=""
              aria-hidden="true"
              className="h-8 w-8"
              height={32}
              src="/logo-mark.svg"
              width={32}
            />
            <span className="font-bold font-headline text-2xl text-primary-container tracking-tight">
              OficinaOS
            </span>
          </div>
          <LanguageSwitcher />
        </div>
      </nav>

      <main className="flex flex-grow items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <div className="overflow-hidden rounded-xl bg-surface-container-low p-8 shadow-sm md:p-12">
            {submittedCode ? (
              <div className="flex flex-col items-center text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary-container/20">
                  <span className="material-symbols-outlined text-3xl text-primary-container">
                    check_circle
                  </span>
                </div>
                <h1 className="mb-3 font-extrabold font-headline text-3xl text-on-surface tracking-tight">
                  {t("pre_check_success_title")}
                </h1>
                <p className="mb-6 max-w-sm font-body text-on-surface-variant">
                  {t("pre_check_success_body")}
                </p>
                <div className="rounded-xl bg-surface-container-highest px-6 py-4">
                  <p className="text-on-surface-variant text-xs uppercase tracking-wider">
                    {t("pre_check_success_code_label")}
                  </p>
                  <p className="font-bold font-headline text-2xl text-on-surface tracking-wide">
                    {submittedCode}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-8 flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-highest">
                    <span className="material-symbols-outlined text-3xl text-primary-container">
                      troubleshoot
                    </span>
                  </div>
                  <h1 className="mb-3 font-extrabold font-headline text-3xl text-on-surface tracking-tight md:text-4xl">
                    {t("pre_check_title")}
                  </h1>
                  <p className="max-w-sm font-body text-lg text-on-surface-variant">
                    {t("pre_check_subtitle")}
                  </p>
                </div>

                <form className="w-full space-y-4" onSubmit={handleSubmit}>
                  {/* Honeypot — hidden from humans, bots fill it. */}
                  <div
                    aria-hidden="true"
                    className="absolute h-0 w-0 overflow-hidden opacity-0"
                  >
                    <Input
                      autoComplete="off"
                      name="company"
                      onChange={(e) => set({ company: e.target.value })}
                      tabIndex={-1}
                      type="text"
                      value={form.company}
                    />
                  </div>

                  <Field label={t("pre_check_name")} required>
                    <Input
                      autoComplete="name"
                      maxLength={100}
                      onChange={(e) => set({ customerName: e.target.value })}
                      required
                      type="text"
                      value={form.customerName}
                    />
                  </Field>

                  <Field label={t("pre_check_phone")} required>
                    <Input
                      autoComplete="tel"
                      inputMode="tel"
                      maxLength={30}
                      onChange={(e) => set({ customerPhone: e.target.value })}
                      required
                      type="tel"
                      value={form.customerPhone}
                    />
                  </Field>

                  <Field
                    hint={t("pre_check_email_hint")}
                    label={t("pre_check_email")}
                  >
                    <Input
                      autoComplete="email"
                      onChange={(e) => set({ customerEmail: e.target.value })}
                      type="email"
                      value={form.customerEmail}
                    />
                  </Field>

                  <Field
                    hint={t("pre_check_device_hint")}
                    label={t("pre_check_device")}
                    required
                  >
                    <Input
                      maxLength={100}
                      onChange={(e) => set({ deviceLabel: e.target.value })}
                      placeholder={t("pre_check_device_placeholder")}
                      required
                      type="text"
                      value={form.deviceLabel}
                    />
                  </Field>

                  <Field label={t("pre_check_problem")} required>
                    <Textarea
                      maxLength={2000}
                      onChange={(e) => set({ problem: e.target.value })}
                      placeholder={t("pre_check_problem_placeholder")}
                      required
                      rows={4}
                      value={form.problem}
                    />
                  </Field>

                  <Field horizontal label={t("pre_check_whatsapp_optin")}>
                    <Checkbox
                      checked={form.whatsappOptIn}
                      onChange={(e) => set({ whatsappOptIn: e.target.checked })}
                    />
                  </Field>

                  {error && (
                    <p className="text-error text-sm" role="alert">
                      {error}
                    </p>
                  )}

                  <button
                    className="flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-primary font-bold font-headline text-lg text-on-primary shadow-lg shadow-primary/10 transition-all duration-150 active:opacity-80 disabled:opacity-50"
                    disabled={!canSubmit || submitting}
                    type="submit"
                  >
                    <span>
                      {submitting
                        ? t("pre_check_submitting")
                        : t("pre_check_submit")}
                    </span>
                    <span className="material-symbols-outlined text-xl">
                      arrow_forward
                    </span>
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
