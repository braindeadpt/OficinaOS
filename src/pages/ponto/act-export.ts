import type {
  PontoActEntryDTO,
  PontoActExportResponse,
  PontoActLinkedEntryDTO,
  PontoActWorkerDTO,
  PontoEffectiveStatus,
  PontoTransport,
} from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { formatMinutes } from "./shared";

// O relógio da exportação ACT mostra os segundos: os totais são calculados
// com eles e uma picagem às 09:00:59 não pode parecer às 09:00 em papel.
function formatClockSeconds(
  iso: string,
  locale: string,
  timeZone: string | undefined
): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

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

/** Classificação única da prova de presença (decisões da Fase 2).
 *  Registos antigos sem kind → «—» no exportador, sem preenchimento
 *  retroativo. */
function proofLabel(
  entry: PontoActLinkedEntryDTO,
  t: TFunction
): string | null {
  if (entry.proofKind === "screen_wifi") {
    return t("ponto.act_proof_screen_wifi");
  }
  if (entry.proofKind === "location") {
    return t("ponto.act_proof_location");
  }
  if (entry.proofKind === "external_photo") {
    return t("ponto.act_proof_external_photo");
  }
  // Ficou por validar e uma pessoa decidiu: prova é a própria validação.
  const latest = entry.validations[0];
  if (latest?.decision === "APROVADO") {
    return t("ponto.act_proof_manual", {
      name: latest.byUserName ?? t("ponto.act_system_author"),
    });
  }
  return null;
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
  return `${args.label}: ${typeLabel(e.type, args.t)} ${formatDateTime(
    e.at,
    args.locale,
    args.timeZone
  )} · ${statusText(e.effectiveStatus, args.t)} · ${author} · ${formatDateTime(
    e.createdAt,
    args.locale,
    args.timeZone
  )}${reason} · ${args.t("ponto.act_proof")}: ${proofLabel(e, args.t) ?? "—"}`;
}

function pushValidationLines(
  lines: string[],
  validations: PontoActLinkedEntryDTO["validations"],
  locale: string,
  timeZone: string | undefined,
  t: TFunction,
  subjectKey?: string
): void {
  for (const validation of validations) {
    const author = validation.byUserName ?? t("ponto.act_system_author");
    const note = validation.note ? ` — ${validation.note}` : "";
    // Numa linha com picagem ligada há DUAS picagens em jogo — cada
    // validação tem de dizer a qual pertence, senão a aprovação do
    // original parece pertencer à correção.
    const label = subjectKey ? t(subjectKey) : t("ponto.act_validation");
    lines.push(
      `${label}: ${statusText(validation.decision, t)} · ${author} · ${formatDateTime(
        validation.at,
        locale,
        timeZone
      )}${note}`
    );
  }
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
    pushValidationLines(
      lines,
      entry.corrects.validations,
      locale,
      timeZone,
      t,
      "ponto.act_validation_of_original"
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
    pushValidationLines(
      lines,
      correction.validations,
      locale,
      timeZone,
      t,
      "ponto.act_validation_of_correction"
    );
  }
  if (entry.reason && !entry.corrects) {
    lines.push(`${t("ponto.act_reason")}: ${entry.reason}`);
  }
  // Uma picagem manual que não corrige nenhuma outra não teria autoria
  // visível em lado nenhum — e é precisamente nessas que a ACT quer saber
  // quem a registou e quando.
  if (entry.transport === "MANUAL" && !entry.corrects) {
    const author = entry.createdByName ?? t("ponto.act_system_author");
    lines.push(
      `${t("ponto.act_registered_by")}: ${author} · ${formatDateTime(
        entry.createdAt,
        locale,
        timeZone
      )}`
    );
  }
  const proof = proofLabel(entry, t);
  lines.push(`${t("ponto.act_proof")}: ${proof ?? "—"}`);
  // Quando a linha traz uma picagem ligada, até as validações da própria
  // linha precisam de rótulo: pertencem ao original (se há correções) ou
  // à correção (se a linha corrige outra picagem).
  let ownSubject: string | undefined;
  if (entry.corrections.length) {
    ownSubject = "ponto.act_validation_of_original";
  } else if (entry.corrects) {
    ownSubject = "ponto.act_validation_of_correction";
  }
  pushValidationLines(
    lines,
    entry.validations,
    locale,
    timeZone,
    t,
    ownSubject
  );
  return lines.join("\n");
}

function ddmm(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

function weekRangeLabel(
  week: PontoActWorkerDTO["weeks"][number],
  period: { from: string; to: string },
  t: TFunction
): string {
  // Semana cortada pelo período exportado: o total cobre só os dias dentro
  // do período e o rótulo tem de o dizer — apresentar segunda–domingo como
  // se fosse a semana inteira induz a ACT em erro sobre o total semanal.
  if (week.start >= period.from && week.end <= period.to) {
    return `${week.start} → ${week.end}`;
  }
  const from = week.start < period.from ? period.from : week.start;
  const to = week.end > period.to ? period.to : week.end;
  return t("ponto.act_week_partial", { from: ddmm(from), to: ddmm(to) });
}

function workerRows(
  worker: PontoActWorkerDTO,
  locale: string,
  timeZone: string | undefined,
  t: TFunction,
  includeWorker: boolean,
  period: { from: string; to: string }
): string[][] {
  const rows: string[][] = [];
  const prefix = includeWorker ? [`${worker.name} (@${worker.username})`] : [];
  if (worker.days.length === 0) {
    const exemptNote = worker.scheduleExempt
      ? ` — ${t("ponto.act_schedule_exempt")} (${t("ponto.act_regime_at_export")})`
      : "";
    rows.push([
      ...prefix,
      "",
      "",
      "",
      "",
      "",
      `${t("ponto.act_no_records")}${exemptNote}`,
    ]);
    // A linha de total do trabalhador (com o regime) continua a sair.
  }
  for (const [dayIndex, day] of worker.days.entries()) {
    for (const entry of day.entries) {
      rows.push([
        ...prefix,
        day.date,
        formatClockSeconds(entry.at, locale, timeZone),
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
          weekRangeLabel(week, period, t),
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
    worker.scheduleExempt
      ? `${t("ponto.act_schedule_exempt")} (${t("ponto.act_regime_at_export")})`
      : "",
  ]);
  return rows;
}

export function buildActPdfRows(
  worker: PontoActWorkerDTO,
  locale: string,
  timeZone: string | undefined,
  t: TFunction,
  period: { from: string; to: string }
): string[][] {
  return workerRows(worker, locale, timeZone, t, false, period);
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
    workerRows(worker, locale, data.period.timeZone, t, true, data.period)
  );
  return [...meta, ...rows].map((row) =>
    row.map((value) => ({ type: String, value }))
  );
}

function workerHeading(worker: PontoActWorkerDTO, t: TFunction): string {
  let schedule = t("ponto.act_schedule_unset");
  if (worker.scheduleExempt) {
    schedule = `${t("ponto.act_schedule_exempt")} (${t("ponto.act_regime_at_export")})`;
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
      body: buildActPdfRows(
        worker,
        locale,
        data.period.timeZone,
        t,
        data.period
      ),
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
