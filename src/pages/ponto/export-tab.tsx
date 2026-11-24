import type { PontoHoursResponse } from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { formatClock, formatMinutes, useShopTz, ymdDaysAgo } from "./shared";

async function downloadPdf(
  data: PontoHoursResponse,
  title: string,
  timeZone: string | undefined,
  locale: string,
  t: TFunction
) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`${data.from} → ${data.to}`, 14, 23);
  doc.text(
    `${t("ponto.pdf_corrected_legend")} ${t("ponto.pdf_missing_legend")}`,
    14,
    28
  );

  const time = (iso: string | null) =>
    iso ? formatClock(iso, locale, timeZone) : "—";

  autoTable(doc, {
    body: data.days.map((d) => [
      d.date,
      d.userName,
      formatMinutes(d.hours.workedMinutes),
      time(d.hours.firstEntradaAt),
      time(d.hours.lastSaidaAt),
      d.hours.missingExit ? "!" : "",
      d.hours.lateMinutes > 0 ? `${d.hours.lateMinutes}m` : "",
      d.hours.earlyExitMinutes > 0 ? `${d.hours.earlyExitMinutes}m` : "",
      d.hours.hasCorrection || d.hours.recusadoCount > 0 ? "✓" : "",
    ]),
    head: [
      [
        t("ponto.pdf_col_date"),
        t("ponto.pdf_col_user"),
        t("ponto.pdf_col_worked"),
        t("ponto.pdf_col_first"),
        t("ponto.pdf_col_last"),
        t("ponto.pdf_col_missing_exit"),
        t("ponto.pdf_col_late"),
        t("ponto.pdf_col_early"),
        t("ponto.pdf_col_corrected"),
      ],
    ],
    startY: 33,
    styles: { fontSize: 8 },
  });

  doc.save(`ponto-${data.from}_${data.to}.pdf`);
}

export default function ExportTab() {
  const { i18n, t } = useTranslation();
  const shopTz = useShopTz();
  const tz = shopTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [from, setFrom] = useState(() => ymdDaysAgo(30, tz));
  const [to, setTo] = useState(() => ymdDaysAgo(0, tz));
  const [data, setData] = useState<PontoHoursResponse | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ from, to });
      const res = await api.get<PontoHoursResponse>(`/ponto/hours?${params}`);
      setData(res.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [from, to]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const exportPdf = async () => {
    if (!data) {
      return;
    }
    setBusy(true);
    try {
      await downloadPdf(
        data,
        t("ponto.export_title"),
        shopTz,
        i18n.language,
        t
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("ponto.from")}>
          <Input
            onChange={(e) => setFrom(e.target.value)}
            type="date"
            value={from}
          />
        </Field>
        <Field label={t("ponto.to")}>
          <Input
            onChange={(e) => setTo(e.target.value)}
            type="date"
            value={to}
          />
        </Field>
        <Button icon="refresh" onClick={load} size="sm" variant="secondary">
          {t("refresh")}
        </Button>
        <Button
          disabled={busy || !data || data.days.length === 0}
          icon="download"
          onClick={exportPdf}
        >
          {t("ponto.export_pdf")}
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl bg-error-container p-4 text-center text-on-error-container text-sm">
          {t("ponto.load_failed")}
          <Button className="ms-3" onClick={load} size="sm" variant="secondary">
            {t("retry")}
          </Button>
        </div>
      )}
      {!(error || data) && (
        <div className="h-48 animate-pulse rounded-xl bg-surface-container-low" />
      )}
      {data && data.days.length === 0 && (
        <div className="rounded-2xl bg-surface-container-low p-8 text-center text-on-surface-variant text-sm">
          {t("ponto.hours_empty")}
        </div>
      )}
      {data && data.days.length > 0 && (
        <p className="text-on-surface-variant text-sm">
          {t("ponto.export_preview", {
            count: data.days.length,
            from: data.from,
            to: data.to,
          })}
        </p>
      )}
    </div>
  );
}
