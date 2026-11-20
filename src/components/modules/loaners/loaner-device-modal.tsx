import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { getErrorMessage } from "@/lib/api";
import {
  createLoanerDevice,
  type LoanerDevice,
  updateLoanerDevice,
} from "@/lib/api-loaners";

interface Props {
  /** Present when editing an existing unit; absent = register a new one. */
  device?: LoanerDevice;
  onClose: () => void;
  onSaved: () => void;
}

export default function LoanerDeviceModal({ device, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState(device?.label ?? "");
  const [brand, setBrand] = useState(device?.brand ?? "");
  const [model, setModel] = useState(device?.model ?? "");
  const [imei, setImei] = useState(device?.imei ?? "");
  const [notes, setNotes] = useState(device?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const isDirty =
    label.trim() !== (device?.label ?? "") ||
    brand.trim() !== (device?.brand ?? "") ||
    model.trim() !== (device?.model ?? "") ||
    imei.trim() !== (device?.imei ?? "") ||
    notes.trim() !== (device?.notes ?? "");

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardDialog(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  useModalEffects(true, handleClose, dialogRef);

  const valid = label.trim().length > 0;

  const submit = async () => {
    if (!valid) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (device) {
        await updateLoanerDevice(device.id, {
          brand: brand.trim(),
          imei: imei.trim(),
          label: label.trim(),
          model: model.trim(),
          notes: notes.trim(),
        });
      } else {
        await createLoanerDevice({
          brand: brand.trim(),
          imei: imei.trim(),
          label: label.trim(),
          model: model.trim(),
          notes: notes.trim(),
        });
      }
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, t("loaners.save_failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      aria-labelledby="ld-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      ref={dialogRef}
      role="dialog"
    >
      <button
        aria-label={t("close")}
        className="absolute inset-0 bg-overlay"
        onClick={handleClose}
        type="button"
      />
      <ConfirmDiscardDialog
        onDiscard={onClose}
        onKeepEditing={() => setShowDiscardDialog(false)}
        open={showDiscardDialog}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 bg-surface-container-low px-6 py-4">
          <Icon className="text-2xl text-primary" name="phone_iphone" />
          <div className="flex-1">
            <h2
              className="font-bold font-headline text-lg text-on-surface"
              id="ld-title"
            >
              {device ? t("loaners.edit") : t("loaners.new")}
            </h2>
            <p className="font-label text-on-surface-variant text-xs">
              {t("loaners.new_subtitle")}
            </p>
          </div>
          <button
            aria-label={t("close")}
            className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high"
            onClick={handleClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <Field label={t("loaners.col_label")}>
            <Input
              id="ld-label"
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("loaners.label_placeholder")}
              type="text"
              value={label}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("loaners.brand")}>
              <Input
                id="ld-brand"
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Apple"
                type="text"
                value={brand}
              />
            </Field>
            <Field label={t("loaners.model")}>
              <Input
                id="ld-model"
                onChange={(e) => setModel(e.target.value)}
                placeholder="iPhone 8"
                type="text"
                value={model}
              />
            </Field>
          </div>

          <Field label={t("loaners.imei")}>
            <Input
              id="ld-imei"
              onChange={(e) => setImei(e.target.value)}
              type="text"
              value={imei}
            />
          </Field>

          <Field label={t("loaners.notes")}>
            <Textarea
              className="min-h-20 resize-y"
              id="ld-notes"
              onChange={(e) => setNotes(e.target.value)}
              value={notes}
            />
          </Field>

          {error && <p className="text-error text-sm">{error}</p>}
        </div>

        <footer className="flex shrink-0 gap-3 border-outline-variant border-t bg-surface-container-low px-6 py-4">
          <button
            className="flex-1 rounded-xl bg-surface-container-high px-4 py-3 font-bold font-headline text-on-surface text-sm"
            onClick={handleClose}
            type="button"
          >
            {t("cancel")}
          </button>
          <button
            className="flex-1 rounded-xl bg-primary px-4 py-3 font-bold font-headline text-on-primary text-sm disabled:opacity-50"
            disabled={!valid || saving}
            onClick={submit}
            type="button"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
