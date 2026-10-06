import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";

type AlertVariant = "error" | "secondary" | "tertiary";

interface Alert {
  description: string;
  icon: string;
  id: string;
  title: string;
  variant: AlertVariant;
}

const ALERT_STYLES: Record<AlertVariant, string> = {
  error: "bg-error-container text-on-error-container",
  secondary: "bg-secondary-container text-on-secondary-container",
  tertiary: "bg-tertiary-container text-on-tertiary-container",
};

const ALERT_ICON_COLORS: Record<AlertVariant, string> = {
  error: "text-error",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
};

interface PriorityAlertsPanelProps {
  alerts: Alert[];
}

export default function PriorityAlertsPanel({
  alerts,
}: PriorityAlertsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-fit flex-col gap-8 rounded-xl bg-surface-container-high p-6">
      <div>
        <h2 className="mb-4 font-bold font-headline text-lg">
          {t("front_desk.priority_alerts")}
        </h2>
        {alerts.length === 0 ? (
          <p className="font-medium text-on-surface-variant text-sm">
            {t("front_desk.no_alerts")}
          </p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                className={`flex items-start gap-3 rounded-xl p-4 ${ALERT_STYLES[alert.variant]}`}
                key={alert.id}
              >
                <Icon
                  className={`${ALERT_ICON_COLORS[alert.variant]}`}
                  name={alert.icon}
                />
                <div>
                  <p className="font-bold text-sm">{alert.title}</p>
                  <p className="text-xs opacity-80">{alert.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
