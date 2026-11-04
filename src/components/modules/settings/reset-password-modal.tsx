import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModalEffects } from "@/hooks/use-modal-effects";

interface ResetPasswordModalProps {
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  username: string;
}

export default function ResetPasswordModal({
  onClose,
  onSubmit,
  username,
}: ResetPasswordModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEffects(true, onClose, dialogRef);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || password.length < 8) {
      setError(t("add_user_modal_error_password"));
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(password);
      setDone(true);
    } catch {
      setError(t("profile_password_update_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (done) {
    // Show the temporary password ONCE — the admin hands it to the user,
    // who must rotate it at first login (mustChangePassword is set).
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <button
          aria-hidden="true"
          className="absolute inset-0 bg-overlay backdrop-blur-[20px]"
          onClick={onClose}
          tabIndex={-1}
          type="button"
        />
        <div
          aria-labelledby="reset-password-done-title"
          aria-modal="true"
          className="relative z-10 mx-4 w-full max-w-[440px] overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
          ref={dialogRef}
          role="dialog"
        >
          <div className="bg-surface-container-low px-6 py-5">
            <h2
              className="font-bold font-headline text-on-surface text-xl tracking-tight"
              id="reset-password-done-title"
            >
              {t("reset_password_done_title")}
            </h2>
            <p className="mt-0.5 text-on-surface-variant text-sm">
              {t("reset_password_done_desc", { name: username })}
            </p>
          </div>
          <div className="flex flex-col gap-5 px-6 py-6">
            <div>
              <Label className="mb-2 block" htmlFor="reset-password-temp">
                {t("reset_password_temporary")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  className="font-mono"
                  id="reset-password-temp"
                  readOnly
                  value={password}
                />
                <Button
                  onClick={copyPassword}
                  type="button"
                  variant="secondary"
                >
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
            </div>
            <p className="rounded-xl bg-tertiary-container p-3 text-on-tertiary-container text-xs">
              {t("reset_password_must_change_hint")}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <Button onClick={onClose} type="button">
              {t("close")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        aria-hidden="true"
        className="absolute inset-0 bg-overlay backdrop-blur-[20px]"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby="reset-password-modal-title"
        aria-modal="true"
        className="relative z-10 mx-4 w-full max-w-[440px] overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
        ref={dialogRef}
        role="dialog"
      >
        <form onSubmit={handleSubmit}>
          <div className="bg-surface-container-low px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h2
                  className="font-bold font-headline text-on-surface text-xl tracking-tight"
                  id="reset-password-modal-title"
                >
                  {t("reset_password_title")}
                </h2>
                <p className="mt-0.5 text-on-surface-variant text-sm">
                  {t("reset_password_desc", { name: username })}
                </p>
              </div>
              <button
                aria-label={t("close")}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                onClick={onClose}
                type="button"
              >
                <Icon name="close" size="sm" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-6 py-6">
            {error && (
              <div className="rounded-xl bg-error-container p-3">
                <p className="font-bold text-on-error-container text-xs">
                  {error}
                </p>
              </div>
            )}
            <div>
              <Label className="mb-2 block" htmlFor="reset-password-new">
                {t("reset_password_new")}
              </Label>
              <Input
                id="reset-password-new"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                placeholder="••••••••"
                type="password"
                value={password}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <Button onClick={onClose} type="button" variant="secondary">
              {t("cancel")}
            </Button>
            <Button loading={submitting} type="submit">
              {t("reset_password_submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
