import type {
  PontoActEntryDTO,
  PontoActExportResponse,
  PontoActLinkedEntryDTO,
  PontoActWorkerDTO,
  PontoEffectiveStatus,
  PontoTransport,
} from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { formatClock, formatMinutes } from "./shared";

function formatDateTime(
  iso: string,
  locale: string,
  timeZone: string | undefined
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone,
  }).format(new Date(iso));
}

function typeLabel(type: PontoActEntryDTO["type"], t: TFunction): string {
  return t(`ponto.type_${type.toLowerCase()}`);
}

const STATUS_LABEL: Record<PontoEffectiveStatus, string> = {
  APROVADO: "ponto.act_status_aprovado",
  POR_VALIDAR: "ponto.act_status_por_validar",
  RECUSADO: "ponto.act_status_recusado",
};

const TRANSPORT_LABEL: Record<PontoTransport, string> = {
  MANUAL: "ponto.act_method_manual",
  SMS: "ponto.act_method_sms",
  WHATSAPP_EVOLUTION: "ponto.act_method_whatsapp",
  WHATSAPP_META: "ponto.act_method_whatsapp",
};

function statusText(status: PontoEffectiveStatus, t: TFunction): string {
  return t(STATUS_LABEL[status]);
}

function statusLabel(entry: PontoActEntryDTO, t: TFunction): string {
  const base =
    entry.status === entry.effectiveStatus
      ? statusText(entry.effectiveStatus, t)
      : `${statusText(entry.status, t)} → ${statusText(entry.effectiveStatus, t)}`;
  return entry.superseded ? `${base} (${t("ponto.act_superseded")})` : base;
}

function linkedLine(args: {
  entry: PontoActLinkedEntryDTO;
  label: string;
  locale: string;
  t: TFunction;
  timeZone: string | undefined;
}): string {
  const e = args.entry;
  const author = e.createdByName ?? args.t("ponto.act_system_author");
  const reason = e.reason ? ` — ${e.reason}` : "";
  return `${args.label}: ${typeLabel(e.type, args.t)} ${formatClock(
    e.at,
    args.locale,
    args.timeZone
  )} (${e.at.slice(0, 10)}) · ${author} · ${formatDateTime(
    e.createdAt,
    args.locale,
    args.timeZone
  )}${reason}`;
}

export function actEntryDetails(
  entry: PontoActEntryDTO,
  locale: string,
  timeZone: string | undefined,
  t: TFunction
): string {
  const lines: string[] = [];
  if (entry.corrects) {
    lines.push(
      linkedLine({
        entry: entry.corrects,
        label: t("ponto.act_corrects"),
        locale,
        t,
        timeZone,
      })
    );
    const author = entry.createdByName ?? t("ponto.act_system_author");
    const reason = entry.reason ? ` — ${entry.reason}` : "";
    lines.push(
      `${t("ponto.act_corrected_by")}: ${author} · ${formatDateTime(
        entry.createdAt,
        locale,
        timeZone
      )}${reason}`
    );
  }
  for (const correction of entry.corrections) {
    lines.push(
      linkedLine({
        entry: correction,
        label: t("ponto.act_corrected_by"),
        locale,
        t,
        timeZone,
      })
    );
  }
  if (entry.reason && !entry.corrects) {
    lines.push(`${t("ponto.act_reason")}: ${entry.reason}`);
  }
  for (const validation of entry.validations) {
    const author = validation.byUserName ?? t("ponto.act_system_author");
    const note = validation.note ? ` — ${validation.note}` : "";
    lines.push(
      `${t("ponto.act_validation")}: ${validation.decision} · ${author} · ${formatDateTime(
        validation.at,
        locale,
        timeZone
      )}${note}`
    );
  }
  return lines.join("\n");
}

function workerRows(
  worker: PontoActWorkerDTO,
  locale: string,
  timeZone: string | undefined,
  t: TFunction,
  includeWorker: boolean
): string[][] {
  const rows: string[][] = [];
  const prefix = includeWorker ? [worker.name] : [];
  if (worker.days.length === 0) {
    rows.push([...prefix, "", "", "", "", "", t("ponto.act_no_records")]);
    return rows;
  }
  for (const [dayIndex, day] of worker.days.entries()) {
    for (const entry of day.entries) {
      rows.push([
        ...prefix,
        day.date,
        formatClock(entry.at, locale, timeZone),
        typeLabel(entry.type, t),
        t(TRANSPORT_LABEL[entry.transport]),
        statusLabel(entry, t),
        actEntryDetails(entry, locale, timeZone, t),
      ]);
    }
    rows.push([
      ...prefix,
      day.date,
      "",
      t("ponto.act_day_total"),
      "",
      formatMinutes(day.workedMinutes),
      `${t("ponto.act_pauses")}: ${formatMinutes(day.pauseMinutes)}`,
    ]);
    const next = worker.days[dayIndex + 1];
    if (!next || next.weekStart !== day.weekStart) {
      const week = worker.weeks.find((w) => w.start === day.weekStart);
      if (week) {
        rows.push([
          ...prefix,
          `${week.start} → ${week.end}`,
          "",
          t("ponto.act_week_total"),
          "",
          formatMinutes(week.workedMinutes),
          "",
        ]);
      }
    }
  }
  rows.push([
    ...prefix,
    "",
    "",
    t("ponto.act_worker_total"),
    "",
    formatMinutes(worker.totalMinutes),
    worker.scheduleExempt ? t("ponto.act_schedule_exempt") : "",
  ]);
  return rows;
}

export function buildActPdfRows(
  worker: PontoActWorkerDTO,
  locale: string,
  timeZone: string | undefined,
  t: TFunction
): string[][] {
  return workerRows(worker, locale, timeZone, t, false);
}

export function buildActSheetRows(
  data: PontoActExportResponse,
  locale: string,
  t: TFunction
): { type: StringConstructor; value: string }[][] {
  const meta = [
    [t("ponto.act_title"), ""],
    [t("shop_name"), data.company.name],
    [t("shop_tax_id"), data.company.taxId ?? ""],
    [t("shop_address"), data.company.address ?? ""],
    [t("shop_locality"), data.company.locality ?? ""],
    [t("ponto.act_period"), `${data.period.from} → ${data.period.to}`],
    [
      t("ponto.act_exported_at"),
      formatDateTime(data.exportedAt, locale, data.period.timeZone),
    ],
    [t("ponto.act_exported_by"), data.exportedBy.name],
    [t("ponto.act_hash"), `${data.hashAlgorithm}: ${data.contentHash}`],
    ["", ""],
    [
      t("ponto.col_user"),
      t("ponto.act_col_date"),
      t("ponto.act_col_time"),
      t("ponto.act_col_type"),
      t("ponto.act_col_method"),
      t("ponto.act_col_state"),
      t("ponto.act_col_details"),
    ],
  ];
  const rows = data.workers.flatMap((worker) =>
    workerRows(worker, locale, data.period.timeZone, t, true)
  );
  return [...meta, ...rows].map((row) =>
    row.map((value) => ({ type: String, value }))
  );
}

function workerHeading(worker: PontoActWorkerDTO, t: TFunction): string {
  let schedule = t("ponto.act_schedule_unset");
  if (worker.scheduleExempt) {
    schedule = t("ponto.act_schedule_exempt");
  } else if (worker.scheduleStart && worker.scheduleEnd) {
    schedule = `${worker.scheduleStart}–${worker.scheduleEnd}`;
  }
  return `${worker.name} (@${worker.username}) — ${schedule}`;
}

function addActFooters(
  doc: {
    getNumberOfPages(): number;
    setPage(page: number): void;
    setFontSize(size: number): void;
    text(text: string, x: number, y: number): void;
  },
  data: PontoActExportResponse,
  t: TFunction
) {
  const pages = doc.getNumberOfPages();
  doc.setFontSize(7);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.text(
      `${t("ponto.act_page")} ${page}/${pages} · SHA-256: ${data.contentHash}`,
      14,
      200
    );
  }
}

export async function downloadActPdf(
  data: PontoActExportResponse,
  locale: string,
  t: TFunction
) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(14);
  doc.text(t("ponto.act_title"), 14, 14);
  doc.setFontSize(8);
  const company = [
    data.company.name,
    data.company.taxId ? `${t("shop_tax_id")}: ${data.company.taxId}` : null,
    data.company.address,
    data.company.locality,
  ]
    .filter(Boolean)
    .join(" · ");
  doc.text(company, 14, 20);
  doc.text(
    `${t("ponto.act_period")}: ${data.period.from} → ${data.period.to} · ${t(
      "ponto.act_exported_at"
    )}: ${formatDateTime(data.exportedAt, locale, data.period.timeZone)} · ${t(
      "ponto.act_exported_by"
    )}: ${data.exportedBy.name}`,
    14,
    25
  );

  const head = [
    t("ponto.act_col_date"),
    t("ponto.act_col_time"),
    t("ponto.act_col_type"),
    t("ponto.act_col_method"),
    t("ponto.act_col_state"),
    t("ponto.act_col_details"),
  ];

  if (data.workers.length === 0) {
    doc.text(t("ponto.act_no_records"), 14, 34);
  }
  data.workers.forEach((worker, index) => {
    if (index > 0) {
      doc.addPage();
    }
    const startY = index === 0 ? 31 : 20;
    if (index > 0) {
      doc.setFontSize(12);
      doc.text(t("ponto.act_title"), 14, 12);
    }
    doc.setFontSize(10);
    doc.text(workerHeading(worker, t), 14, startY - 3);
    autoTable(doc, {
      body: buildActPdfRows(worker, locale, data.period.timeZone, t),
      head: [head],
      startY,
      styles: { fontSize: 7 },
    });
  });

  addActFooters(doc, data, t);
  doc.save(`act-ponto-${data.period.from}_${data.period.to}.pdf`);
}

export async function downloadActXlsx(
  data: PontoActExportResponse,
  locale: string,
  t: TFunction
) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(buildActSheetRows(data, locale, t), {
    sheet: "ACT",
  }).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `act-ponto-${data.period.from}_${data.period.to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
