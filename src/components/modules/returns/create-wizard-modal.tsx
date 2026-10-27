import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createReturnClaim } from "@/lib/api-return-claims";
import WarrantyBadge from "./warranty-badge";

interface JobLine {
  daysSinceDelivered: number | null;
  id: string;
  kind: "repair" | "part";
  name: string;
  warrantyDays: number;
}

interface Props {
  onClose: () => void;
  onCreateNewPaidJob: () => void;
  open: boolean;
  originalJob: {
    customer: { id: string; name: string };
    id: string;
    jobCode: string;
    parts: JobLine[];
    repairs: JobLine[];
  };
}

type Selection =
  | { id: string; kind: "repair" }
  | { id: string; kind: "part" }
  | { kind: "other" };

export default function CreateWizardModal({
  open,
  onClose,
  originalJob,
  onCreateNewPaidJob,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [selection, setSelection] = useState<Selection>({ kind: "other" });
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const canNext = step === 1 && reason.trim().length > 0;

  const submitAccept = async () => {
    let payload: {
      claimedJobPartId?: string;
      claimedJobRepairId?: string;
      originalJobId: string;
      returnReason: string;
    };
    if (selection.kind === "repair") {
      payload = {
        originalJobId: originalJob.id,
        claimedJobRepairId: selection.id,
        returnReason: reason,
      };
    } else if (selection.kind === "part") {
      payload = {
        originalJobId: originalJob.id,
        claimedJobPartId: selection.id,
        returnReason: reason,
      };
    } else {
      payload = { originalJobId: originalJob.id, returnReason: reason };
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createReturnClaim(payload);
      toast.success(t("returns_toast_created"));
      onClose();
      navigate(`/returns/${created.id}`);
    } catch {
      // Keep the wizard open with the reason intact so the user can retry.
      setSubmitError(t("returns_wizard_submit_error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      description={
        step === 1 ? t("returns_wizard_select_line_help") : undefined
      }
      dismissible={!submitting}
      onClose={onClose}
      open={open}
      size="lg"
      title={
        step === 1
          ? t("returns_wizard_step1_title")
          : t("returns_wizard_step2_title")
      }
    >
      {step === 1 && (
        <>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {originalJob.repairs.map((r) => (
              <label
                className="flex items-center justify-between rounded-xl bg-surface-container-low p-3 text-sm transition-colors hover:bg-surface-container"
                key={r.id}
              >
                <span className="flex items-center gap-2">
                  <input
                    checked={
                      selection.kind === "repair" && selection.id === r.id
                    }
                    name="line"
                    onChange={() => setSelection({ kind: "repair", id: r.id })}
                    type="radio"
                  />
                  {r.name}
                </span>
                <WarrantyBadge
                  daysSinceDelivered={r.daysSinceDelivered}
                  warrantyDays={r.warrantyDays}
                />
              </label>
            ))}
            {originalJob.parts.map((p) => (
              <label
                className="flex items-center justify-between rounded-xl bg-surface-container-low p-3 text-sm transition-colors hover:bg-surface-container"
                key={p.id}
              >
                <span className="flex items-center gap-2">
                  <input
                    checked={selection.kind === "part" && selection.id === p.id}
                    name="line"
                    onChange={() => setSelection({ kind: "part", id: p.id })}
                    type="radio"
                  />
                  {p.name}
                </span>
                <WarrantyBadge
                  daysSinceDelivered={p.daysSinceDelivered}
                  warrantyDays={p.warrantyDays}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 rounded-xl bg-surface-container-low p-3 text-sm transition-colors hover:bg-surface-container">
              <input
                checked={selection.kind === "other"}
                name="line"
                onChange={() => setSelection({ kind: "other" })}
                type="radio"
              />
              {t("returns_wizard_different_problem")}
            </label>
          </div>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium text-on-surface-variant text-xs uppercase tracking-wide">
              {t("returns_wizard_reason_label")}
            </span>
            <textarea
              className="min-h-[80px] w-full rounded-xl border-none bg-surface-container-highest px-4 py-3 text-sm"
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("returns_wizard_reason_placeholder")}
              value={reason}
            />
          </label>

          <div className="mt-4 flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <Button onClick={onClose} size="sm" type="button" variant="ghost">
              {t("returns_wizard_cancel")}
            </Button>
            <Button
              disabled={!canNext}
              onClick={() => {
                setSubmitError(null);
                setStep(2);
              }}
              size="sm"
              type="button"
              variant="primary"
            >
              {t("returns_wizard_next")}
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-2">
          {submitError && (
            <p
              className="rounded-xl bg-error-container px-4 py-3 font-medium text-on-error-container text-sm"
              role="alert"
            >
              {submitError}
            </p>
          )}
          <Button
            disabled={submitting}
            loading={submitting}
            onClick={submitAccept}
            type="button"
            variant="primary"
          >
            {t("returns_wizard_accept")}
          </Button>
          <Button
            disabled={submitting}
            onClick={() => {
              onClose();
              onCreateNewPaidJob();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("returns_wizard_reject")}
          </Button>
          <button
            className="text-on-surface-variant text-sm underline disabled:opacity-50"
            disabled={submitting}
            onClick={() => {
              setSubmitError(null);
              setStep(1);
            }}
            type="button"
          >
            {t("returns_wizard_back")}
          </button>
        </div>
      )}
    </Dialog>
  );
}
