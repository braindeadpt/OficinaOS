import type { PontoMissingExitDTO } from "@shared/types/ponto";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import { formatClock, formatDay, TYPE_LABEL } from "./shared";

function ymdDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default function MissingTab() {
  const { i18n, t } = useTranslation();
  const [from, setFrom] = useState(ymdDaysAgo(30));
  const [to, setTo] = useState(ymdDaysAgo(0));
  const [items, setItems] = useState<PontoMissingExitDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [modalFor, setModalFor] = useState<PontoMissingExitDTO | null>(null);
  const [at, setAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ from, to });
      const res = await api.get<PontoMissingExitDTO[]>(
        `/ponto/missing-exits?${params}`
      );
      setItems(res.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [from, to]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const openModal = (item: PontoMissingExitDTO) => {
    // Pré-preenche com o fim do dia civil da loja — o gestor ajusta.
    const dayEnd = new Date(`${item.date}T23:59`);
    setAt(
      Number.isNaN(dayEnd.getTime())
        ? ""
        : new Date().toISOString().slice(0, 16)
    );
    setReason("");
    setModalFor(item);
  };

  const submit = async () => {
    if (!(modalFor && at)) {
      return;
    }
    setBusy(true);
    try {
      await api.post("/ponto/entries", {
        at: new Date(at).toISOString(),
        reason: reason.trim() || undefined,
        type: "SAIDA",
        userId: modalFor.userId,
      });
      setModalFor(null);
      await load();
    } catch {
      // toast global
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="rounded-2xl bg-error-container p-4 text-center text-on-error-container text-sm">
        {t("ponto.load_failed")}
        <Button className="ms-3" onClick={load} size="sm" variant="secondary">
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="h-48 animate-pulse rounded-xl bg-surface-container-low" />
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">
          task_alt
        </span>
        <p className="mt-3 text-on-surface-variant text-sm">
          {t("ponto.missing_empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("ponto.from")}>
          <Input
            onChange={(e) => setFrom(e.target.value)}
            type="date"
            value={from}
          />
        </Field>
        <Field label={t("ponto.to")}>
          <Input
            onChange={(e) => setTo(e.target.value)}
            type="date"
            value={to}
          />
        </Field>
        <Button icon="refresh" onClick={load} size="sm" variant="secondary">
          {t("refresh")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-surface-container-lowest">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-outline-variant border-b text-left text-on-surface-variant text-xs">
              <th className="px-4 py-3 font-semibold">{t("ponto.col_date")}</th>
              <th className="px-4 py-3 font-semibold">{t("ponto.col_user")}</th>
              <th className="px-4 py-3 font-semibold">
                {t("ponto.col_last_event")}
              </th>
              <th className="px-4 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr
                className="border-outline-variant/50 border-b last:border-0"
                key={`${m.userId}-${m.date}`}
              >
                <td className="whitespace-nowrap px-4 py-2.5">
                  {formatDay(m.date, i18n.language)}
                </td>
                <td className="px-4 py-2.5 font-medium">{m.userName}</td>
                <td className="px-4 py-2.5 text-on-surface-variant">
                  {t(TYPE_LABEL[m.lastType])} ·{" "}
                  {formatClock(m.lastAt, i18n.language)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    icon="logout"
                    onClick={() => openModal(m)}
                    size="sm"
                    variant="secondary"
                  >
                    {t("ponto.register_exit")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        onClose={() => setModalFor(null)}
        open={modalFor !== null}
        title={t("ponto.register_exit_title", {
          name: modalFor?.userName ?? "",
        })}
      >
        <div className="space-y-4">
          <Field label={t("ponto.exit_at")}>
            <Input
              onChange={(e) => setAt(e.target.value)}
              type="datetime-local"
              value={at}
            />
          </Field>
          <Field label={t("ponto.reason_optional")}>
            <Textarea
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("ponto.reason_placeholder")}
              value={reason}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalFor(null)} variant="secondary">
              {t("cancel")}
            </Button>
            <Button disabled={busy || !at} onClick={submit}>
              {t("ponto.register_exit_confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
