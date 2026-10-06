import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";

interface ReadyItem {
  customerName: string;
  customerPhone: string;
  deviceModel: string;
  id: string;
  jobCode: string;
  readyAt: string;
}

const DAY_MS = 86_400_000;

function daysWaiting(readyAt: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(readyAt).getTime()) / DAY_MS)
  );
}

export default function ReadyForPickup({ items }: { items: ReadyItem[] }) {
  const { t } = useTranslation();

  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-container-low p-6 ring-1 ring-surface-container-low/50 transition-all">
      <div className="mb-6 flex items-center gap-2">
        <Icon
          className="text-on-secondary-container"
          name="inventory_2"
          size="lg"
        />
        <h3 className="font-extrabold font-headline text-on-surface text-sm uppercase tracking-tight">
          {t("dashboard_page.ready_for_pickup")}
        </h3>
        {items.length > 0 && (
          <span className="ms-auto rounded-full bg-secondary-container px-2 py-0.5 font-black text-on-secondary-container text-xs">
            {String(items.length).padStart(2, "0")}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <p className="text-on-surface-variant text-sm">
            {t("dashboard_page.pickup_empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const days = daysWaiting(item.readyAt);
            return (
              <div
                className="rounded-lg bg-surface-container-low/50 p-3 ring-1 ring-surface-container-low"
                key={item.id}
              >
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-bold text-on-surface text-xs">
                    {item.customerName}
                  </p>
                  <span
                    className={`font-black text-xs uppercase ${
                      days >= 3 ? "text-error" : "text-on-secondary-container"
                    }`}
                  >
                    {t("dashboard_page.ready_ago", { days })}
                  </span>
                </div>
                <p className="text-on-surface-variant text-xs">
                  {item.jobCode} &bull; {item.deviceModel}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
