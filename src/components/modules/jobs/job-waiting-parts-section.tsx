import { INACTIVE_STATUSES } from "@shared/constants";
import type { Job } from "@shared/types";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Can } from "@/components/modules/can";
import { useCan } from "@/hooks/use-can";
import { useJobsStore } from "@/stores/jobs";

interface JobWaitingPartsSectionProps {
  job: Job;
  onChanged?: () => void;
}

export default function JobWaitingPartsSection({
  job,
  onChanged,
}: JobWaitingPartsSectionProps) {
  const { t } = useTranslation();
  const addWaitingPart = useJobsStore((s) => s.addWaitingPart);
  const removeWaitingPart = useJobsStore((s) => s.removeWaitingPart);
  const canEdit = useCan({ jobs: ["edit"] });
  const [partName, setPartName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [adding, setAdding] = useState(false);

  const isTerminal = INACTIVE_STATUSES.includes(
    job.status as (typeof INACTIVE_STATUSES)[number]
  );

  const handleAdd = useCallback(async () => {
    if (!partName.trim()) {
      return;
    }
    setAdding(true);
    try {
      await addWaitingPart(
        job.id,
        partName.trim(),
        supplier.trim() || undefined
      );
      setPartName("");
      setSupplier("");
      onChanged?.();
    } catch {
      toast.error(t("errors.add_waiting_part"));
    } finally {
      setAdding(false);
    }
  }, [addWaitingPart, job.id, partName, supplier, onChanged, t]);

  const handleRemove = useCallback(
    async (waitingId: string) => {
      try {
        await removeWaitingPart(job.id, waitingId);
        onChanged?.();
      } catch {
        toast.error(t("errors.remove_waiting_part"));
      }
    },
    [removeWaitingPart, job.id, onChanged, t]
  );

  const parts = job.partsWaiting ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold font-headline text-base text-on-surface">
          {t("jobs_waiting_parts_title")}
        </h2>
      </div>

      {!isTerminal && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            aria-label={t("jobs_waiting_parts_part_name")}
            className="flex-1 rounded-lg bg-surface-container-highest px-3 py-2 text-on-surface text-sm placeholder:text-on-surface-variant/50"
            onChange={(e) => setPartName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canEdit && partName.trim() && !adding) {
                handleAdd();
              }
            }}
            placeholder={t("jobs_waiting_parts_part_name")}
            type="text"
            value={partName}
          />
          <input
            aria-label={t("jobs_waiting_parts_supplier")}
            className="flex-1 rounded-lg bg-surface-container-highest px-3 py-2 text-on-surface text-sm placeholder:text-on-surface-variant/50"
            onChange={(e) => setSupplier(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canEdit && partName.trim() && !adding) {
                handleAdd();
              }
            }}
            placeholder={t("jobs_waiting_parts_supplier")}
            type="text"
            value={supplier}
          />
          <Can perm={{ jobs: ["edit"] }}>
            <button
              className="flex min-h-[44px] items-center gap-1 rounded-lg bg-primary px-4 font-bold font-label text-on-primary text-xs uppercase tracking-wider transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:opacity-50"
              disabled={!partName.trim() || adding}
              onClick={handleAdd}
              type="button"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              {t("jobs_waiting_parts_add")}
            </button>
          </Can>
        </div>
      )}

      {parts.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl bg-surface-container-low/50 py-8">
          <span className="material-symbols-outlined mb-2 text-3xl text-on-surface-variant/60">
            inventory_2
          </span>
          <p className="font-bold font-headline text-on-surface-variant text-sm">
            {t("jobs_waiting_parts_empty_title")}
          </p>
          <p className="mt-1 font-body text-on-surface-variant/80 text-xs">
            {t("jobs_waiting_parts_empty_desc")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {parts.map((wp) => (
            <div
              className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2"
              key={wp.id}
            >
              <div>
                <p className="font-body font-medium text-on-surface text-sm">
                  {wp.partName}
                </p>
                {wp.supplier && (
                  <p className="font-label text-on-surface-variant text-xs">
                    {wp.supplier}
                  </p>
                )}
              </div>
              {!isTerminal && (
                <Can perm={{ jobs: ["edit"] }}>
                  <button
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                    onClick={() => handleRemove(wp.id)}
                    title={t("jobs_waiting_parts_remove")}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">
                      close
                    </span>
                  </button>
                </Can>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
