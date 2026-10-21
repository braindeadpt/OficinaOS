import { orderMargin } from "@shared/business-finance";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { RecordWorkflow } from "@/components/modules/tasks/record-workflow";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";
import { BusinessHistory } from "@/pages/business/history";

const HTTP_URL = /^https?:/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
interface Order {
  costGross?: string;
  costVatRate?: string;

  createdAt: string;
  customer: { id: string; name: string } | null;
  customerId: string | null;
  id: string;
  jobId: string | null;
  kind: string;
  margin?: {
    profitAfterVat: string;
    revenueNet: string;
    costNet: string;
    vatBalance: string;
    marginPercent: number | null;
  };
  notes: string | null;
  partId: string | null;
  purchaseUrl: string | null;
  quoteGross?: string;
  recoverInputVat?: boolean;
  reference: string | null;
  saleVatRate?: string;
  supplier: { id: string; name: string } | null;
  supplierId: string | null;
  title: string;
}
const EMPTY = {
  title: "",
  supplierId: "",
  reference: "",
  notes: "",
  kind: "PRODUCT",
  purchaseUrl: "",
  customerId: "",
  jobId: "",
  partId: "",
  costGross: "0",
  quoteGross: "0",
  costVatRate: "0",
  saleVatRate: "0",
  recoverInputVat: true,
};
export default function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const recordId = params.get("recordId") || undefined;
  const supplierId = params.get("supplierId") || undefined;
  const customerId = params.get("customerId") || undefined;
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>(
    []
  );
  const [jobs, setJobs] = useState<{ id: string; name: string }[]>([]);
  const [parts, setParts] = useState<{ id: string; name: string }[]>([]);
  const financial = useCan({ parts: ["viewCost"] });
  const [orders, setOrders] = useState<Order[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>(
    []
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [form, setForm] = useState({
    ...EMPTY,
    supplierId: supplierId ?? "",
    customerId: customerId ?? "",
  });
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = useCan({ parts: ["manageCatalog", "viewCost"] });
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/purchase-orders", {
        params: { supplierId, customerId, recordId },
      });
      setOrders(data.data);
      setCursor(data.nextCursor);
    } catch {
      toast.error(t("tasks.failed"));
    }
  }, [supplierId, customerId, recordId, t]);
  useEffect(() => {
    load();
    api
      .get("/business/parties")
      .then(({ data }) => {
        setCustomers(data.customers);
      })
      .catch(() => toast.error(t("tasks.failed")));
    if (edit) {
      api
        .get("/business/targets", { params: { entityType: "JOB" } })
        .then(({ data }) => setJobs(data.data))
        .catch(() => toast.error(t("tasks.failed")));
      api
        .get("/parts", { params: { limit: 100 } })
        .then(({ data }) => setParts(data.data ?? data.parts ?? []))
        .catch(() => toast.error(t("tasks.failed")));
    }
    api
      .get("/suppliers")
      .then(({ data }) => setSuppliers(data.data))
      .catch(() => toast.error(t("tasks.failed")));
  }, [load, t, edit]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = {
        ...form,
        supplierId: form.supplierId || null,
        customerId: form.customerId || null,
        jobId: form.jobId || null,
        partId: form.kind === "PART" ? form.partId || null : null,
      };
      if (editing) {
        await api.patch(`/purchase-orders/${editing}`, data);
      } else {
        await api.post("/purchase-orders", data);
      }
      setEditing("");
      setForm({
        ...EMPTY,
        supplierId: supplierId ?? "",
        customerId: customerId ?? "",
      });
      await load();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <h1 className="font-bold text-2xl">{t("workflow.orders")}</h1>
      {edit && (
        <form
          className="space-y-3 rounded-2xl bg-surface-container-low p-5"
          onSubmit={save}
        >
          <Field label={t("workflow.order_title")}>
            <Input
              maxLength={200}
              onChange={(e) =>
                setForm((old) => ({ ...old, title: e.target.value }))
              }
              required
              value={form.title}
            />
          </Field>
          <Field label={t("workflow.types.SUPPLIER")}>
            <Select
              onChange={(e) =>
                setForm((old) => ({ ...old, supplierId: e.target.value }))
              }
              value={form.supplierId}
            >
              <option value="">{t("workflow.no_supplier")}</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("business.fields.kind")}>
              <Select
                onChange={(e) =>
                  setForm((old) => ({
                    ...old,
                    kind: e.target.value,
                    partId: "",
                  }))
                }
                value={form.kind}
              >
                {["PRODUCT", "PART"].map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`business.values.${kind}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("business.fields.customerId")}>
              <Select
                onChange={(e) =>
                  setForm((old) => ({ ...old, customerId: e.target.value }))
                }
                value={form.customerId}
              >
                <option value="">—</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("business.fields.jobId")}>
              <Select
                onChange={(e) =>
                  setForm((old) => ({ ...old, jobId: e.target.value }))
                }
                value={form.jobId}
              >
                <option value="">—</option>
                {jobs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            {form.kind === "PART" && (
              <Field label={t("business.fields.partId")}>
                <Select
                  onChange={(e) =>
                    setForm((old) => ({ ...old, partId: e.target.value }))
                  }
                  value={form.partId}
                >
                  <option value="">—</option>
                  {parts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t("business.fields.purchaseUrl")}>
              <Input
                onChange={(e) =>
                  setForm((old) => ({ ...old, purchaseUrl: e.target.value }))
                }
                type="url"
                value={form.purchaseUrl}
              />
            </Field>
            {(
              ["costGross", "quoteGross", "costVatRate", "saleVatRate"] as const
            ).map((name) => (
              <Field key={name} label={t(`business.fields.${name}`)}>
                <Input
                  max={name.endsWith("Rate") ? "100" : "9999999999.99"}
                  min="0"
                  onChange={(e) =>
                    setForm((old) => ({ ...old, [name]: e.target.value }))
                  }
                  step="0.01"
                  type="number"
                  value={form[name]}
                />
              </Field>
            ))}
            <label className="flex items-center gap-2">
              <input
                checked={form.recoverInputVat}
                onChange={(e) =>
                  setForm((old) => ({
                    ...old,
                    recoverInputVat: e.target.checked,
                  }))
                }
                type="checkbox"
              />
              {t("business.fields.recoverInputVat")}
            </label>
          </div>
          {[
            form.costGross,
            form.quoteGross,
            form.costVatRate,
            form.saleVatRate,
          ].every((value) => MONEY_PATTERN.test(value)) && (
            <p>
              {t("business.margin")}: {orderMargin(form).profitAfterVat} € ·{" "}
              {orderMargin(form).marginPercent ?? "—"}%
            </p>
          )}
          <p className="text-sm">{t("business.margin_hint")}</p>
          <Field label={t("workflow.reference")}>
            <Input
              maxLength={100}
              onChange={(e) =>
                setForm((old) => ({ ...old, reference: e.target.value }))
              }
              value={form.reference}
            />
          </Field>
          <Field label={t("tasks.notes")}>
            <Textarea
              maxLength={8000}
              onChange={(e) =>
                setForm((old) => ({ ...old, notes: e.target.value }))
              }
              value={form.notes}
            />
          </Field>
          <Button loading={busy} type="submit">
            {t("save")}
          </Button>
          {editing && (
            <Button
              onClick={() => {
                setEditing("");
                setForm(EMPTY);
              }}
            >
              {t("cancel")}
            </Button>
          )}
        </form>
      )}
      {orders.length === 0 && <p>{t("workflow.no_orders")}</p>}
      {orders.map((order) => (
        <article
          className="rounded-2xl bg-surface-container-low p-5"
          key={order.id}
        >
          <div className="flex justify-between gap-3">
            <h2 className="font-bold">{order.title}</h2>
            {edit && (
              <Button
                onClick={() => {
                  setEditing(order.id);
                  setForm({
                    kind: order.kind,
                    purchaseUrl: order.purchaseUrl ?? "",
                    customerId: order.customerId ?? "",
                    jobId: order.jobId ?? "",
                    partId: order.partId ?? "",
                    costGross: order.costGross ?? "0",
                    quoteGross: order.quoteGross ?? "0",
                    costVatRate: order.costVatRate ?? "0",
                    saleVatRate: order.saleVatRate ?? "0",
                    recoverInputVat: order.recoverInputVat ?? true,
                    title: order.title,
                    supplierId: order.supplierId ?? "",
                    reference: order.reference ?? "",
                    notes: order.notes ?? "",
                  });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                {t("edit")}
              </Button>
            )}
          </div>
          <p>
            {order.supplier?.name} · {order.reference} ·{" "}
            {new Date(order.createdAt).toLocaleDateString()}
          </p>
          <p className="whitespace-pre-wrap">{order.notes}</p>
          <p>
            {t(`business.values.${order.kind}`)} · {order.customer?.name}
          </p>
          {order.jobId && (
            <Link
              className="text-primary underline"
              to={`/jobs/${order.jobId}`}
            >
              {t("business.fields.jobId")}
            </Link>
          )}
          {order.purchaseUrl && HTTP_URL.test(order.purchaseUrl) && (
            <a
              className="ml-3 text-primary underline"
              href={order.purchaseUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("business.fields.purchaseUrl")}
            </a>
          )}
          {financial && order.margin && (
            <dl className="my-3 grid gap-2 sm:grid-cols-2">
              <div>
                <dt>{t("business.fields.costGross")}</dt>
                <dd>{order.costGross} €</dd>
              </div>
              <div>
                <dt>{t("business.fields.quoteGross")}</dt>
                <dd>{order.quoteGross} €</dd>
              </div>
              <div>
                <dt>{t("business.margin")}</dt>
                <dd>
                  {order.margin.profitAfterVat} € ·{" "}
                  {order.margin.marginPercent ?? "—"}%
                </dd>
              </div>
              <div>
                <dt>{t("business.vat_balance")}</dt>
                <dd>{order.margin.vatBalance} €</dd>
              </div>
            </dl>
          )}
          <RecordWorkflow entityId={order.id} entityType="ORDER" />
          <BusinessHistory entityId={order.id} entityType="ORDER" />
        </article>
      ))}
      {cursor && (
        <Button
          onClick={async () => {
            try {
              const { data } = await api.get("/purchase-orders", {
                params: { supplierId, customerId, recordId, cursor },
              });
              setOrders((old) => [...old, ...data.data]);
              setCursor(data.nextCursor);
            } catch {
              toast.error(t("tasks.failed"));
            }
          }}
        >
          {t("tasks.more")}
        </Button>
      )}
      {supplierId && (
        <Link to="/purchase-orders">{t("workflow.all_orders")}</Link>
      )}
    </div>
  );
}
