import { INTAKE_ACCESSORY_ITEMS, labelCls } from "./types";

interface AccessoriesPickerProps {
  onChange: (accessories: string[]) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  value: string[];
}

export default function AccessoriesPicker({
  onChange,
  t,
  value,
}: AccessoriesPickerProps) {
  const toggle = (key: string) => {
    onChange(
      value.includes(key) ? value.filter((a) => a !== key) : [...value, key]
    );
  };

  return (
    <fieldset>
      <legend className={labelCls}>{t("intake.accessories_section")}</legend>
      <div className="flex flex-wrap gap-2">
        {INTAKE_ACCESSORY_ITEMS.map((key) => {
          const active = value.includes(key);
          return (
            <button
              aria-pressed={active}
              className={`min-h-[40px] rounded-full px-4 font-label text-xs transition-colors ${
                active
                  ? "bg-primary font-bold text-on-primary"
                  : "bg-surface-container-highest text-on-surface-variant hover:bg-surface-container"
              }`}
              key={key}
              onClick={() => toggle(key)}
              type="button"
            >
              {t(`intake.accessory_${key}`)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
