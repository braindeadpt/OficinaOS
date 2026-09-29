import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_OPTIONS } from "@/components/modules/profile/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface PersonalFormProps {
  error?: string;
  form: { email: string; language: string; name: string; username: string };
  formRef: React.RefObject<HTMLFormElement | null>;
  initialLanguage: string;
  isDirty: boolean;
  isSubmitting: boolean;
  onCancel: () => void;
  onChange: (field: string, value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function PersonalForm({
  error,
  form,
  initialLanguage,
  isDirty,
  isSubmitting,
  onCancel,
  onChange,
  onSubmit,
  formRef,
}: PersonalFormProps) {
  const { t } = useTranslation();
  const languageChanged = form.language !== initialLanguage;

  return (
    <>
      <form className="space-y-6" onSubmit={onSubmit} ref={formRef}>
        {error && (
          <div
            aria-live="polite"
            className="rounded-lg bg-error-container p-4"
            role="alert"
          >
            <p className="font-bold text-on-error-container text-xs">{error}</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          <Field label={t("profile_name")}>
            <Input
              onChange={(e) => onChange("name", e.target.value)}
              type="text"
              value={form.name}
            />
          </Field>

          <Field label={t("username")}>
            <Input
              onChange={(e) => onChange("username", e.target.value)}
              type="text"
              value={form.username}
            />
          </Field>

          <Field label={t("email")}>
            <Input
              onChange={(e) => onChange("email", e.target.value)}
              type="email"
              value={form.email}
            />
          </Field>

          <Field
            endAdornment={
              <Icon
                className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
                name="expand_more"
                size="sm"
              />
            }
            hint={languageChanged ? t("profile_language_preview") : undefined}
            label={t("profile_language")}
          >
            <Select
              className="pe-12"
              onChange={(e) => onChange("language", e.target.value)}
              value={form.language}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </form>

      {isDirty && (
        <div className="flex justify-end gap-3 rounded-2xl bg-surface-container-low p-3">
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            {t("profile_cancel_edit")}
          </Button>
          <Button
            icon="save"
            loading={isSubmitting}
            onClick={() => formRef.current?.requestSubmit()}
            size="sm"
            type="button"
            variant="primary"
          >
            {t("profile_save")}
          </Button>
        </div>
      )}
    </>
  );
}
