import {
  IMPORT_CHUNK_SIZE,
  type ImportRowError,
  type ImportSummary,
} from "@shared/schemas/data-io.schema";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import {
  ImportFileError,
  mapRows,
  parseCsv,
  readTableFile,
  remapChunkErrors,
} from "@/lib/import-table";
import { useSettingsStore } from "@/stores/settings";

type Entity = "parts" | "repairs" | "jobs";

/** CSV columns that carry numbers — written as real Numbers into XLSX. */
const XLSX_NUMERIC_COLUMNS: Record<Entity, Set<string>> = {
  parts: new Set(["price", "stock", "reorderlevel", "reorder_level"]),
  repairs: new Set(["price", "warrantydays", "warranty_days"]),
  jobs: new Set(["estimatedcost"]),
};

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Server exports CSV only — for Excel we convert it client-side. */
async function csvToXlsxBlob(
  csv: string,
  sheet: string,
  numericColumns: Set<string>
): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const table = parseCsv(csv);
  const headers = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const rows = table.map((row, rowIndex) =>
    row.map((value, colIndex) => {
      if (
        rowIndex > 0 &&
        numericColumns.has(headers[colIndex] ?? "") &&
        value !== ""
      ) {
        const n = Number(value);
        if (Number.isFinite(n)) {
          return { type: Number, value: n };
        }
      }
      return { type: String, value };
    })
  );
  return writeXlsxFile(rows, { sheet }).toBlob();
}

const TRAILING_SLASHES = /\/+$/;

const ENTITY_LABELS: Record<Entity, string> = {
  parts: "data_io.parts",
  repairs: "data_io.repairs",
  jobs: "data_io.jobs",
};

function ExportCard({ entity }: { entity: Entity }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const label = t(ENTITY_LABELS[entity]);

  const doExport = async (format: "csv" | "xlsx") => {
    setBusy(true);
    try {
      const res = await api.get(`/export/${entity}.csv`, {
        responseType: "text",
      });
      const csv = String(res.data);
      if (format === "csv") {
        downloadBlob(
          `${entity}-export.csv`,
          new Blob([csv], { type: "text/csv; charset=utf-8" })
        );
      } else {
        const blob = await csvToXlsxBlob(
          csv,
          entity,
          XLSX_NUMERIC_COLUMNS[entity]
        );
        downloadBlob(`${entity}-export.xlsx`, blob);
      }
    } catch {
      toast.error(t("data_io.export_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface-container-lowest p-5">
      <p className="font-bold text-on-surface text-sm">{label}</p>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("data_io.export_desc")}
      </p>
      <div className="mt-4 flex gap-2">
        <Button
          disabled={busy}
          icon="download"
          onClick={() => doExport("csv")}
          size="sm"
          type="button"
          variant="secondary"
        >
          CSV
        </Button>
        <Button
          disabled={busy}
          icon="download"
          onClick={() => doExport("xlsx")}
          size="sm"
          type="button"
          variant="secondary"
        >
          Excel
        </Button>
      </div>
    </div>
  );
}

/** One row per import error: sheet row number, field and the message. */
function errorsToCsv(errors: ImportRowError[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["row;field;error"];
  for (const e of errors) {
    lines.push([e.row, e.field, e.message].map(esc).join(";"));
  }
  return `﻿${lines.join("\r\n")}`;
}

function ImportCard({ entity }: { entity: Entity }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lastErrors, setLastErrors] = useState<ImportRowError[]>([]);
  const label = t(ENTITY_LABELS[entity]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) {
      return;
    }
    setBusy(true);
    setLastErrors([]);
    try {
      const table = await readTableFile(file);
      const rows = mapRows(entity, table.rows);
      if (rows.length === 0) {
        toast.error(t("data_io.empty_file"));
        return;
      }
      // Send in chunks so a big file never hits the 5 MB body limit.
      const totals: ImportSummary = {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
      };
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
        const res = await api.post(`/import/${entity}`, { rows: chunk });
        const r = res.data as Partial<ImportSummary>;
        totals.created += r.created ?? 0;
        totals.updated += r.updated ?? 0;
        totals.skipped += r.skipped ?? 0;
        // Server rows are 1-based inside this chunk — remap to file lines.
        totals.errors.push(
          ...remapChunkErrors(
            r.errors,
            table.lines.slice(i, i + IMPORT_CHUNK_SIZE)
          )
        );
      }
      setLastErrors(totals.errors);
      toast.success(
        t("data_io.import_done", {
          created: totals.created,
          updated: totals.updated,
        })
      );
      if (totals.errors.length > 0) {
        toast.warning(
          t("data_io.import_errors", {
            count: totals.errors.length,
            first: `${totals.errors[0].row}: ${totals.errors[0].message}`,
          })
        );
      }
    } catch (err) {
      toast.error(
        t(err instanceof ImportFileError ? err.key : "data_io.import_failed")
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadErrors = () => {
    downloadBlob(
      `${entity}-import-errors.csv`,
      new Blob([errorsToCsv(lastErrors)], {
        type: "text/csv; charset=utf-8",
      })
    );
  };

  return (
    <div className="rounded-xl bg-surface-container-lowest p-5">
      <p className="font-bold text-on-surface text-sm">{label}</p>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("data_io.import_desc")}
      </p>
      <Input
        accept=".csv,.xlsx"
        className="hidden"
        onChange={onFile}
        ref={fileRef}
        type="file"
      />
      <div className="mt-4 flex items-center gap-2">
        <Button
          icon="upload"
          loading={busy}
          onClick={() => fileRef.current?.click()}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("data_io.pick_file")}
        </Button>
        {lastErrors.length > 0 && (
          <Button
            icon="download"
            onClick={downloadErrors}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("data_io.download_errors", { count: lastErrors.length })}
          </Button>
        )}
      </div>
    </div>
  );
}

function EmbedCard() {
  const { t } = useTranslation();
  const shopSettings = useSettingsStore((s) => s.shopSettings);
  const fetchShopSettings = useSettingsStore((s) => s.fetchShopSettings);
  const saveShopSettings = useSettingsStore((s) => s.saveShopSettings);
  const [copied, setCopied] = useState(false);
  const [origins, setOrigins] = useState<string | null>(null);
  const [savingOrigins, setSavingOrigins] = useState(false);

  useEffect(() => {
    if (!shopSettings) {
      fetchShopSettings();
    }
  }, [shopSettings, fetchShopSettings]);

  // The widget URL must be the shop's PUBLIC address — window.location is
  // wherever staff happen to be (LAN IP, tunnel), which won't resolve for
  // website visitors.
  const baseUrl = (
    shopSettings?.trackingBaseUrl?.replace(TRAILING_SLASHES, "") ||
    window.location.origin
  ).trim();
  const snippet = `<iframe
  src="${baseUrl}/embed/pre-check"
  style="width:100%;max-width:560px;height:720px;border:0;border-radius:12px"
  title="OficinaOS"></iframe>`;
  const isHttps = baseUrl.startsWith("https://");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("data_io.copy_failed"));
    }
  };

  const saveOrigins = async () => {
    if (origins === null || savingOrigins || !shopSettings) {
      return;
    }
    setSavingOrigins(true);
    try {
      await saveShopSettings({
        shopName: shopSettings.shopName,
        embedAllowedOrigins: origins,
      });
      toast.success(t("data_io.embed_origins_saved"));
    } catch {
      toast.error(t("data_io.embed_origins_failed"));
    } finally {
      setSavingOrigins(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface-container-lowest p-5 sm:col-span-2">
      <div className="flex items-center justify-between">
        <p className="font-bold text-on-surface text-sm">
          {t("data_io.embed_title")}
        </p>
        <Button
          icon={copied ? "check" : "content_copy"}
          onClick={copy}
          size="sm"
          type="button"
          variant="secondary"
        >
          {copied ? t("data_io.copied") : t("data_io.copy")}
        </Button>
      </div>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("data_io.embed_desc")}
      </p>
      {!isHttps && (
        <p className="mt-2 flex items-start gap-1.5 text-warning text-xs">
          <Icon className="shrink-0" name="warning" size="sm" />
          <span>{t("data_io.embed_https_warn")}</span>
        </p>
      )}
      <Textarea
        className="mt-3 font-mono text-xs"
        readOnly
        rows={5}
        value={snippet}
      />
      <Field label={t("data_io.embed_origins_label")}>
        <Textarea
          className="font-mono text-xs"
          onChange={(e) => setOrigins(e.target.value)}
          placeholder="https://a-sua-loja.pt"
          rows={2}
          value={origins ?? shopSettings?.embedAllowedOrigins ?? ""}
        />
      </Field>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("data_io.embed_origins_hint")}
      </p>
      <div className="mt-2 flex justify-end">
        <Button
          disabled={origins === null}
          loading={savingOrigins}
          onClick={saveOrigins}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

const ENTITIES: Entity[] = ["parts", "repairs", "jobs"];

export default function SettingsDataTab() {
  const { t } = useTranslation();
  const [importEntity, setImportEntity] = useState<Entity>("parts");

  const entityLabel = (e: Entity) => t(ENTITY_LABELS[e]);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 font-bold font-headline text-base text-on-surface">
          {t("data_io.export_title")}
        </h2>
        <p className="mb-4 text-on-surface-variant text-sm">
          {t("data_io.export_hint")}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {ENTITIES.map((e) => (
            <ExportCard entity={e} key={e} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-bold font-headline text-base text-on-surface">
          {t("data_io.import_title")}
        </h2>
        <p className="mb-4 text-on-surface-variant text-sm">
          {t("data_io.import_hint")}
        </p>
        <div className="mb-4 max-w-xs">
          <Select
            aria-label={t("data_io.import_what")}
            onChange={(e) => setImportEntity(e.target.value as Entity)}
            value={importEntity}
          >
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {entityLabel(e)}
              </option>
            ))}
          </Select>
        </div>
        <ImportCard entity={importEntity} />
      </section>

      <section>
        <h2 className="mb-1 font-bold font-headline text-base text-on-surface">
          {t("data_io.embed_section")}
        </h2>
        <div className="grid gap-4">
          <EmbedCard />
        </div>
        <div className="mt-3 flex items-start gap-2 text-on-surface-variant text-xs">
          <Icon name="info" size="sm" />
          <span>{t("data_io.embed_note")}</span>
        </div>
      </section>
    </div>
  );
}
