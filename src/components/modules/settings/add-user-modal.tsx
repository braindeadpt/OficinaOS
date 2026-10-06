import type { RoleType } from "@shared/constants";
import { Role } from "@shared/constants";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useModalEffects } from "@/hooks/use-modal-effects";
import type { ApiError } from "@/lib/api";

interface AddUserModalProps {
  onClose: () => void;
  onSubmit: (data: {
    username: string;
    email: string;
    password: string;
    role: RoleType;
  }) => Promise<void>;
}

const ROLES: RoleType[] = Object.values(Role);

export default function AddUserModal({ onClose, onSubmit }: AddUserModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEffects(true, onClose, dialogRef);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "" as RoleType | "",
  });
  const [errors, setErrors] = useState<
    Partial<Record<"username" | "email" | "password" | "role", string>>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [conflictError, setConflictError] = useState("");

  function update<K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in errors) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
    setConflictError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Partial<
      Record<"username" | "email" | "password" | "role", string>
    > = {};
    if (form.username.trim().length < 3) {
      newErrors.username = t("add_user_modal_error_username");
    }
    if (!form.email.includes("@")) {
      newErrors.email = t("add_user_modal_error_email");
    }
    if (!form.password || form.password.length < 8) {
      newErrors.password = t("add_user_modal_error_password");
    }
    if (!form.role) {
      newErrors.role = t("add_user_modal_error_role");
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        username: form.username,
        email: form.email,
        password: form.password,
        role: form.role as RoleType,
      });
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      const code = apiErr.code ?? "";
      if (code === "CONFLICT" || code.toLowerCase().includes("already")) {
        setConflictError(t("add_user_modal_error_conflict"));
      } else {
        setConflictError(t("add_user_modal_error_general"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const labelCls = "mb-2 block";

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
        aria-labelledby="add-user-modal-title"
        aria-modal="true"
        className="relative z-10 mx-4 w-full max-w-[520px] overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
        ref={dialogRef}
        role="dialog"
      >
        <form onSubmit={handleSubmit}>
          <div className="bg-surface-container-low px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h2
                  className="font-bold font-headline text-on-surface text-xl tracking-tight"
                  id="add-user-modal-title"
                >
                  {t("add_user_modal_title")}
                </h2>
                <p className="mt-0.5 text-on-surface-variant text-sm">
                  {t("add_user_modal_subtitle")}
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
            {conflictError && (
              <div className="rounded-xl bg-error-container p-3">
                <p className="font-bold text-on-error-container text-xs">
                  {conflictError}
                </p>
              </div>
            )}

            <div>
              <Label className={labelCls} htmlFor="add-user-username">
                {t("add_user_modal_username")}
              </Label>
              <Input
                id="add-user-username"
                onChange={(e) => update("username", e.target.value)}
                placeholder={t("add_user_modal_username")}
                value={form.username}
              />
              {errors.username && (
                <p className="mt-1.5 text-error text-sm">{errors.username}</p>
              )}
            </div>

            <div>
              <Label className={labelCls} htmlFor="add-user-email">
                {t("add_user_modal_email")}
              </Label>
              <Input
                id="add-user-email"
                onChange={(e) => update("email", e.target.value)}
                placeholder="user@example.com"
                type="email"
                value={form.email}
              />
              {errors.email && (
                <p className="mt-1.5 text-error text-sm">{errors.email}</p>
              )}
            </div>

            <div>
              <Label className={labelCls} htmlFor="add-user-password">
                {t("add_user_modal_password")}
              </Label>
              <Input
                id="add-user-password"
                onChange={(e) => update("password", e.target.value)}
                placeholder="••••••••"
                type="password"
                value={form.password}
              />
              {errors.password && (
                <p className="mt-1.5 text-error text-sm">{errors.password}</p>
              )}
            </div>

            <div>
              <Label className={labelCls} htmlFor="add-user-role">
                {t("add_user_modal_role")}
              </Label>
              <div className="relative">
                <Select
                  id="add-user-role"
                  onChange={(e) => update("role", e.target.value as RoleType)}
                  value={form.role}
                >
                  <option disabled value="">
                    {t("add_user_modal_role")}
                  </option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}`)}
                    </option>
                  ))}
                </Select>
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2">
                  <Icon name="expand_more" size="sm" />
                </span>
              </div>
              {errors.role && (
                <p className="mt-1.5 text-error text-sm">{errors.role}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <Button onClick={onClose} type="button" variant="secondary">
              {t("cancel")}
            </Button>
            <Button loading={submitting} type="submit">
              {t("add_user_modal_submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
