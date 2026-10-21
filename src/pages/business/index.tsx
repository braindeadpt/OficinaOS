import { commissionGross } from "@shared/business-finance";
import type { WorkflowType } from "@shared/constants/workflow";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { RecordWorkflow } from "@/components/modules/tasks/record-workflow";
import { Button } from "@/components/ui/button";
import { Field, type FieldControlProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";
import { BusinessHistory } from "./history";
import { MessageLinks } from "./message-links";

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
type Module = "tickets" | "messages" | "agreements";
interface Entry {
  customer?: { id: string; name: string };
  id: string;
  links?: { id: string; entityType: WorkflowType; entityId: string }[];
  number?: number;
  subject?: string;
  supplier?: { id: string; name: string };
  title?: string;
  [key: string]: unknown;
}
interface FormField {
  name: string;
  options?: string[];
  required?: boolean;
  type?: string;
}
const fields: Record<Module, FormField[]> = {
  tickets: [
    { name: "title", required: true },
    { name: "area", required: true },
    { name: "priority", options: ["LOW", "NORMAL", "HIGH", "URGENT"] },
    { name: "description", type: "textarea" },
  ],
  messages: [
    { name: "subject", required: true },
    {
      name: "channel",
      options: [
        "EMAIL",
        "FACEBOOK",
        "INSTAGRAM",
        "MESSENGER",
        "WHATSAPP",
        "SMS",
        "INTERNAL",
      ],
    },
    { name: "direction", options: ["INBOUND", "OUTBOUND", "NOTE"] },
    { name: "deliveryStatus", options: ["CAPTURED", "DRAFT"] },
    { name: "correspondent" },
    { name: "body", type: "textarea", required: true },
  ],
  agreements: [
    { name: "title", required: true },
    { name: "kind", options: ["COMMISSION", "LICENSE", "RETAINER", "OTHER"] },
    { name: "amountGross", type: "money" },
    { name: "vatRate", type: "rate" },
    { name: "commissionBasisNet", type: "money" },
    { name: "commissionRate", type: "rate" },
    { name: "paidGross", type: "money" },
    { name: "interval", options: ["ONCE", "MONTHLY", "YEARLY", "OTHER"] },
    { name: "status", options: ["ACTIVE", "SUSPENDED", "ENDED"] },
    { name: "reference" },
    { name: "startsAt", type: "date" },
    { name: "renewsAt", type: "date" },
    { name: "endsAt", type: "date" },
    { name: "notes", type: "textarea" },
  ],
};
const types: Record<Module, WorkflowType> = {
  tickets: "TICKET",
  messages: "MESSAGE",
  agreements: "AGREEMENT",
};
function empty(module: Module): Record<string, string> {
  const result: Record<string, string> = { customerId: "", supplierId: "" };
  for (const field of fields[module]) {
    result[field.name] =
      field.options?.[0] ??
      (field.type === "money" || field.type === "rate" ? "0" : "");
  }
  if (module === "tickets") {
    result.priority = "NORMAL";
    result.area = "Sites";
  }
  if (module === "messages") {
    result.deliveryStatus = "DRAFT";
    result.direction = "OUTBOUND";
  }
  return result;
}
export default function BusinessPage({ module }: { module: Module }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const recordId = params.get("recordId") || undefined;
  const customerId = params.get("customerId") || undefined;
  const supplierId = params.get("supplierId") || undefined;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [parties, setParties] = useState<{
    customers: { id: string; name: string }[];
    suppliers: { id: string; name: string }[];
  }>({ customers: [], suppliers: [] });
  const [form, setForm] = useState<Record<string, string>>(() => ({
    ...empty(module),
    customerId: customerId ?? "",
    supplierId: supplierId ?? "",
  }));
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = useCan(
    module === "tickets" ? { jobs: ["edit"] } : { settings: ["edit"] }
  );
  const load = useCallback(
    async (next?: string) => {
      try {
        const { data } = await api.get(`/business/${module}`, {
          params: { customerId, supplierId, recordId, cursor: next },
        });
        setEntries((old) => (next ? [...old, ...data.data] : data.data));
        setCursor(data.nextCursor);
      } catch {
        toast.error(t("tasks.failed"));
      }
    },
    [module, customerId, supplierId, recordId, t]
  );
  useEffect(() => {
    setForm({
      ...empty(module),
      customerId: customerId ?? "",
      supplierId: supplierId ?? "",
    });
    setEditing("");
    load();
    api
      .get("/business/parties")
      .then(({ data }) => setParties(data))
      .catch(() => toast.error(t("tasks.failed")));
  }, [load, module, customerId, supplierId, t]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data: Record<string, unknown> = {
        ...form,
        customerId: form.customerId || null,
        supplierId: form.supplierId || null,
      };
      for (const field of fields[module]) {
        if (field.type === "date") {
          data[field.name] = form[field.name]
            ? new Date(`${form[field.name]}T00:00:00Z`).toISOString()
            : null;
        }
      }
      if (editing) {
        await api.patch(`/business/${module}/${editing}`, data);
      } else {
        await api.post(`/business/${module}`, data);
      }
      setEditing("");
      setForm({
        ...empty(module),
        customerId: customerId ?? "",
        supplierId: supplierId ?? "",
      });
      await load();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  let commission = "";
  if (
    module === "agreements" &&
    form.kind === "COMMISSION" &&
    [form.commissionBasisNet, form.commissionRate, form.vatRate].every(
      (value) => MONEY_PATTERN.test(value)
    )
  ) {
    commission = commissionGross(
      form.commissionBasisNet,
      form.commissionRate,
      form.vatRate
    );
  }
  return (
    <div className="space-y-5">
      <h1 className="font-bold text-2xl">{t(`business.${module}`)}</h1>
      {module === "messages" && (
        <p className="rounded-xl bg-surface-container p-4">
          {t("business.manual_channels")}
        </p>
      )}
      {module === "agreements" && <p>{t("business.agreement_hint")}</p>}
      {edit && (
        <details
          className="rounded-xl bg-surface-container-low p-4"
          open={Boolean(editing) || undefined}
        >
          <summary className="cursor-pointer font-semibold">
            {t(editing ? "edit" : "business.add")}
          </summary>
          <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={save}>
            {fields[module].map((field) => (
              <BusinessFormField
                field={field}
                key={field.name}
                onChange={(value) =>
                  setForm((old) => ({ ...old, [field.name]: value }))
                }
                value={form[field.name]}
              />
            ))}
            {(["customerId", "supplierId"] as const).map((name) => (
              <Field key={name} label={t(`business.fields.${name}`)}>
                <Select
                  onChange={(event) =>
                    setForm((old) => ({ ...old, [name]: event.target.value }))
                  }
                  value={form[name]}
                >
                  <option value="">—</option>
                  {parties[
                    name === "customerId" ? "customers" : "suppliers"
                  ].map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            {commission && (
              <p>
                {t("business.commission_total")}: {commission} €
              </p>
            )}
            <div className="flex gap-2">
              <Button loading={busy} type="submit">
                {t("save")}
              </Button>
              {editing && (
                <Button
                  onClick={() => {
                    setEditing("");
                    setForm(empty(module));
                  }}
                  variant="secondary"
                >
                  {t("cancel")}
                </Button>
              )}
            </div>
          </form>
        </details>
      )}
      {!entries.length && <p>{t("business.empty")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {["title", "customerId", "supplierId", "details"].map((name) => (
                <th className="p-3" key={name}>
                  {t(`business.fields.${name}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                className="border-outline-variant border-b align-top"
                key={entry.id}
              >
                <td className="p-3">
                  <strong>
                    {entry.number
                      ? `TK-${String(entry.number).padStart(6, "0")} · `
                      : ""}
                    {entry.title ?? entry.subject}
                  </strong>
                  {edit && (
                    <Button
                      onClick={() => {
                        const next = empty(module);
                        for (const key of Object.keys(next)) {
                          const value = entry[key];
                          next[key] = value == null ? "" : String(value);
                          if (key.endsWith("At")) {
                            next[key] = next[key].slice(0, 10);
                          }
                        }
                        setForm(next);
                        setEditing(entry.id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {t("edit")}
                    </Button>
                  )}
                </td>
                <td className="p-3">{entry.customer?.name ?? "—"}</td>
                <td className="p-3">{entry.supplier?.name ?? "—"}</td>
                <td className="min-w-64 p-3">
                  {module === "tickets" && (
                    <>
                      <p>
                        {String(entry.area)} ·{" "}
                        {t(`business.values.${entry.priority}`)}
                      </p>
                      <p className="whitespace-pre-wrap">
                        {String(entry.description)}
                      </p>
                    </>
                  )}
                  {module === "messages" && (
                    <>
                      <p>
                        {String(entry.channel)} ·{" "}
                        {t(`business.values.${entry.deliveryStatus}`)} ·{" "}
                        {t(`business.values.${entry.direction}`)}
                      </p>
                      <p>{String(entry.correspondent ?? "")}</p>
                      <p className="whitespace-pre-wrap">
                        {String(entry.body)}
                      </p>
                      <MessageLinks
                        links={entry.links ?? []}
                        messageId={entry.id}
                        onChanged={() => load()}
                      />
                    </>
                  )}
                  {module === "agreements" && (
                    <>
                      <p>
                        {t(`business.values.${entry.kind}`)} ·{" "}
                        {t(`business.values.${entry.status}`)}
                      </p>
                      <p>
                        {t("business.fields.amountGross")}:{" "}
                        {String(entry.amountGross)} € ·{" "}
                        {t(`business.values.${entry.interval}`)}
                      </p>
                      <p>
                        {t("business.fields.paidGross")}:{" "}
                        {String(entry.paidGross)} €
                      </p>
                      {Boolean(entry.renewsAt) && (
                        <p>
                          {t("business.fields.renewsAt")}:{" "}
                          {new Date(
                            String(entry.renewsAt)
                          ).toLocaleDateString()}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">
                        {String(entry.notes ?? "")}
                      </p>
                    </>
                  )}
                  {module === "tickets" && (
                    <BusinessHistory entityId={entry.id} entityType="TICKET" />
                  )}
                  <RecordWorkflow
                    entityId={entry.id}
                    entityType={types[module]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <Button onClick={() => load(cursor)}>{t("tasks.more")}</Button>
      )}
    </div>
  );
}

function BusinessFormField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  let control: ReactElement<FieldControlProps>;
  if (field.options) {
    control = (
      <Select onChange={(event) => onChange(event.target.value)} value={value}>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {t(`business.values.${option}`)}
          </option>
        ))}
      </Select>
    );
  } else if (field.type === "textarea") {
    control = (
      <Textarea
        maxLength={field.name === "body" ? 30_000 : 20_000}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        value={value}
      />
    );
  } else {
    const numeric = field.type === "money" || field.type === "rate";
    control = (
      <Input
        max={field.type === "rate" ? "100" : undefined}
        maxLength={300}
        min={numeric ? "0" : undefined}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        step={numeric ? "0.01" : undefined}
        type={numeric ? "number" : (field.type ?? "text")}
        value={value}
      />
    );
  }
  return <Field label={t(`business.fields.${field.name}`)}>{control}</Field>;
}
