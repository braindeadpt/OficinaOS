import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useJobsStore } from "@/stores/jobs";

export default function QuickIntakeForm() {
  const { t } = useTranslation();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deviceBrand, setDeviceBrand] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [reportedProblem, setReportedProblem] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [expanded, setExpanded] = useState(false);
  const isCreating = useJobsStore((s) => s.isCreatingJob);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await useJobsStore.getState().createJob({
        customerName,
        customerPhone,
        deviceBrand,
        deviceModel,
        reportedProblem,
        // Empty = "por orçamentar" — priced after diagnosis.
        estimatedCost:
          estimatedCost.trim() === ""
            ? undefined
            : Number.parseFloat(estimatedCost) || 0,
      });
      setCustomerName("");
      setCustomerPhone("");
      setDeviceBrand("");
      setDeviceModel("");
      setReportedProblem("");
      setEstimatedCost("");
      setExpanded(false);
    } catch {
      // Error is handled by the store
    }
  };

  return (
    <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-premium">
      <button
        aria-expanded={expanded}
        className="flex min-h-16 w-full items-center justify-between bg-primary-fixed/60 p-6 text-start transition-colors hover:bg-primary-fixed"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <h2 className="font-bold font-headline text-xl">
          {t("front_desk.quick_intake")}
        </h2>
        <span className="material-symbols-outlined text-primary transition-transform duration-200">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>

      {expanded && (
        <form className="space-y-4 px-6 pb-6" onSubmit={handleSubmit}>
          <Field label={t("front_desk.customer_name")} required>
            <Input
              maxLength={120}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t("front_desk.customer_name_placeholder")}
              required
              type="text"
              value={customerName}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("front_desk.phone")} required>
              <Input
                maxLength={32}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder={t("front_desk.phone_placeholder")}
                required
                type="tel"
                value={customerPhone}
              />
            </Field>
            <Field label={t("front_desk.device_brand")} required>
              <Input
                maxLength={60}
                onChange={(e) => setDeviceBrand(e.target.value)}
                placeholder={t("front_desk.device_brand_placeholder")}
                required
                type="text"
                value={deviceBrand}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("front_desk.device_model")} required>
              <Input
                maxLength={120}
                onChange={(e) => setDeviceModel(e.target.value)}
                placeholder={t("front_desk.device_model_placeholder")}
                required
                type="text"
                value={deviceModel}
              />
            </Field>
            <Field label={t("front_desk.estimated_cost")}>
              <Input
                min={0}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder={t("intake.estimated_cost_pending")}
                step="0.01"
                type="number"
                value={estimatedCost}
              />
            </Field>
          </div>
          <Field label={t("front_desk.issue_description")} required>
            <Textarea
              maxLength={2000}
              onChange={(e) => setReportedProblem(e.target.value)}
              placeholder={t("front_desk.issue_placeholder")}
              required
              rows={3}
              value={reportedProblem}
            />
          </Field>
          <Button
            className="mt-2 w-full"
            disabled={isCreating}
            loading={isCreating}
            size="lg"
          >
            {isCreating
              ? t("front_desk.creating_job")
              : t("intake.start_repair")}
          </Button>
        </form>
      )}
    </div>
  );
}
