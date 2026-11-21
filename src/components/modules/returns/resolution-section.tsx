import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCan } from "@/hooks/use-can";
import {
  resolveClaim as resolveClaimApi,
  spawnRework as spawnReworkApi,
} from "@/lib/api-return-claims";
import { useUiStore } from "@/stores/ui";
import type { ReturnClaimDetail } from "@/types/return-claim";

interface Props {
  claim: ReturnClaimDetail;
}

export default function ResolutionSection({ claim }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const canRework = useCan({ returns: ["resolveRework"] });
  const canRefund = useCan({ returns: ["resolveRefund"] });

  const [partialCharge, setPartialCharge] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [path, setPath] = useState<"rework" | "refund">("rework");
  const [isSpawning, setSpawning] = useState(false);
  const [isResolving, setResolving] = useState(false);

  if (claim.status === "RESOLVED") {
    return (
      <section className="rounded-2xl bg-surface-container-low p-5">
        <h2 className="font-bold text-on-surface">
          {t("returns_resolution_title")}
        </h2>
        <p className="mt-2 text-on-surface">
          {t("returns_resolution_resolved_outcome", {
            outcome: t(
              `returns_outcome_${claim.resolutionOutcome?.toLowerCase()}`
            ),
          })}
        </p>
        {claim.resolvedAt && (
          <p className="text-on-surface-variant text-sm">
            {t("returns_resolution_resolved_at", {
              date: new Date(claim.resolvedAt).toLocaleString(i18n.language),
            })}
          </p>
        )}
      </section>
    );
  }

  const faultMissing = !claim.faultCategory;

  const handleSpawnRework = async () => {
    setSpawning(true);
    try {
      const r = await spawnReworkApi(claim.id);
      toast.success(t("returns_toast_rework_spawned"));
      // Same post-creation step as intake: offer the QR label for the unit.
      useUiStore.getState().showPrintPreview(r.reworkJobId);
      navigate(`/jobs/${r.reworkJobId}`);
    } finally {
      setSpawning(false);
    }
  };

  const handleResolve = async (
    outcome: string,
    extra?: Record<string, unknown>
  ) => {
    setResolving(true);
    try {
      await resolveClaimApi(claim.id, { resolutionOutcome: outcome, ...extra });
      toast.success(t("returns_toast_resolved"));
    } finally {
      setResolving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl bg-surface-container-low p-5">
      <h2 className="font-bold text-on-surface">
        {t("returns_resolution_title")}
      </h2>
      <p className="text-on-surface-variant text-sm">
        {t("returns_resolution_choose_path")}
      </p>

      <div className="flex gap-2">
        <Button
          onClick={() => setPath("rework")}
          size="sm"
          type="button"
          variant={path === "rework" ? "primary" : "ghost"}
        >
          {t("returns_resolution_path_rework")}
        </Button>
        <Button
          disabled={!canRefund}
          onClick={() => setPath("refund")}
          size="sm"
          type="button"
          variant={path === "refund" ? "primary" : "ghost"}
        >
          {t("returns_resolution_path_refund")}
        </Button>
      </div>

      {path === "rework" && (
        <div className="space-y-3">
          {!claim.reworkJob && (
            <Button
              disabled={!canRework || faultMissing || isSpawning}
              loading={isSpawning}
              onClick={handleSpawnRework}
              size="sm"
              type="button"
              variant="primary"
            >
              {t("returns_resolution_spawn_rework")}
            </Button>
          )}

          {claim.reworkJob && claim.reworkJob.status !== "DELIVERED" && (
            <p className="text-on-surface-variant text-sm">
              {t("returns_resolution_rework_pending")}{" "}
              <Link className="underline" to={`/jobs/${claim.reworkJob.id}`}>
                {claim.reworkJob.jobCode}
              </Link>
            </p>
          )}

          {claim.reworkJob && claim.reworkJob.status === "DELIVERED" && (
            <div className="space-y-3">
              <p className="text-sm">
                {t("returns_resolution_rework_delivered")}
              </p>
              <Button
                disabled={!canRework || faultMissing || isResolving}
                loading={isResolving}
                onClick={() => handleResolve("REWORK_FREE")}
                size="sm"
                type="button"
                variant="primary"
              >
                {t("returns_resolution_resolve_rework_free")}
              </Button>

              <div className="flex items-center gap-2">
                <div className="w-40">
                  <Input
                    aria-label={t("returns_resolution_partial_charge_label")}
                    min={1}
                    onChange={(e) => setPartialCharge(e.target.value)}
                    placeholder={t("returns_resolution_partial_charge_label")}
                    type="number"
                    value={partialCharge}
                  />
                </div>
                <Button
                  disabled={!canRework || faultMissing || isResolving}
                  loading={isResolving}
                  onClick={() => {
                    const amount = Number(partialCharge);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      return;
                    }
                    handleResolve("REWORK_PARTIAL_CHARGE", {
                      partialChargeAmount: amount,
                    });
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {t("returns_resolution_resolve_rework_partial")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {path === "refund" && canRefund && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <Input
              aria-label={t("returns_resolution_refund_amount_label")}
              min={1}
              onChange={(e) => setRefundAmount(e.target.value)}
              placeholder={t("returns_resolution_refund_amount_label")}
              type="number"
              value={refundAmount}
            />
          </div>
          <Button
            disabled={faultMissing || isResolving}
            loading={isResolving}
            onClick={() => {
              const amount = Number(refundAmount);
              if (!Number.isFinite(amount) || amount <= 0) {
                return;
              }
              handleResolve("REFUND_PARTIAL", { refundAmount: amount });
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("returns_resolution_resolve_refund_partial")}
          </Button>
          <Button
            disabled={faultMissing || isResolving}
            loading={isResolving}
            onClick={() => handleResolve("REFUND_FULL")}
            size="sm"
            type="button"
            variant="primary"
          >
            {t("returns_resolution_resolve_refund_full")}
          </Button>
        </div>
      )}
    </section>
  );
}
