import type {
  PontoActExportResponse,
  PontoHoursResponse,
} from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import api from "@/lib/api";
import { useUsersStore } from "@/stores/users";
import { downloadActPdf, downloadActXlsx } from "./act-export";
import {
  formatClock,
  formatMinutes,
  shopToday,
  useShopTz,
  ymdAddDays,
  ymdDaysAgo,
} from "./shared";

export async function downloadPdf(
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
      d.hours.hasCorrection || d.hours.recusadoCount > 0 ? "X" : "",
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

function monthRange(offset: 0 | -1, tz: string): { from: string; to: string } {
  const today = shopToday(tz);
  const [year = 0, month = 1] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1))
    .toISOString()
    .slice(0, 10);
  const nextMonth = new Date(Date.UTC(year, month + offset, 1))
    .toISOString()
    .slice(0, 10);
  return { from: first, to: ymdAddDays(nextMonth, -1) };
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
  const [actBusy, setActBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [actError, setActError] = useState(false);
  const [actUserId, setActUserId] = useState("");
  const storeUsers = useUsersStore((state) => state.users);
  const fetchAllUsers = useUsersStore((state) => state.fetchAllUsers);
  const allUsersLoaded = useUsersStore((state) => state.allUsersLoaded);

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
    if (!allUsersLoaded) {
      fetchAllUsers().catch(() => undefined);
    }
  }, [load, allUsersLoaded, fetchAllUsers]);

  const setMonth = (offset: 0 | -1) => {
    const range = monthRange(offset, tz);
    setFrom(range.from);
    setTo(range.to);
  };

  const exportAct = async (format: "pdf" | "xlsx") => {
    setActBusy(format);
    setActError(false);
    try {
      const params = new URLSearchParams({ from, to });
      if (actUserId) {
        params.set("userId", actUserId);
      }
      const res = await api.get<PontoActExportResponse>(
        `/ponto/act-export?${params}`
      );
      if (format === "pdf") {
        await downloadActPdf(res.data, i18n.language, t);
      } else {
        await downloadActXlsx(res.data, i18n.language, t);
      }
    } catch {
      setActError(true);
    } finally {
      setActBusy(null);
    }
  };

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
          onClick={() => setMonth(0)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("ponto.act_month_current")}
        </Button>
        <Button
          onClick={() => setMonth(-1)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("ponto.act_month_previous")}
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

      <section className="rounded-2xl bg-surface-container-lowest p-5">
        <h2 className="font-bold text-on-surface text-sm">
          {t("ponto.act_title")}
        </h2>
        <p className="mt-1 text-on-surface-variant text-xs">
          {t("ponto.act_desc")}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label={t("ponto.user_filter")}>
            <Select
              onChange={(e) => setActUserId(e.target.value)}
              value={actUserId}
            >
              <option value="">{t("ponto.all_users")}</option>
              {storeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.username}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            disabled={actBusy !== null}
            icon="download"
            onClick={() => exportAct("pdf")}
          >
            {actBusy === "pdf" ? t("loading") : t("ponto.act_export_pdf")}
          </Button>
          <Button
            disabled={actBusy !== null}
            icon="download"
            onClick={() => exportAct("xlsx")}
            variant="secondary"
          >
            {actBusy === "xlsx" ? t("loading") : t("ponto.act_export_excel")}
          </Button>
        </div>
        {actError && (
          <p className="mt-3 text-error text-sm">{t("ponto.act_failed")}</p>
        )}
      </section>
    </div>
  );
}
