import {
  type CheckState,
  INTAKE_CHECK_ITEMS,
  type IntakeChecklist,
  labelCls,
} from "./types";

interface FunctionalChecklistProps {
  onChange: (checklist: IntakeChecklist) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  value: IntakeChecklist;
}

const STATES: { key: "ok" | "fail"; labelKey: string }[] = [
  { key: "ok", labelKey: "intake.check_ok" },
  { key: "fail", labelKey: "intake.check_fail" },
];

export default function FunctionalChecklist({
  onChange,
  t,
  value,
}: FunctionalChecklistProps) {
  const set = (item: string, state: CheckState) => {
    const next = { ...value };
    if (state === null || value[item] === state) {
      delete next[item];
    } else {
      next[item] = state;
    }
    onChange(next);
  };

  return (
    <fieldset>
      <legend className={labelCls}>{t("intake.checklist_section")}</legend>
      <div className="space-y-2">
        {INTAKE_CHECK_ITEMS.map((item) => {
          const current = value[item] ?? null;
          return (
            <div
              className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-highest px-4 py-2.5"
              key={item}
            >
              <span className="font-label text-on-surface text-sm">
                {t(`intake.check_${item}`)}
              </span>
              <div className="flex gap-1.5">
                {STATES.map(({ key, labelKey }) => {
                  const active = current === key;
                  const activeCls =
                    key === "ok"
                      ? "bg-primary font-bold text-on-primary"
                      : "bg-error font-bold text-on-error";
                  return (
                    <button
                      aria-pressed={active}
                      className={`min-h-[36px] min-w-[52px] rounded-lg px-3 font-label text-xs transition-colors ${
                        active
                          ? activeCls
                          : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                      }`}
                      key={key}
                      onClick={() => set(item, key)}
                      type="button"
                    >
                      {t(labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="ms-1 mt-1.5 font-label text-on-surface-variant text-xs">
        {t("intake.checklist_hint")}
      </p>
    </fieldset>
  );
}
