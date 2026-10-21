import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { RecordWorkflow } from "@/components/modules/tasks/record-workflow";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import api from "@/lib/api";

interface Supplier {
  _count?: { rmas: number };
  address: string | null;
  email: string | null;
  id: string;
  isActive: boolean;
  name: string;
  notes: string | null;
  phone: string | null;
  taxId: string | null;
}

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  taxId: "",
  address: "",
  notes: "",
};

function SupplierModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState(
    supplier
      ? {
          name: supplier.name,
          email: supplier.email ?? "",
          phone: supplier.phone ?? "",
          taxId: supplier.taxId ?? "",
          address: supplier.address ?? "",
          notes: supplier.notes ?? "",
        }
      : EMPTY
  );
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof EMPTY>) =>
    setForm((p) => ({ ...p, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || busy) {
      return;
    }
    setBusy(true);
    try {
      // On edit, emptied fields go as null so the server clears them —
      // undefined would leave the old value untouched.
      const payload = supplier
        ? {
            name: form.name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            taxId: form.taxId.trim() || null,
            address: form.address.trim() || null,
            notes: form.notes.trim() || null,
          }
        : {
            name: form.name.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            taxId: form.taxId.trim() || undefined,
            address: form.address.trim() || undefined,
            notes: form.notes.trim() || undefined,
          };
      if (supplier) {
        await api.patch(`/suppliers/${supplier.id}`, payload);
      } else {
        await api.post("/suppliers", payload);
      }
      toast.success(t("suppliers.saved"));
      onSaved();
      onClose();
    } catch {
      toast.error(t("suppliers.save_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
        type="button"
      />
      <div className="modal-surface relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-b-none bg-surface-container-lowest shadow-2xl sm:max-h-[80vh] sm:max-w-md sm:rounded-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="font-bold font-headline text-lg text-on-surface">
            {supplier ? t("suppliers.edit") : t("suppliers.add")}
          </h2>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form
          className="flex-1 space-y-4 overflow-y-auto p-6"
          onSubmit={submit}
        >
          <Field label={t("suppliers.name")} required>
            <Input
              onChange={(e) => set({ name: e.target.value })}
              required
              value={form.name}
            />
          </Field>
          <Field label={t("suppliers.email")}>
            <Input
              onChange={(e) => set({ email: e.target.value })}
              type="email"
              value={form.email}
            />
          </Field>
          <Field label={t("suppliers.phone")}>
            <Input
              onChange={(e) => set({ phone: e.target.value })}
              value={form.phone}
            />
          </Field>
          <Field label={t("suppliers.tax_id")}>
            <Input
              onChange={(e) => set({ taxId: e.target.value })}
              value={form.taxId}
            />
          </Field>
          <Field label={t("suppliers.address")}>
            <Input
              onChange={(e) => set({ address: e.target.value })}
              value={form.address}
            />
          </Field>
          <Field label={t("suppliers.notes")}>
            <Textarea
              onChange={(e) => set({ notes: e.target.value })}
              rows={3}
              value={form.notes}
            />
          </Field>
          <Button
            className="w-full"
            loading={busy}
            size="lg"
            type="submit"
            variant="primary-gradient"
          >
            {t("save")}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"closed" | "new" | Supplier>("closed");
  const debounced = useDebounce(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/suppliers", {
        params: {
          search: debounced.trim() || undefined,
          includeInactive: "true",
        },
      });
      setSuppliers(res.data?.data ?? []);
    } catch {
      toast.error(t("suppliers.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [debounced, t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (s: Supplier) => {
    try {
      await api.patch(`/suppliers/${s.id}`, { isActive: !s.isActive });
      load();
    } catch {
      toast.error(t("suppliers.save_failed"));
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("suppliers.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("suppliers.desc")}
          </p>
        </div>
        <Button
          icon="add"
          onClick={() => setModal("new")}
          size="md"
          type="button"
          variant="primary-gradient"
        >
          {t("suppliers.add")}
        </Button>
      </div>

      <div className="mb-5">
        <Input
          iconStart="search"
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("suppliers.search_placeholder")}
          value={search}
        />
      </div>

      <div className="overflow-hidden rounded-2xl bg-surface-container-low">
        {loading && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div
                className="h-14 animate-pulse rounded-xl bg-surface-container-high"
                key={i}
              />
            ))}
          </div>
        )}
        {!(loading || suppliers.length > 0) && (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              className="text-on-surface-variant"
              name="local_shipping"
              size="xl"
            />
            <p className="mt-3 font-bold font-headline text-lg text-on-surface">
              {t("suppliers.empty")}
            </p>
          </div>
        )}
        {!loading && suppliers.length > 0 && (
          <ul className="divide-y divide-outline-variant/30">
            {suppliers.map((s) => (
              <li
                className="flex items-center justify-between gap-3 px-5 py-4"
                key={s.id}
              >
                <div className="min-w-0 flex-1">
                  <RecordWorkflow entityId={s.id} entityType="SUPPLIER" />
                  <Link
                    className="text-primary underline"
                    to={`/purchase-orders?supplierId=${s.id}`}
                  >
                    {t("workflow.orders")}
                  </Link>
                  <p className="truncate font-bold text-on-surface text-sm">
                    <Link
                      className="hover:text-primary hover:underline"
                      to={`/suppliers/${s.id}`}
                    >
                      {s.name}
                    </Link>
                    {!s.isActive && (
                      <span className="ml-2 rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant text-xs">
                        {t("suppliers.inactive")}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-on-surface-variant text-xs">
                    {[s.phone, s.email, s.taxId].filter(Boolean).join(" · ") ||
                      t("suppliers.no_contact")}
                  </p>
                </div>
                <span className="rounded-full bg-primary-container px-2.5 py-1 font-bold text-on-primary-container text-xs">
                  {t("suppliers.rma_count", { count: s._count?.rmas ?? 0 })}
                </span>
                <div className="flex gap-1">
                  <button
                    aria-label={t("edit")}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
                    onClick={() => setModal(s)}
                    type="button"
                  >
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                  <button
                    aria-label={t("suppliers.toggle_active")}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
                    onClick={() => toggleActive(s)}
                    type="button"
                  >
                    <span className="material-symbols-outlined">
                      {s.isActive ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modal !== "closed" && (
        <SupplierModal
          onClose={() => setModal("closed")}
          onSaved={load}
          supplier={modal === "new" ? null : modal}
        />
      )}
    </>
  );
}
