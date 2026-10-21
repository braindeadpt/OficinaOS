import type { WorkflowType } from "@shared/constants/workflow";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";
export function BusinessHistory({
  entityType,
  entityId,
}: {
  entityType: WorkflowType;
  entityId: string;
}) {
  const admin = useCan({ settings: ["edit"] });
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return admin ? (
    <details
      className="my-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold text-primary">
        {t("business.history")}
      </summary>
      {open && <HistoryContent entityId={entityId} entityType={entityType} />}
    </details>
  ) : null;
}
function HistoryContent({
  entityType,
  entityId,
}: {
  entityType: WorkflowType;
  entityId: string;
}) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<
    { id: string; subject: string; body: string; channel: string }[]
  >([]);
  const [next, setNext] = useState<string | null>(null);
  const party = entityType === "CUSTOMER" || entityType === "SUPPLIER";
  const filter = entityType === "CUSTOMER" ? "customerId" : "supplierId";
  const load = useCallback(
    async (cursor?: string) => {
      try {
        const { data } = await api.get("/business/messages", {
          params: {
            ...messageFilter(entityType, entityId),
            cursor,
          },
        });
        setMessages((old) => (cursor ? [...old, ...data.data] : data.data));
        setNext(data.nextCursor);
      } catch {
        toast.error(t("tasks.failed"));
      }
    },
    [entityType, entityId, t]
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="space-y-3 rounded-xl bg-surface-container-low p-4">
      <h2 className="font-bold">{t("business.history")}</h2>
      {party && (
        <div className="flex flex-wrap gap-4">
          {["tickets", "messages", "agreements", "purchase-orders"].map(
            (module) => (
              <Link
                className="text-primary underline"
                key={module}
                to={`/${module}?${filter}=${encodeURIComponent(entityId)}`}
              >
                {t(
                  module === "purchase-orders"
                    ? "workflow.orders"
                    : `business.${module}`
                )}
              </Link>
            )
          )}
        </div>
      )}
      {!messages.length && <p>{t("business.empty")}</p>}
      {messages.map((message) => (
        <details key={message.id}>
          <summary>
            {message.channel} · {message.subject}
          </summary>
          <p className="whitespace-pre-wrap">{message.body}</p>
        </details>
      ))}
      {next && <Button onClick={() => load(next)}>{t("tasks.more")}</Button>}
    </section>
  );
}
export function SupplierCustomerLink({ supplierId }: { supplierId: string }) {
  const admin = useCan({ settings: ["edit"] });
  return admin ? <IdentityEditor supplierId={supplierId} /> : null;
}
function IdentityEditor({ supplierId }: { supplierId: string }) {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>(
    []
  );
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .get("/business/parties")
      .then(({ data }) => {
        setCustomers(data.customers);
        setCustomerId(
          data.suppliers.find((row: { id: string }) => row.id === supplierId)
            ?.customerId ?? ""
        );
      })
      .catch(() => toast.error(t("tasks.failed")));
  }, [supplierId, t]);
  return (
    <section className="my-4 space-y-2 rounded-xl bg-surface-container-low p-4">
      <h2 className="font-bold">{t("business.same_party")}</h2>
      <p>{t("business.identity_hint")}</p>
      <Select
        aria-label={t("business.fields.customerId")}
        onChange={(event) => setCustomerId(event.target.value)}
        value={customerId}
      >
        <option value="">—</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </Select>
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.put(`/business/identity/${supplierId}`, {
              customerId: customerId || null,
            });
            toast.success(t("business.saved"));
          } catch {
            toast.error(t("tasks.failed"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("save")}
      </Button>
      {customerId && (
        <Link
          className="ml-3 text-primary underline"
          to={`/customers/${customerId}`}
        >
          {t("business.open_customer")}
        </Link>
      )}
    </section>
  );
}

function messageFilter(entityType: WorkflowType, entityId: string) {
  if (entityType === "CUSTOMER") {
    return { customerId: entityId };
  }
  if (entityType === "SUPPLIER") {
    return { supplierId: entityId };
  }
  return { entityType, entityId };
}
