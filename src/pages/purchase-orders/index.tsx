import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { RecordWorkflow } from "@/components/modules/tasks/record-workflow";
import { WorkflowStatesManager } from "@/components/modules/tasks/workflow-states-manager";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";

interface Order {
  createdAt: string;
  id: string;
  notes: string | null;
  reference: string | null;
  supplier: { id: string; name: string } | null;
  supplierId: string | null;
  title: string;
}
const EMPTY = { title: "", supplierId: "", reference: "", notes: "" };
export default function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const supplierId = params.get("supplierId") || undefined;
  const [orders, setOrders] = useState<Order[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>(
    []
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY, supplierId: supplierId ?? "" });
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = useCan({ parts: ["manageCatalog"] });
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/purchase-orders", {
        params: { supplierId },
      });
      setOrders(data.data);
      setCursor(data.nextCursor);
    } catch {
      toast.error(t("tasks.failed"));
    }
  }, [supplierId, t]);
  useEffect(() => {
    load();
    api
      .get("/suppliers")
      .then(({ data }) => setSuppliers(data.data))
      .catch(() => toast.error(t("tasks.failed")));
  }, [load, t]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = { ...form, supplierId: form.supplierId || null };
      if (editing) {
        await api.patch(`/purchase-orders/${editing}`, data);
      } else {
        await api.post("/purchase-orders", data);
      }
      setEditing("");
      setForm({ ...EMPTY, supplierId: supplierId ?? "" });
      await load();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <WorkflowStatesManager entityType="ORDER" />
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
          <RecordWorkflow entityId={order.id} entityType="ORDER" />
        </article>
      ))}
      {cursor && (
        <Button
          onClick={async () => {
            try {
              const { data } = await api.get("/purchase-orders", {
                params: { supplierId, cursor },
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
