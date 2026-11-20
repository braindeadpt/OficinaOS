import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import api, { getErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

type Step = "idle" | "password" | "enroll" | "disable";

/**
 * TOTP enrolment and management card. `forced` is the first-login gate for
 * Owner accounts (no skip option, success hands control back to the caller
 * via `onActivated`); otherwise it renders as a normal profile section.
 */
export function TwoFactorCard({
  forced = false,
  onActivated,
}: {
  forced?: boolean;
  onActivated?: () => void;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const checkSession = useAuthStore((s) => s.checkSession);
  const enabled = user?.twoFactorEnabled === true;

  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!totpUri) {
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(totpUri, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [totpUri]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/auth/two-factor/enable", { password });
      setTotpUri(res.data.totpURI ?? "");
      setBackupCodes(res.data.backupCodes ?? []);
      setStep("enroll");
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("errors.two_factor_enable_failed")));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/two-factor/verify-totp", { code: code.trim() });
      await checkSession(true);
      setStep("idle");
      setPassword("");
      setCode("");
      onActivated?.();
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("errors.two_factor_invalid_code")));
    } finally {
      setBusy(false);
    }
  }

  async function submitDisable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/two-factor/disable", { password });
      await checkSession(true);
      setStep("idle");
      setPassword("");
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("errors.two_factor_disable_failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t("twofactor_title")}
      className="rounded-2xl bg-surface-container-low p-5"
    >
      <div className="flex items-start gap-3">
        <Icon className="text-primary" name="verified_user" />
        <div className="flex-1">
          <h4 className="font-bold text-on-surface text-sm uppercase tracking-wider">
            {t("twofactor_title")}
          </h4>
          <p className="mt-1 text-on-surface-variant text-xs">
            {enabled ? t("twofactor_status_on") : t("twofactor_status_off")}
          </p>
        </div>
        {!forced && step === "idle" && (
          <Button
            icon={enabled ? "lock" : "verified_user"}
            onClick={() => {
              setStep(enabled ? "disable" : "password");
              setError("");
            }}
            type="button"
            variant={enabled ? "secondary" : "primary"}
          >
            {enabled ? t("twofactor_disable") : t("twofactor_enable")}
          </Button>
        )}
      </div>

      {error && (
        <p
          className="mt-4 rounded-lg bg-error-container px-4 py-3 font-medium text-on-error-container text-sm"
          role="alert"
        >
          {error}
        </p>
      )}

      {(step === "password" || (forced && step === "idle")) && (
        <form className="mt-4 space-y-4" onSubmit={submitPassword}>
          <Field label={t("auth_password")}>
            <Input
              autoComplete="current-password"
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              required
              type="password"
              value={password}
            />
          </Field>
          <Button disabled={busy} icon="qr_code" type="submit">
            {busy ? t("loading") : t("twofactor_enable")}
          </Button>
        </form>
      )}

      {step === "enroll" && (
        <div className="mt-4 space-y-4">
          <p className="text-on-surface-variant text-sm">
            {t("twofactor_show_qr")}
          </p>
          {qrDataUrl && (
            <img
              alt={t("twofactor_qr_alt")}
              className="mx-auto rounded-xl bg-white p-2"
              height={220}
              src={qrDataUrl}
              width={220}
            />
          )}
          <p className="break-all rounded-lg bg-surface-container-high px-3 py-2 font-mono text-on-surface-variant text-xs">
            {totpUri}
          </p>
          {backupCodes.length > 0 && (
            <div className="rounded-lg bg-surface-container-high px-3 py-2">
              <p className="mb-2 font-semibold text-on-surface text-xs uppercase tracking-wider">
                {t("twofactor_backup_codes")}
              </p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-on-surface-variant text-xs">
                {backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="mt-2 text-on-surface-variant/70 text-xs">
                {t("twofactor_backup_codes_hint")}
              </p>
            </div>
          )}
          <form className="space-y-4" onSubmit={submitCode}>
            <Field label={t("auth_2fa_code_label")}>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={8}
                onChange={(e) => {
                  setCode(e.target.value);
                }}
                required
                value={code}
              />
            </Field>
            <Button disabled={busy} icon="verified_user" type="submit">
              {busy ? t("loading") : t("twofactor_confirm")}
            </Button>
          </form>
        </div>
      )}

      {step === "disable" && (
        <form className="mt-4 space-y-4" onSubmit={submitDisable}>
          <Field label={t("auth_password")}>
            <Input
              autoComplete="current-password"
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              required
              type="password"
              value={password}
            />
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy} icon="lock" type="submit">
              {busy ? t("loading") : t("twofactor_disable_confirm")}
            </Button>
            <Button
              onClick={() => {
                setStep("idle");
                setError("");
              }}
              type="button"
              variant="secondary"
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
