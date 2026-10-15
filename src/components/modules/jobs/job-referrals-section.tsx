import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";

interface Referral {
  createdAt: string;
  createdBy?: { name: string; username: string } | null;
  id: string;
  notes: string | null;
  reason: string | null;
  status: string;
  toShopContact: string | null;
  toShopName: string;
}

const STATUSES = ["SENT", "ACCEPTED", "COMPLETED", "CANCELLED"];

export default function JobReferralsSection({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    toShopName: "",
    toShopContact: "",
    reason: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/jobs/${jobId}/referrals`);
      setReferrals(res.data?.data ?? []);
    } catch {
      // silent — section is additive
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.toShopName.trim() || busy) {
      return;
    }
    setBusy(true);
    try {
      await api.post(`/jobs/${jobId}/referrals`, {
        toShopName: form.toShopName.trim(),
        toShopContact: form.toShopContact.trim() || undefined,
        reason: form.reason.trim() || undefined,
      });
      toast.success(t("referrals.saved"));
      setForm({ toShopName: "", toShopContact: "", reason: "" });
      setOpen(false);
      load();
    } catch {
      toast.error(t("referrals.save_failed"));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/referrals/${id}`, { status });
      load();
    } catch (err) {
      const code = (err as { code?: string }).code;
      toast.error(
        t(
          code === "INVALID_TRANSITION"
            ? "errors.invalid_transition"
            : "referrals.save_failed"
        )
      );
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold font-headline text-base text-on-surface">
          {t("referrals.title")}
        </h2>
        <Button
          icon="send"
          onClick={() => setOpen(true)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("referrals.forward")}
        </Button>
      </div>

      {referrals.length === 0 ? (
        <p className="text-on-surface-variant text-sm">
          {t("referrals.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {referrals.map((r) => (
            <li
              className="flex flex-col gap-2 rounded-xl bg-surface-container-lowest p-4 sm:flex-row sm:items-center sm:justify-between"
              key={r.id}
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold text-on-surface text-sm">
                  {r.toShopName}
                </p>
                <p className="text-on-surface-variant text-xs">
                  {[
                    r.toShopContact,
                    r.reason,
                    new Date(r.createdAt).toLocaleDateString(),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Select
                aria-label={t("referrals.status")}
                className="sm:w-40"
                onChange={(e) => setStatus(r.id, e.target.value)}
                value={r.status}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`referrals.status_${s.toLowerCase()}`)}
                  </option>
                ))}
              </Select>
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
                {t("referrals.forward")}
              </h3>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
                onClick={() => setOpen(false)}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form className="space-y-4 p-6" onSubmit={submit}>
              <p className="text-on-surface-variant text-sm">
                {t("referrals.hint")}
              </p>
              <Field label={t("referrals.to_shop")} required>
                <Input
                  onChange={(e) =>
                    setForm((p) => ({ ...p, toShopName: e.target.value }))
                  }
                  required
                  value={form.toShopName}
                />
              </Field>
              <Field label={t("referrals.to_contact")}>
                <Input
                  onChange={(e) =>
                    setForm((p) => ({ ...p, toShopContact: e.target.value }))
                  }
                  placeholder={t("referrals.to_contact_placeholder")}
                  value={form.toShopContact}
                />
              </Field>
              <Field label={t("referrals.reason")}>
                <Textarea
                  onChange={(e) =>
                    setForm((p) => ({ ...p, reason: e.target.value }))
                  }
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
                {t("referrals.forward")}
              </Button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
