import type { TimeRangePreset } from "@shared/types/reports";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/use-can";
import { useReportsStore } from "@/stores/reports";
import CashTab from "./cash-tab";
import InsightsTab from "./insights-tab";
import OperationsTab from "./operations-tab";
import PartsConsumptionTab from "./parts-consumption-tab";
import ReturnsTab from "./returns-tab";
import RevenueTab from "./revenue-tab";

const RANGE_OPTIONS: { key: TimeRangePreset; label: string }[] = [
  { key: "7d", label: "reports.7d" },
  { key: "30d", label: "reports.30d" },
  { key: "month", label: "reports.month" },
  { key: "year", label: "reports.year" },
];

type TabKey =
  | "revenue"
  | "cash"
  | "operations"
  | "returns"
  | "insights"
  | "parts";

export default function ReportsPage() {
  const { t } = useTranslation();
  const range = useReportsStore((s) => s.range);
  const setRange = useReportsStore((s) => s.setRange);
  const fetchRevenue = useReportsStore((s) => s.fetchRevenue);
  const fetchCash = useReportsStore((s) => s.fetchCash);
  const fetchOperations = useReportsStore((s) => s.fetchOperations);
  const fetchInsights = useReportsStore((s) => s.fetchInsights);
  const fetchReturns = useReportsStore((s) => s.fetchReturns);
  const fetchPartsConsumption = useReportsStore((s) => s.fetchPartsConsumption);

  const canViewShop = useCan({ reports: ["viewShop"] });
  const canViewSelf = useCan({ reports: ["viewSelf"] });
  const canViewReturns = useCan({ returns: ["viewSelf"] });
  const canViewPartsCost = useCan({ parts: ["viewCost"] });

  const visibleTabs = useMemo<TabKey[]>(() => {
    const tabs: TabKey[] = [];
    if (canViewShop) {
      tabs.push("revenue");
    }
    if (canViewShop) {
      tabs.push("cash");
    }
    if (canViewSelf) {
      tabs.push("operations");
    }
    if (canViewReturns) {
      tabs.push("returns");
    }
    if (canViewShop) {
      tabs.push("insights");
    }
    if (canViewPartsCost) {
      tabs.push("parts");
    }
    return tabs;
  }, [canViewShop, canViewSelf, canViewReturns, canViewPartsCost]);

  const [activeTab, setActiveTab] = useState<TabKey | null>(
    visibleTabs[0] ?? null
  );

  useEffect(() => {
    if (!range) {
      return;
    }
    if (activeTab === "revenue") {
      fetchRevenue();
    }
    if (activeTab === "cash") {
      fetchCash();
    }
    if (activeTab === "operations") {
      fetchOperations();
    }
    if (activeTab === "insights") {
      fetchInsights();
    }
    if (activeTab === "returns") {
      fetchReturns();
    }
    if (activeTab === "parts") {
      fetchPartsConsumption();
    }
  }, [
    activeTab,
    range,
    fetchRevenue,
    fetchCash,
    fetchOperations,
    fetchInsights,
    fetchReturns,
    fetchPartsConsumption,
  ]);

  useEffect(() => {
    if (
      !(activeTab && visibleTabs.includes(activeTab)) &&
      visibleTabs.length > 0
    ) {
      setActiveTab(visibleTabs[0]);
    }
    if (visibleTabs.length === 0) {
      setActiveTab(null);
    }
  }, [visibleTabs, activeTab]);

  if (visibleTabs.length === 0) {
    return (
      <div className="rounded-3xl bg-surface-container-low p-8 text-center">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-5xl text-on-surface-variant/40"
        >
          lock
        </span>
        <h1 className="mt-4 font-black font-headline text-2xl text-on-surface">
          {t("reports.title")}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-on-surface-variant text-sm">
          {t("errors.forbidden")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-black font-headline text-2xl text-on-surface">
            {t("reports.title")}
          </h1>
          <p className="mt-1 text-on-surface-variant text-sm">
            {t("currency_eur")} /{" "}
            {t(
              RANGE_OPTIONS.find((option) => option.key === range)?.label ??
                "reports.30d"
            )}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-surface-container-low p-1">
          {RANGE_OPTIONS.map(({ key, label }) => (
            <button
              className={`min-h-11 rounded-lg px-4 font-medium text-sm transition-colors ${
                range === key
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-primary"
              }`}
              key={key}
              onClick={() => setRange(key)}
              type="button"
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {visibleTabs.length > 1 && (
        <div className="flex gap-1 rounded-xl bg-surface-container-low p-1">
          {visibleTabs.map((tab) => (
            <button
              className={`min-h-11 rounded-lg px-4 font-medium text-sm transition-colors ${
                activeTab === tab
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-primary"
              }`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {t(`reports.${tab}`)}
            </button>
          ))}
        </div>
      )}

      {activeTab === "revenue" && <RevenueTab />}
      {activeTab === "cash" && <CashTab />}
      {activeTab === "operations" && <OperationsTab />}
      {activeTab === "returns" && <ReturnsTab />}
      {activeTab === "insights" && <InsightsTab />}
      {activeTab === "parts" && <PartsConsumptionTab />}
    </div>
  );
}
