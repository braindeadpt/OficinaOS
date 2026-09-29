import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useTechnicians } from "@/hooks/use-technicians";
import { useJobsStore } from "@/stores/jobs";

interface TechnicianSelectProps {
  currentTechnicianId?: string | null;
  currentTechnicianName?: string | null;
  jobId: string;
  onChanged?: () => void;
  size?: "sm" | "md";
}

export default function TechnicianSelect({
  currentTechnicianId,
  currentTechnicianName,
  jobId,
  onChanged,
  size = "md",
}: TechnicianSelectProps) {
  const { t } = useTranslation();
  const canEdit = useCan({ jobs: ["edit"] });
  const { technicians, isLoading } = useTechnicians();
  const updateJob = useJobsStore((s) => s.updateJob);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const handleChange = useCallback(
    async (techId: string) => {
      const value = techId === "__none__" ? null : techId;
      setAssigning(true);
      setError(null);
      try {
        await updateJob(jobId, { technicianId: value });
        toast.success(t("jobs_technician_assigned_success"));
        onChanged?.();
      } catch {
        setError(t("jobs_technician_assign_error"));
        if (selectRef.current) {
          selectRef.current.value = currentTechnicianId ?? "__none__";
        }
      } finally {
        setAssigning(false);
      }
    },
    [jobId, updateJob, onChanged, currentTechnicianId, t]
  );

  if (!canEdit) {
    return (
      <span
        className={`font-body font-medium ${size === "sm" ? "text-xs" : "text-sm"}`}
      >
        {currentTechnicianName ?? t("unassigned")}
      </span>
    );
  }

  if (isLoading) {
    return (
      <span
        aria-busy="true"
        className={`font-body text-on-surface-variant ${size === "sm" ? "text-xs" : "text-sm"}`}
        role="status"
      >
        {t("loading")}
      </span>
    );
  }

  const selectClass =
    size === "sm"
      ? "rounded-lg border border-outline-variant bg-surface-container-low px-2 py-1 font-body text-xs text-on-surface focus:border-primary"
      : "rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 font-body text-sm text-on-surface focus:border-primary";

  return (
    <div className="flex flex-col gap-0.5">
      <select
        aria-label={t("technician")}
        className={selectClass}
        disabled={assigning}
        onChange={(e) => handleChange(e.target.value)}
        ref={selectRef}
        value={currentTechnicianId ?? "__none__"}
      >
        <option value="__none__">{t("unassigned")}</option>
        {technicians.map((tech) => (
          <option key={tech.id} value={tech.id}>
            {tech.name}
          </option>
        ))}
      </select>
      {error && <span className="font-label text-error text-xs">{error}</span>}
    </div>
  );
}
