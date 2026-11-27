import type {
  PontoInfoDeliveriesResponse,
  PontoInfoDeliveryRowDTO,
} from "@shared/types/ponto";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import api from "@/lib/api";
import { usePontoStore } from "@/stores/ponto";

/** Dia civil de hoje no fuso DA LOJA — o dia do dispositivo pode já ser
 *  amanhã (ou ainda ontem) e gravava a entrega na data errada. O formato
 *  é montado pelas partes: o en-CA nem sempre devolve AAAA-MM-DD em
 *  todos os navegadores e o campo de data ficava em branco. */
function todayYmd(tz: string | null): string {
  if (!tz) {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: tz,
    year: "numeric",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default function TeamInfoSheets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shopTz = usePontoStore((s) => s.tz);
  const [data, setData] = useState<PontoInfoDeliveriesResponse | null>(null);
  const [editing, setEditing] = useState<PontoInfoDeliveryRowDTO | null>(null);
  const [deliveredAt, setDeliveredAt] = useState(() => todayYmd(null));
  const [signed, setSigned] = useState("no");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [printAllEmpty, setPrintAllEmpty] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<PontoInfoDeliveriesResponse>(
      "/ponto/info-deliveries"
    );
    setData(res.data);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // A Equipa emite este evento quando ativa/desativa o ponto de alguém —
  // sem o refresco, a lista (e o botão de impressão em lote) ficava presa
  // aos destinatários de quando o separador abriu.
  useEffect(() => {
    const refresh = () => {
      setPrintAllEmpty(false);
      load().catch(() => undefined);
    };
    window.addEventListener("ponto-info-deliveries-changed", refresh);
    return () =>
      window.removeEventListener("ponto-info-deliveries-changed", refresh);
  }, [load]);

  const open = (row: PontoInfoDeliveryRowDTO) => {
    setEditing(row);
    setDeliveredAt(row.delivery?.deliveredAt ?? todayYmd(shopTz));
    setSigned(row.delivery?.signed ? "yes" : "no");
    setError(false);
  };

  const save = async () => {
    if (!editing) {
      return;
    }
    setBusy(true);
    setError(false);
    try {
      await api.put(`/ponto/info-deliveries/${editing.userId}`, {
        deliveredAt,
        signed: signed === "yes",
      });
      setEditing(null);
      // Sem load() aqui: o próprio componente ouve o evento e refresca —
      // carregar antes de emitir pedia a mesma lista duas vezes.
      window.dispatchEvent(new Event("ponto-info-deliveries-changed"));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="h-28 animate-pulse rounded-xl bg-surface-container-low" />
    );
  }

  return (
    <section className="rounded-2xl bg-surface-container-lowest p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-bold text-on-surface text-sm">
            {t("ponto.info_doc_title")}
          </h2>
          <p className="mt-1 text-on-surface-variant text-xs">
            {t("ponto.sheet_missing_warning", {
              count: data.missingActiveCount,
            })}
          </p>
        </div>
        <Button
          className="ml-auto"
          icon="print"
          onClick={async () => {
            // A impressão em lote só inclui ativos com ponto. Consultar a
            // lista fresca ao clicar: a ativação do ponto noutro separador
            // pode ter mudado os destinatários desde o carregamento.
            let rows = data.rows;
            try {
              const res = await api.get<PontoInfoDeliveriesResponse>(
                "/ponto/info-deliveries"
              );
              setData(res.data);
              rows = res.data.rows;
            } catch {
              // Sem rede decide-se com a lista em memória.
            }
            const printable = rows.filter(
              (r) => r.isActive && r.pontoEnabled
            ).length;
            if (printable === 0) {
              setPrintAllEmpty(true);
              return;
            }
            navigate("/ponto/info?all=1");
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("ponto.sheet_print_all")}
        </Button>
      </div>
      {printAllEmpty && (
        <p className="mt-2 text-error text-xs" role="alert">
          {t("ponto.sheet_print_all_empty")}
        </p>
      )}
      <div className="mt-4 divide-y divide-outline-variant">
        {data.rows.map((row) => (
          <div
            className="flex flex-wrap items-center gap-3 py-3"
            key={row.userId}
          >
            <div className="min-w-40">
              <p className="font-medium text-sm">{row.name}</p>
              <p className="text-on-surface-variant text-xs">@{row.username}</p>
            </div>
            <div className="text-sm">
              {row.delivery ? (
                <>
                  {t("ponto.sheet_delivered_at")} {row.delivery.deliveredAt} ·{" "}
                  {t("ponto.sheet_signed")}:{" "}
                  {row.delivery.signed
                    ? t("ponto.sheet_signed_yes")
                    : t("ponto.sheet_signed_no")}
                  <span className="block text-on-surface-variant text-xs">
                    {t("ponto.sheet_registered_by", {
                      name: row.delivery.registeredByName,
                    })}
                  </span>
                </>
              ) : (
                <span className="text-error">
                  {t("ponto.sheet_not_delivered")}
                </span>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <Button
                icon="print"
                onClick={() => navigate(`/ponto/info?userId=${row.userId}`)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {t("ponto.sheet_print")}
              </Button>
              <Button onClick={() => open(row)} size="sm" type="button">
                {t("ponto.sheet_register")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        onClose={() => setEditing(null)}
        open={editing !== null}
        title={t("ponto.sheet_register")}
      >
        {editing && (
          <div className="space-y-4">
            <p className="font-medium text-sm">{editing.name}</p>
            <Field label={t("ponto.sheet_delivered_at")}>
              <Input
                onChange={(e) => setDeliveredAt(e.target.value)}
                type="date"
                value={deliveredAt}
              />
            </Field>
            <Field label={t("ponto.sheet_signed")}>
              <Select
                onChange={(e) => setSigned(e.target.value)}
                value={signed}
              >
                <option value="yes">{t("ponto.sheet_signed_yes")}</option>
                <option value="no">{t("ponto.sheet_signed_no")}</option>
              </Select>
            </Field>
            {error && (
              <p className="text-error text-sm">
                {t("ponto.sheet_save_failed")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setEditing(null)}
                type="button"
                variant="secondary"
              >
                {t("cancel")}
              </Button>
              <Button disabled={busy} onClick={save} type="button">
                {t("ponto.sheet_save")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
