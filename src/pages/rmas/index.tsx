import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { RecordWorkflow } from "@/components/modules/tasks/record-workflow";
import { WorkflowStatesManager } from "@/components/modules/tasks/workflow-states-manager";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";

interface Supplier {
  id: string;
  name: string;
}

interface Part {
  id: string;
  name: string;
}

interface Rma {
  createdAt: string;
  description: string;
  id: string;
  job?: { id: string; jobCode: string } | null;
  part: Part | null;
  quantity: number;
  reason: string | null;
  reference: string | null;
  resolvedAt: string | null;
  sentAt: string | null;
  status: string;
  supplier: Supplier | null;
}

const STATUSES = ["OPEN", "SENT", "RECEIVED", "RESOLVED", "CANCELLED"];

function RmaModal({
  jobCode,
  suppliers,
  parts,
  onClose,
  onSaved,
}: {
  jobCode: string;
  suppliers: Supplier[];
  parts: Part[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    supplierId: "",
    jobCode,
    partId: "",
    description: "",
    quantity: "1",
    reference: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) =>
    setForm((p) => ({ ...p, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(form.supplierId && form.description.trim()) || busy) {
      return;
    }
    setBusy(true);
    try {
      await api.post("/supplier-rmas", {
        supplierId: form.supplierId,
        jobCode: form.jobCode.trim() || undefined,
        partId: form.partId || undefined,
        description: form.description.trim(),
        quantity: Number.parseInt(form.quantity, 10) || 1,
        reference: form.reference.trim() || undefined,
        reason: form.reason.trim() || undefined,
      });
      toast.success(t("rmas.saved"));
      onSaved();
      onClose();
    } catch {
      toast.error(t("rmas.save_failed"));
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
            {t("rmas.add")}
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
          <Field label={t("rmas.supplier")} required>
            <Select
              onChange={(e) => set({ supplierId: e.target.value })}
              required
              value={form.supplierId}
            >
              <option value="">{t("rmas.pick_supplier")}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("rmas.job_code")}>
            <Input
              onChange={(e) => set({ jobCode: e.target.value })}
              value={form.jobCode}
            />
          </Field>
          <Field label={t("rmas.part")}>
            <Select
              onChange={(e) => set({ partId: e.target.value })}
              value={form.partId}
            >
              <option value="">{t("rmas.no_part")}</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("rmas.description")} required>
            <Input
              onChange={(e) => set({ description: e.target.value })}
              placeholder={t("rmas.description_placeholder")}
              required
              value={form.description}
            />
          </Field>
          <Field label={t("rmas.quantity")}>
            <Input
              min={1}
              onChange={(e) => set({ quantity: e.target.value })}
              type="number"
              value={form.quantity}
            />
          </Field>
          <Field label={t("rmas.reference")}>
            <Input
              onChange={(e) => set({ reference: e.target.value })}
              value={form.reference}
            />
          </Field>
          <Field label={t("rmas.reason")}>
            <Textarea
              onChange={(e) => set({ reason: e.target.value })}
              rows={3}
              value={form.reason}
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

export default function SupplierRmasPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const jobId = params.get("jobId") || undefined;
  const jobCode = params.get("jobCode") || "";
  const [rmas, setRmas] = useState<Rma[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, p] = await Promise.allSettled([
        api.get("/supplier-rmas", {
          params: { status: statusFilter || undefined, jobId },
        }),
        api.get("/suppliers"),
        api.get("/parts", { params: { limit: 100 } }),
      ]);
      if (r.status === "fulfilled") {
        setRmas(r.value.data?.data ?? []);
      }
      if (s.status === "fulfilled") {
        setSuppliers(s.value.data?.data ?? []);
      }
      if (p.status === "fulfilled") {
        setParts(p.value.data?.parts ?? []);
      }
      if ([r, s, p].some((result) => result.status === "rejected")) {
        toast.error(t("rmas.load_failed"));
      }
    } catch {
      toast.error(t("rmas.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, jobId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (rma: Rma, status: string) => {
    try {
      await api.patch(`/supplier-rmas/${rma.id}`, { status });
      load();
    } catch {
      toast.error(t("rmas.save_failed"));
    }
  };

  return (
    <>
      <WorkflowStatesManager entityType="RMA" />
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("rmas.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("rmas.desc")}
          </p>
        </div>
        <Button
          icon="add"
          onClick={() => setShowModal(true)}
          size="md"
          type="button"
          variant="primary-gradient"
        >
          {t("rmas.add")}
        </Button>
      </div>

      <div className="mb-5 sm:w-64">
        <Select
          aria-label={t("rmas.filter_status")}
          onChange={(e) => setStatusFilter(e.target.value)}
          value={statusFilter}
        >
          <option value="">{t("rmas.all_statuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`rmas.status_${s.toLowerCase()}`)}
            </option>
          ))}
        </Select>
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
        {!(loading || rmas.length > 0) && (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon
              className="text-on-surface-variant"
              name="assignment_return"
              size="xl"
            />
            <p className="mt-3 font-bold font-headline text-lg text-on-surface">
              {t("rmas.empty")}
            </p>
          </div>
        )}
        {!loading && rmas.length > 0 && (
          <ul className="divide-y divide-outline-variant/30">
            {rmas.map((rma) => (
              <li
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                key={rma.id}
              >
                <div className="min-w-0 flex-1">
                  <RecordWorkflow entityId={rma.id} entityType="RMA" />
                  {rma.job && (
                    <Link
                      className="text-primary text-sm underline"
                      to={`/jobs/${rma.job.id}`}
                    >
                      {rma.job.jobCode}
                    </Link>
                  )}
                  <p className="truncate font-bold text-on-surface text-sm">
                    {rma.description}
                    <span className="ml-2 font-normal text-on-surface-variant">
                      ×{rma.quantity}
                    </span>
                  </p>
                  <p className="truncate text-on-surface-variant text-xs">
                    {[
                      rma.supplier?.name,
                      rma.part?.name,
                      rma.reference,
                      new Date(rma.createdAt).toLocaleDateString(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Select
                  aria-label={t("rmas.status")}
                  className="sm:w-44"
                  onChange={(e) => setStatus(rma, e.target.value)}
                  value={rma.status}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`rmas.status_${s.toLowerCase()}`)}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showModal && (
        <RmaModal
          jobCode={jobCode}
          onClose={() => setShowModal(false)}
          onSaved={load}
          parts={parts}
          suppliers={suppliers}
        />
      )}
    </>
  );
}
