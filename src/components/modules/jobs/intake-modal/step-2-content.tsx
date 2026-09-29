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

        <div>
          <label className={labelCls} htmlFor="condition-notes">
            {t("intake.condition_notes")}
          </label>
          <textarea
            className={textareaCls}
            id="condition-notes"
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
                className="h-12 w-full max-w-[160px] rounded-xl bg-surface-container-highest px-4 text-on-surface transition-all focus:bg-surface-container-lowest"
                id="estimated-cost"
                inputMode="decimal"
                min="0"
                onChange={(e) => update("estimatedCost", e.target.value)}
                placeholder="0"
                step="0.01"
                type="number"
                value={form.estimatedCost}
              />
              <span className="font-label text-on-surface-variant text-sm">
                {t("currency_eur")}
              </span>
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="deposit">
              {t("intake.required_deposit")}
            </label>
            <div className="flex items-center gap-2">
              <input
                className="h-12 w-full max-w-[160px] rounded-xl bg-surface-container-highest px-4 text-on-surface transition-all focus:bg-surface-container-lowest"
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
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="delivery-date">
            {t("intake.delivery_date")}
          </label>
          <input
            className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface transition-all focus:bg-surface-container-lowest"
            id="delivery-date"
            onChange={(e) => update("estimatedDelivery", e.target.value)}
            type="date"
            value={form.estimatedDelivery}
          />
        </div>
      </div>
    </section>
  );
}
