import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";

interface ExternalRepair {
  costFinal: number | null;
  createdAt: string;
  expectedReturnAt: string | null;
  id: string;
  kind: string;
  notes: string | null;
  reference: string | null;
  returnedAt: string | null;
  sentAt: string;
  status: string;
  supplier: { id: string; name: string };
}

interface SupplierOption {
  id: string;
  name: string;
}

const EMPTY_FORM = {
  costFinal: "",
  expectedReturnAt: "",
  kind: "REPAIRER",
  notes: "",
  reference: "",
  supplierId: "",
};

export default function JobExternalRepairsSection({
  jobId,
  onChanged,
}: {
  jobId: string;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [repairs, setRepairs] = useState<ExternalRepair[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [open, setOpen] = useState(false);
  const [returning, setReturning] = useState<ExternalRepair | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [returnCost, setReturnCost] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/jobs/${jobId}/external-repairs`);
      setRepairs(res.data ?? []);
    } catch {
      // silent — section is additive
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const openSend = async () => {
    setOpen(true);
    if (suppliers.length === 0) {
      try {
        const res = await api.get("/external-repairs/suppliers");
        setSuppliers(res.data?.data ?? []);
      } catch {
        toast.error(t("external_repairs.load_failed"));
      }
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.supplierId || busy) {
      return;
    }
    setBusy(true);
    try {
      await api.post(`/jobs/${jobId}/external-repairs`, {
        supplierId: form.supplierId,
        kind: form.kind,
        reference: form.reference.trim() || undefined,
        notes: form.notes.trim() || undefined,
        expectedReturnAt: form.expectedReturnAt || undefined,
      });
      toast.success(t("external_repairs.saved"));
      setForm(EMPTY_FORM);
      setOpen(false);
      await load();
      onChanged?.();
    } catch {
      toast.error(t("external_repairs.save_failed"));
    } finally {
      setBusy(false);
    }
  };

  const markReturned = async () => {
    if (!returning || busy) {
      return;
    }
    setBusy(true);
    try {
      await api.post(`/external-repairs/${returning.id}/return`, {
        costFinal: returnCost.trim() === "" ? undefined : Number(returnCost),
      });
      toast.success(t("external_repairs.returned"));
      setReturning(null);
      setReturnCost("");
      await load();
      onChanged?.();
    } catch {
      toast.error(t("external_repairs.save_failed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await api.post(`/external-repairs/${id}/cancel`);
      await load();
      onChanged?.();
    } catch {
      toast.error(t("external_repairs.save_failed"));
    }
  };

  const openRepair = repairs.find((r) => r.status === "SENT");
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : "—";

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold font-headline text-base text-on-surface">
          {t("external_repairs.title")}
          {openRepair && (
            <span className="rounded-full bg-tertiary/15 px-2.5 py-0.5 font-label text-tertiary text-xs">
              {t("external_repairs.badge", { name: openRepair.supplier.name })}
            </span>
          )}
        </h2>
        {!openRepair && (
          <Button
            icon="send"
            onClick={openSend}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("external_repairs.send")}
          </Button>
        )}
      </div>

      {repairs.length === 0 ? (
        <p className="text-on-surface-variant text-sm">
          {t("external_repairs.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {repairs.map((r) => (
            <li
              className="flex flex-col gap-2 rounded-xl bg-surface-container-lowest p-4 sm:flex-row sm:items-center sm:justify-between"
              key={r.id}
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold text-on-surface text-sm">
                  {r.supplier.name}
                  <span className="ms-2 font-normal text-on-surface-variant text-xs">
                    {t(`external_repairs.kind_${r.kind.toLowerCase()}`)}
                  </span>
                </p>
                <p className="text-on-surface-variant text-xs">
                  {[
                    r.reference &&
                      t("external_repairs.ref", { ref: r.reference }),
                    t("external_repairs.sent_at", { date: fmt(r.sentAt) }),
                    r.expectedReturnAt &&
                      t("external_repairs.expected", {
                        date: fmt(r.expectedReturnAt),
                      }),
                    r.returnedAt &&
                      t("external_repairs.returned_at", {
                        date: fmt(r.returnedAt),
                      }),
                    r.costFinal !== null &&
                      t("external_repairs.cost", { cost: r.costFinal }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-label text-on-surface-variant text-xs uppercase">
                  {t(`external_repairs.status_${r.status.toLowerCase()}`)}
                </span>
                {r.status === "SENT" && (
                  <>
                    <Button
                      onClick={() => {
                        setReturning(r);
                        setReturnCost("");
                      }}
                      size="sm"
                      type="button"
                      variant="primary"
                    >
                      {t("external_repairs.mark_returned")}
                    </Button>
                    <Button
                      onClick={() => cancel(r.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("external_repairs.cancel")}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
          role="dialog"
        >
          <button
            aria-label={t("close_modal")}
            className="absolute inset-0 bg-overlay"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div className="modal-surface relative z-10 w-full overflow-hidden rounded-b-none bg-surface-container-lowest shadow-2xl sm:max-w-md sm:rounded-xl">
            <div className="flex items-center justify-between px-6 py-4">
              <h3 className="font-bold font-headline text-lg text-on-surface">
                {t("external_repairs.send")}
              </h3>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
                onClick={() => setOpen(false)}
                type="button"
              >
                <Icon className="text-xl" name="close" />
              </button>
            </div>
            <form className="space-y-4 p-6" onSubmit={submit}>
              <Field label={t("external_repairs.supplier")} required>
                <Select
                  onChange={(e) =>
                    setForm((p) => ({ ...p, supplierId: e.target.value }))
                  }
                  required
                  value={form.supplierId}
                >
                  <option value="">
                    {t("external_repairs.pick_supplier")}
                  </option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("external_repairs.kind")}>
                <Select
                  onChange={(e) =>
                    setForm((p) => ({ ...p, kind: e.target.value }))
                  }
                  value={form.kind}
                >
                  <option value="REPAIRER">
                    {t("external_repairs.kind_repairer")}
                  </option>
                  <option value="WARRANTY">
                    {t("external_repairs.kind_warranty")}
                  </option>
                </Select>
              </Field>
              <Field label={t("external_repairs.reference")}>
                <Input
                  onChange={(e) =>
                    setForm((p) => ({ ...p, reference: e.target.value }))
                  }
                  placeholder={t("external_repairs.reference_placeholder")}
                  value={form.reference}
                />
              </Field>
              <Field label={t("external_repairs.expected_return")}>
                <Input
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      expectedReturnAt: e.target.value,
                    }))
                  }
                  type="date"
                  value={form.expectedReturnAt}
                />
              </Field>
              <Field label={t("external_repairs.notes")}>
                <Textarea
                  onChange={(e) =>
                    setForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  rows={2}
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
                {t("external_repairs.send")}
              </Button>
            </form>
          </div>
        </div>
      )}

      {returning && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
          role="dialog"
        >
          <button
            aria-label={t("close_modal")}
            className="absolute inset-0 bg-overlay"
            onClick={() => setReturning(null)}
            type="button"
          />
          <div className="modal-surface relative z-10 w-full overflow-hidden rounded-b-none bg-surface-container-lowest shadow-2xl sm:max-w-md sm:rounded-xl">
            <div className="flex items-center justify-between px-6 py-4">
              <h3 className="font-bold font-headline text-lg text-on-surface">
                {t("external_repairs.mark_returned")}
              </h3>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
                onClick={() => setReturning(null)}
                type="button"
              >
                <Icon className="text-xl" name="close" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-on-surface-variant text-sm">
                {t("external_repairs.return_hint", {
                  name: returning.supplier.name,
                })}
              </p>
              <Field label={t("external_repairs.cost_final")}>
                <Input
                  inputMode="decimal"
                  onChange={(e) => setReturnCost(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  value={returnCost}
                />
              </Field>
              <Button
                className="w-full"
                loading={busy}
                onClick={markReturned}
                size="lg"
                type="button"
                variant="primary-gradient"
              >
                {t("external_repairs.mark_returned")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
