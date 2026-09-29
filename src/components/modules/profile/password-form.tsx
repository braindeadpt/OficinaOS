import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

const RE_UPPERCASE = /[A-Z]/;
const RE_DIGIT = /[0-9]/;
const RE_SPECIAL = /[^A-Za-z0-9]/;

const STRENGTH_COLORS = [
  "bg-error",
  "bg-tertiary",
  "bg-yellow-500",
  "bg-success",
];

const STRENGTH_LABELS = [
  "profile_strength_weak",
  "profile_strength_fair",
  "profile_strength_good",
  "profile_strength_strong",
];

function passwordStrength(pw: string): number {
  if (!pw) {
    return 0;
  }
  let score = 0;
  if (pw.length >= 8) {
    score++;
  }
  if (RE_UPPERCASE.test(pw)) {
    score++;
  }
  if (RE_DIGIT.test(pw)) {
    score++;
  }
  if (RE_SPECIAL.test(pw)) {
    score++;
  }
  return score;
}

interface PasswordFormProps {
  error?: string;
  form: {
    confirmPassword: string;
    currentPassword: string;
    newPassword: string;
  };
  formRef: React.RefObject<HTMLFormElement | null>;
  isDirty: boolean;
  isSubmitting: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onErrorChange: (error: string) => void;
  onFormChange: (form: {
    confirmPassword: string;
    currentPassword: string;
    newPassword: string;
  }) => void;
  onSubmit: (e: FormEvent) => void;
  onSuccessChange: (success: string) => void;
  success?: string;
}

export function PasswordForm({
  error,
  isSubmitting,
  onSubmit,
  success,
  form,
  onFormChange,
  onDirtyChange,
  formRef,
}: PasswordFormProps) {
  const { t } = useTranslation();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const prevNewPassword = useRef(form.newPassword);

  useEffect(() => {
    if (prevNewPassword.current && !form.newPassword) {
      setConfirmMismatch(false);
      setShowCurrentPassword(false);
      setShowNewPassword(false);
    }
    prevNewPassword.current = form.newPassword;
  }, [form.newPassword]);

  const strength = passwordStrength(form.newPassword);

  function handleConfirmBlur() {
    if (form.confirmPassword && form.confirmPassword !== form.newPassword) {
      setConfirmMismatch(true);
    } else {
      setConfirmMismatch(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={onSubmit} ref={formRef}>
      <h4 className="font-bold text-on-surface text-sm uppercase tracking-wider">
        {t("profile_change_password")}
      </h4>

      {error && (
        <div
          aria-live="polite"
          className="rounded-lg bg-error-container p-4"
          role="alert"
        >
          <p className="font-bold text-on-error-container text-xs">{error}</p>
        </div>
      )}

      {success && (
        <div
          aria-live="polite"
          className="rounded-lg bg-primary-tint p-4"
          role="status"
        >
          <p className="font-bold text-success text-xs">{success}</p>
        </div>
      )}

      <div className="space-y-5">
        <Field
          endAdornment={
            <button
              aria-label={
                showCurrentPassword
                  ? t("profile_hide_password")
                  : t("profile_show_password")
              }
              className="absolute end-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high"
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              type="button"
            >
              <Icon
                name={showCurrentPassword ? "visibility" : "visibility_off"}
                size="sm"
              />
            </button>
          }
          label={t("profile_current_password")}
        >
          <Input
            autoComplete="current-password"
            className="pe-12"
            onChange={(e) => {
              onFormChange({ ...form, currentPassword: e.target.value });
              onDirtyChange(true);
            }}
            placeholder="••••••••"
            type={showCurrentPassword ? "text" : "password"}
            value={form.currentPassword}
          />
        </Field>

        <div>
          <Field
            endAdornment={
              <button
                aria-label={
                  showNewPassword
                    ? t("profile_hide_password")
                    : t("profile_show_password")
                }
                className="absolute end-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high"
                onClick={() => setShowNewPassword(!showNewPassword)}
                type="button"
              >
                <Icon
                  name={showNewPassword ? "visibility" : "visibility_off"}
                  size="sm"
                />
              </button>
            }
            hint={form.newPassword ? undefined : t("profile_password_criteria")}
            label={t("profile_new_password")}
          >
            <Input
              autoComplete="new-password"
              className="pe-12"
              onChange={(e) => {
                onFormChange({ ...form, newPassword: e.target.value });
                onDirtyChange(true);
                if (
                  confirmMismatch &&
                  form.confirmPassword === e.target.value
                ) {
                  setConfirmMismatch(false);
                }
              }}
              placeholder="••••••••"
              type={showNewPassword ? "text" : "password"}
              value={form.newPassword}
            />
          </Field>
          {form.newPassword && (
            <div
              aria-label={t(
                STRENGTH_LABELS[strength - 1] ?? "profile_strength_weak"
              )}
              aria-valuemax={4}
              aria-valuemin={0}
              aria-valuenow={strength}
              className="mt-2 space-y-1.5"
              role="progressbar"
            >
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    className={`h-1.5 flex-1 rounded-full transition-all ${i < strength ? (STRENGTH_COLORS[strength - 1] ?? "") : "bg-surface-container-high"}`}
                    key={i}
                  />
                ))}
              </div>
              <p className="font-bold text-on-surface-variant text-xs uppercase">
                {t(STRENGTH_LABELS[strength - 1] ?? "profile_strength_weak")}
              </p>
            </div>
          )}
        </div>

        <Field
          error={confirmMismatch ? t("profile_password_mismatch") : undefined}
          label={t("profile_confirm_password")}
        >
          <Input
            autoComplete="new-password"
            onBlur={handleConfirmBlur}
            onChange={(e) => {
              onFormChange({ ...form, confirmPassword: e.target.value });
              onDirtyChange(true);
              if (confirmMismatch && e.target.value === form.newPassword) {
                setConfirmMismatch(false);
              }
            }}
            placeholder="••••••••"
            type="password"
            value={form.confirmPassword}
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button
          icon="lock"
          loading={isSubmitting}
          type="submit"
          variant="primary"
        >
          {t("profile_update_password")}
        </Button>
      </div>
    </form>
  );
}
