import { type ChangeEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import { mapRows, parseCsv, readTableFile } from "@/lib/import-table";

type Entity = "parts" | "repairs" | "jobs";

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Server exports CSV only — for Excel we convert it client-side. */
async function csvToXlsxBlob(csv: string, sheet: string): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const rows = parseCsv(csv).map((row) =>
    row.map((value) => ({ type: String, value }))
  );
  return writeXlsxFile(rows, { sheet }).toBlob();
}

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
        const blob = await csvToXlsxBlob(csv, entity);
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

function ImportCard({ entity }: { entity: Entity }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const label = t(ENTITY_LABELS[entity]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) {
      return;
    }
    setBusy(true);
    try {
      const rows = mapRows(entity, await readTableFile(file));
      if (rows.length === 0) {
        toast.error(t("data_io.empty_file"));
        return;
      }
      const res = await api.post(`/import/${entity}`, { rows });
      const r = res.data as {
        created?: number;
        updated?: number;
        errors?: { row: number; message: string }[];
      };
      const errs = r.errors ?? [];
      toast.success(
        t("data_io.import_done", {
          created: r.created ?? 0,
          updated: r.updated ?? 0,
        })
      );
      if (errs.length > 0) {
        toast.warning(
          t("data_io.import_errors", {
            count: errs.length,
            first: `${errs[0].row}: ${errs[0].message}`,
          })
        );
      }
    } catch {
      toast.error(t("data_io.import_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface-container-lowest p-5">
      <p className="font-bold text-on-surface text-sm">{label}</p>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("data_io.import_desc")}
      </p>
      <Input
        accept=".csv,.xls,.xlsx"
        className="hidden"
        onChange={onFile}
        ref={fileRef}
        type="file"
      />
      <Button
        className="mt-4"
        icon="upload"
        loading={busy}
        onClick={() => fileRef.current?.click()}
        size="sm"
        type="button"
        variant="secondary"
      >
        {t("data_io.pick_file")}
      </Button>
    </div>
  );
}

function EmbedCard() {
  const { t } = useTranslation();
  const snippet = `<iframe
  src="${window.location.origin}/embed/pre-check"
  style="width:100%;max-width:560px;height:720px;border:0;border-radius:12px"
  title="OficinaOS"></iframe>`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("data_io.copy_failed"));
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
      <Textarea
        className="mt-3 font-mono text-xs"
        readOnly
        rows={5}
        value={snippet}
      />
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
