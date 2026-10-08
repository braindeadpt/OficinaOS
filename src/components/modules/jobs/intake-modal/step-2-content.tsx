import SignaturePad from "@/components/reports/signature-pad";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import AccessoriesPicker from "./accessories-picker";
import FunctionalChecklist from "./functional-checklist";
import {
  errorCls,
  type IntakeFormData,
  labelCls,
  requiredMarkCls,
  textareaCls,
  textareaErrorCls,
} from "./types";

interface Step2Props {
  errors: Partial<Record<keyof IntakeFormData, string>>;
  form: IntakeFormData;
  handleBlur: (field: keyof IntakeFormData) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  touched: Partial<Record<keyof IntakeFormData, boolean>>;
  update: <K extends keyof IntakeFormData>(
    key: K,
    value: IntakeFormData[K]
  ) => void;
}

export default function Step2Content({
  errors,
  form,
  handleBlur,
  t,
  touched,
  update,
}: Step2Props) {
  // Shown once the field was touched or the server flagged it on submit.
  const fieldError = (key: keyof IntakeFormData) =>
    touched[key] ? errors[key] : undefined;
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-4 md:p-8">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <label className={labelCls} htmlFor="reported-problem">
            {t("intake.reported_problem")}
            <span className={requiredMarkCls}>*</span>
          </label>
          <textarea
            aria-describedby={
              errors.reportedProblem && touched.reportedProblem
                ? "error-reported-problem"
                : undefined
            }
            aria-invalid={!!errors.reportedProblem}
            className={errors.reportedProblem ? textareaErrorCls : textareaCls}
            id="reported-problem"
            maxLength={2000}
            onBlur={() => handleBlur("reportedProblem")}
            onChange={(e) => update("reportedProblem", e.target.value)}
            placeholder={t("intake.reported_problem_placeholder")}
            required
            rows={4}
            value={form.reportedProblem}
          />
          {errors.reportedProblem && touched.reportedProblem && (
            <p className={errorCls} id="error-reported-problem">
              {errors.reportedProblem}
            </p>
          )}
        </div>

        <AccessoriesPicker
          onChange={(v) => update("accessories", v)}
          t={t}
          value={form.accessories}
        />

        <FunctionalChecklist
          onChange={(v) => update("checklist", v)}
          t={t}
          value={form.checklist}
        />

        <div>
          <label className={labelCls} htmlFor="condition-notes">
            {t("intake.condition_notes")}
          </label>
          <textarea
            className={textareaCls}
            id="condition-notes"
            maxLength={2000}
            onChange={(e) => update("conditionNotes", e.target.value)}
            placeholder={t("intake.condition_notes_placeholder")}
            rows={2}
            value={form.conditionNotes}
          />
        </div>

        <div className="grid grid-cols-2 gap-6 py-4">
          <div>
            <label className={labelCls} htmlFor="estimated-cost">
              {t("intake.estimated_cost")}
            </label>
            <div className="flex items-center gap-2">
              <input
                aria-describedby={
                  fieldError("estimatedCost")
                    ? "error-estimated-cost"
                    : undefined
                }
                aria-invalid={!!fieldError("estimatedCost")}
                className={`h-12 w-full max-w-[160px] rounded-xl bg-surface-container-highest px-4 text-on-surface transition-all focus:bg-surface-container-lowest ${
                  fieldError("estimatedCost") ? "ring-2 ring-error" : ""
                }`}
                id="estimated-cost"
                inputMode="decimal"
                min="0"
                onChange={(e) => update("estimatedCost", e.target.value)}
                placeholder={t("intake.estimated_cost_pending")}
                step="0.01"
                type="number"
                value={form.estimatedCost}
              />
              <span className="font-label text-on-surface-variant text-sm">
                {t("currency_eur")}
              </span>
            </div>
            {fieldError("estimatedCost") && (
              <p className={errorCls} id="error-estimated-cost">
                {fieldError("estimatedCost")}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="deposit">
              {t("intake.required_deposit")}
            </label>
            <div className="flex items-center gap-2">
              <input
                aria-describedby={
                  fieldError("deposit") ? "error-deposit" : undefined
                }
                aria-invalid={!!fieldError("deposit")}
                className={`h-12 w-full max-w-[160px] rounded-xl bg-surface-container-highest px-4 text-on-surface transition-all focus:bg-surface-container-lowest ${
                  fieldError("deposit") ? "ring-2 ring-error" : ""
                }`}
                id="deposit"
                inputMode="decimal"
                min="0"
                onChange={(e) => update("deposit", e.target.value)}
                placeholder="0"
                step="0.01"
                type="number"
                value={form.deposit}
              />
              <span className="font-label text-on-surface-variant text-sm">
                {t("currency_eur")}
              </span>
            </div>
            {fieldError("deposit") && (
              <p className={errorCls} id="error-deposit">
                {fieldError("deposit")}
              </p>
            )}
          </div>
        </div>

        <LoanerField
          fieldError={fieldError}
          form={form}
          handleBlur={handleBlur}
          t={t}
          update={update}
        />

        <div>
          <label className={labelCls} htmlFor="delivery-date">
            {t("intake.delivery_date")}
          </label>
          <input
            aria-describedby={
              fieldError("estimatedDelivery")
                ? "error-delivery-date"
                : undefined
            }
            aria-invalid={!!fieldError("estimatedDelivery")}
            className={`h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface transition-all focus:bg-surface-container-lowest ${
              fieldError("estimatedDelivery") ? "ring-2 ring-error" : ""
            }`}
            id="delivery-date"
            onChange={(e) => update("estimatedDelivery", e.target.value)}
            type="datetime-local"
            value={form.estimatedDelivery}
          />
          {fieldError("estimatedDelivery") && (
            <p className={errorCls} id="error-delivery-date">
              {fieldError("estimatedDelivery")}
            </p>
          )}
        </div>

        <button
          aria-pressed={form.isUrgent}
          className={`flex w-full items-center justify-between rounded-xl px-4 py-3 transition-colors ${
            form.isUrgent
              ? "bg-error-container ring-2 ring-error/40"
              : "bg-surface-container-highest hover:bg-surface-container"
          }`}
          onClick={() => update("isUrgent", !form.isUrgent)}
          type="button"
        >
          <span className="flex items-center gap-2 font-label text-on-surface text-sm">
            <Icon
              className={`text-lg ${
                form.isUrgent ? "text-error" : "text-on-surface-variant"
              }`}
              name="priority_high"
            />
            {t("intake.urgent")}
          </span>
          <span
            className={`font-label text-xs ${
              form.isUrgent ? "font-bold text-error" : "text-on-surface-variant"
            }`}
          >
            {form.isUrgent ? t("intake.urgent_on") : t("intake.urgent_off")}
          </span>
        </button>

        <div>
          <span className={labelCls}>{t("intake.terms_title")}</span>
          <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-on-surface-variant text-xs leading-relaxed ring-1 ring-outline-variant">
            {t("intake.terms_text")}
          </p>
          <div className="mt-3">
            <SignaturePad onChange={(v) => update("signature", v)} />
            {form.signature && (
              <p className="ms-1 mt-1 flex items-center gap-1 font-label text-success text-xs">
                <Icon className="text-sm" name="check_circle" />
                {t("intake.signature_captured")}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

interface LoanerFieldProps {
  fieldError: (key: keyof IntakeFormData) => string | undefined;
  form: IntakeFormData;
  handleBlur: (field: keyof IntakeFormData) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  update: <K extends keyof IntakeFormData>(
    key: K,
    value: IntakeFormData[K]
  ) => void;
}

function LoanerField({
  fieldError,
  form,
  handleBlur,
  t,
  update,
}: LoanerFieldProps) {
  const active = form.hasLoanerDevice;
  return (
    <div className="space-y-4">
      <button
        aria-pressed={active}
        className={`flex w-full items-center justify-between rounded-xl px-4 py-3 transition-colors ${
          active
            ? "bg-primary-container ring-2 ring-primary/40"
            : "bg-surface-container-highest hover:bg-surface-container"
        }`}
        onClick={() => update("hasLoanerDevice", !active)}
        type="button"
      >
        <span className="flex items-center gap-2 font-label text-on-surface text-sm">
          <Icon
            className={`text-lg ${
              active ? "text-primary" : "text-on-surface-variant"
            }`}
            name="phone_iphone"
          />
          {t("intake.loaner_device")}
        </span>
        <span
          className={`font-label text-xs ${
            active ? "font-bold text-primary" : "text-on-surface-variant"
          }`}
        >
          {active ? t("intake.loaner_on") : t("intake.loaner_off")}
        </span>
      </button>

      {active && (
        <Field
          error={fieldError("loanerNote")}
          id="loaner-note"
          label={t("intake.loaner_note")}
        >
          <Input
            maxLength={200}
            onBlur={() => handleBlur("loanerNote")}
            onChange={(e) => update("loanerNote", e.target.value)}
            placeholder={t("intake.loaner_note_placeholder")}
            type="text"
            value={form.loanerNote}
          />
        </Field>
      )}
    </div>
  );
}
