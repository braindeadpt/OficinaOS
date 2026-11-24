import type { PontoHoursResponse } from "@shared/types/ponto";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { formatMinutes } from "./shared";

function ymdDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function downloadPdf(data: PontoHoursResponse, title: string) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`${data.from} → ${data.to}`, 14, 23);

  autoTable(doc, {
    body: data.days.map((d) => [
      d.date,
      d.userName,
      formatMinutes(d.hours.workedMinutes),
      d.hours.firstEntradaAt
        ? new Date(d.hours.firstEntradaAt).toLocaleTimeString()
        : "—",
      d.hours.lastSaidaAt
        ? new Date(d.hours.lastSaidaAt).toLocaleTimeString()
        : "—",
      d.hours.missingExit ? "!" : "",
      d.hours.lateMinutes > 0 ? `${d.hours.lateMinutes}m` : "",
      d.hours.earlyExitMinutes > 0 ? `${d.hours.earlyExitMinutes}m` : "",
    ]),
    head: [
      [
        "Data",
        "Funcionário",
        "Trabalhado",
        "Entrada",
        "Saída",
        "Saída em falta",
        "Atraso",
        "Saída cedo",
      ],
    ],
    startY: 30,
    styles: { fontSize: 8 },
  });

  doc.save(`ponto-${data.from}_${data.to}.pdf`);
}

export default function ExportTab() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(ymdDaysAgo(30));
  const [to, setTo] = useState(ymdDaysAgo(0));
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
      await downloadPdf(data, t("ponto.export_title"));
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
