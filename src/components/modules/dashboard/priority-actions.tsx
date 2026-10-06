import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";

interface PriorityAction {
  count: number;
  labelKey: string;
  variant: "default" | "warning" | "urgent";
}

interface PriorityActionsProps {
  actions: PriorityAction[];
}

const VARIANT_STYLES: Record<string, string> = {
  default: "bg-surface-container-lowest",
  warning: "bg-tertiary-container",
  urgent: "bg-error-container/50",
};

const BADGE_STYLES: Record<string, string> = {
  default: "bg-primary/10 text-primary",
  warning: "bg-tertiary text-on-tertiary",
  urgent: "bg-error text-on-error",
};

const TEXT_STYLES: Record<string, string> = {
  default: "text-on-surface",
  warning: "text-on-tertiary-container",
  urgent: "text-error",
};

export default function PriorityActions({ actions }: PriorityActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl bg-surface-container-high p-6">
      <h3 className="mb-6 font-bold font-headline text-lg text-on-surface">
        {t("tech_dashboard.priority_actions")}
      </h3>
      <div className="space-y-3">
        {actions.map((action) => (
          <button
            className={`flex w-full items-center gap-3 rounded-xl p-3 text-start transition-colors hover:bg-surface-container-high ${VARIANT_STYLES[action.variant]}`}
            key={action.labelKey}
            type="button"
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-black text-sm ${BADGE_STYLES[action.variant]}`}
            >
              {action.count}
            </span>
            <span
              className={`font-semibold text-xs ${TEXT_STYLES[action.variant]}`}
            >
              {t(action.labelKey)}
            </span>
            <Icon
              className="ms-auto text-on-surface-variant text-sm"
              name="chevron_right"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
