import type { PontoPendingEntryDTO } from "@shared/types/ponto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import {
  formatClock,
  formatDayClock,
  proofSummary,
  TYPE_LABEL,
  useShopTz,
} from "./shared";

interface ShopGeo {
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
}

function bearingAndDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): { bearing: number; distM: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const distM = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { bearing, distM };
}

/** Mapa esquemático (sem tiles): círculo = raio de aceitação da loja,
 *  marcadores = entradas pendentes posicionadas por bearing/distância. */
function PendingMap({
  entries,
  geo,
}: {
  entries: PontoPendingEntryDTO[];
  geo: ShopGeo | null;
}) {
  const { t } = useTranslation();
  const size = 260;
  const c = size / 2;
  const maxR = Math.max(
    geo?.radiusM ?? 100,
    ...entries.map((e) => e.proofs.distanceM ?? 0),
    1
  );
  const scale = (c - 24) / maxR;

  const markers = useMemo(() => {
    if (!(geo?.lat != null && geo?.lng != null)) {
      return [];
    }
    return entries
      .map((e) => {
        const lat = e.proofs.lat;
        const lng = e.proofs.lng;
        if (typeof lat !== "number" || typeof lng !== "number") {
          return null;
        }
        const { bearing, distM } = bearingAndDistance(
          geo.lat as number,
          geo.lng as number,
          lat,
          lng
        );
        // bearing 0 = Norte → ângulo no SVG (0 = Este, sentido horário)
        const rad = ((90 - bearing) * Math.PI) / 180;
        const r = Math.min(distM * scale, c - 16);
        return {
          distM,
          id: e.id,
          x: c + r * Math.cos(rad),
          y: c - r * Math.sin(rad),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [entries, geo, scale, c]);

  if (!(geo?.lat && geo?.lng)) {
    return (
      <div className="rounded-2xl bg-surface-container-low p-6 text-center text-on-surface-variant text-sm">
        {t("ponto.map_no_geo")}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface-container-lowest p-4">
      <svg
        aria-label={t("ponto.pending_map_aria")}
        className="mx-auto block"
        role="img"
        style={{ maxWidth: size, width: "100%" }}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* círculo do raio de aceitação */}
        <circle
          cx={c}
          cy={c}
          fill="none"
          r={(geo.radiusM ?? 100) * scale}
          stroke="var(--color-primary)"
          strokeDasharray="6 4"
          strokeWidth="1.5"
        />
        <circle cx={c} cy={c} fill="var(--color-primary)" r="5" />
        <text
          fill="var(--color-on-surface-variant)"
          fontSize="10"
          textAnchor="middle"
          x={c}
          y={c + 18}
        >
          {t("ponto.map_shop")}
        </text>
        {markers.map((m) => (
          <g key={m.id}>
            <circle
              cx={m.x}
              cy={m.y}
              fill={m.distM <= (geo.radiusM ?? 100) ? "#16a34a" : "#d97706"}
              r="6"
            />
            <title>{`${Math.round(m.distM)}m`}</title>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-center gap-4 text-on-surface-variant text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" />
          {t("ponto.map_inside")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#d97706]" />
          {t("ponto.map_outside")}
        </span>
        <span>{t("ponto.map_radius", { radius: geo.radiusM ?? 100 })}</span>
      </div>
    </div>
  );
}

export default function PendingTab() {
  const { i18n, t } = useTranslation();
  const shopTz = useShopTz();
  const tz = shopTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [entries, setEntries] = useState<PontoPendingEntryDTO[] | null>(null);
  const [decided, setDecided] = useState<PontoPendingEntryDTO[] | null>(null);
  const [decidedError, setDecidedError] = useState(false);
  const [geo, setGeo] = useState<ShopGeo | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [pend, geoRes, dec] = await Promise.all([
        api.get<PontoPendingEntryDTO[]>("/ponto/pending"),
        api.get<ShopGeo>("/ponto/geo").catch(() => ({ data: null })),
        // A lista de decididas falha em separado: as pendências
        // continuam visíveis e a secção mostra erro com retry em vez
        // de um vazio indistinguível de «sem decisões».
        api
          .get<PontoPendingEntryDTO[]>("/ponto/decided")
          .catch(() => ({ data: "error" as const })),
      ]);
      setEntries(pend.data);
      if (dec.data === "error") {
        setDecided(null);
        setDecidedError(true);
      } else {
        setDecided(dec.data);
        setDecidedError(false);
      }
      setGeo(geoRes.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const validate = async (id: string, decision: "APROVADO" | "RECUSADO") => {
    setBusyId(id);
    try {
      await api.post(`/ponto/entries/${id}/validate`, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNoteFor(null);
      setNote("");
      await load();
    } catch {
      // erro visível via toast global do api client
    } finally {
      setBusyId(null);
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
  if (!entries) {
    return (
      <div className="h-48 animate-pulse rounded-xl bg-surface-container-low" />
    );
  }
  let decidedBody: React.ReactNode = null;
  if (decidedError) {
    decidedBody = (
      <div className="rounded-2xl bg-error-container p-4 text-center text-on-error-container text-sm">
        {t("ponto.load_failed")}
        <Button className="ms-3" onClick={load} size="sm" variant="secondary">
          {t("retry")}
        </Button>
      </div>
    );
  } else if (decided !== null && decided.length === 0) {
    decidedBody = (
      <p className="text-on-surface-variant text-sm">
        {t("ponto.decided_empty")}
      </p>
    );
  } else if (decided !== null) {
    decidedBody = "list";
  }

  const decidedSection = (
    <section className="space-y-3">
      <h2 className="font-bold text-on-surface-variant text-xs uppercase tracking-wide">
        {t("ponto.decided_recent")}
      </h2>
      {decidedBody === "list" ? null : decidedBody}
      {decidedBody === "list"
        ? (decided ?? []).map((e) => (
            <article
              className="rounded-2xl bg-surface-container-low p-4"
              key={e.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-on-surface text-sm">
                    {e.user.name || e.user.username}
                  </p>
                  <p className="text-on-surface-variant text-xs">
                    {t(TYPE_LABEL[e.type])} ·{" "}
                    {formatDayClock(e.at, i18n.language, tz)}
                    {" · "}
                    {e.effectiveStatus === "RECUSADO"
                      ? t("ponto.decision_rejected")
                      : t("ponto.decision_approved")}
                    {e.validations[0]?.byUserName
                      ? ` ${t("ponto.decided_by")} ${e.validations[0].byUserName}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {e.effectiveStatus === "RECUSADO" ? (
                    <Button
                      disabled={busyId === e.id}
                      icon="check"
                      onClick={() => validate(e.id, "APROVADO")}
                      size="sm"
                    >
                      {t("ponto.approve")}
                    </Button>
                  ) : (
                    <Button
                      disabled={busyId === e.id}
                      icon="close"
                      onClick={() => setNoteFor(e.id)}
                      size="sm"
                      variant="secondary"
                    >
                      {t("ponto.reject")}
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))
        : null}
    </section>
  );

  const rejectDialog = (
    <Dialog
      onClose={() => {
        setNoteFor(null);
        setNote("");
      }}
      open={noteFor !== null}
      title={t("ponto.reject_title")}
    >
      <div className="space-y-4">
        <Field label={t("ponto.reject_note_label")}>
          <Textarea
            onChange={(ev) => setNote(ev.target.value)}
            placeholder={t("ponto.reject_note_placeholder")}
            value={note}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              setNoteFor(null);
              setNote("");
            }}
            variant="secondary"
          >
            {t("cancel")}
          </Button>
          <Button
            disabled={busyId === noteFor}
            onClick={() => noteFor && validate(noteFor, "RECUSADO")}
            variant="destructive"
          >
            {t("ponto.reject_confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );

  if (entries.length === 0) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">
            check_circle
          </span>
          <p className="mt-3 text-on-surface-variant text-sm">
            {t("ponto.pending_empty")}
          </p>
        </div>
        {decidedSection}
        {rejectDialog}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PendingMap entries={entries} geo={geo} />
      <div className="space-y-3">
        {entries.map((e) => {
          const summary = proofSummary(e.proofs, t);
          return (
            <article
              className="rounded-2xl bg-surface-container-low p-4"
              key={e.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-on-surface text-sm">
                    {e.user.name || e.user.username}
                  </p>
                  <p className="text-on-surface-variant text-xs">
                    {t(TYPE_LABEL[e.type])} ·{" "}
                    {formatClock(e.at, i18n.language, tz)}
                    {" · "}
                    {e.transport}
                    {e.corrects
                      ? ` · ${t("ponto.corrects_prefix")} ${t(TYPE_LABEL[e.corrects.type])} ${formatClock(e.corrects.at, i18n.language, tz)}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={busyId === e.id}
                    icon="check"
                    onClick={() => validate(e.id, "APROVADO")}
                    size="sm"
                  >
                    {t("ponto.approve")}
                  </Button>
                  <Button
                    disabled={busyId === e.id}
                    icon="close"
                    onClick={() => setNoteFor(e.id)}
                    size="sm"
                    variant="secondary"
                  >
                    {t("ponto.reject")}
                  </Button>
                </div>
              </div>

              {summary.length > 0 && (
                <p className="mt-2 text-on-surface-variant text-xs">
                  {summary.join(" · ")}
                </p>
              )}
              {e.reason && (
                <p className="mt-1 text-on-surface-variant text-xs italic">
                  “{e.reason}”
                </p>
              )}

              {e.photos.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {e.photos.map((p) => (
                    <a href={p.url} key={p.id} rel="noreferrer" target="_blank">
                      <img
                        alt={t("ponto.photo_alt")}
                        className="h-20 w-20 rounded-lg border border-outline-variant object-cover"
                        height={80}
                        src={p.url}
                        width={80}
                      />
                    </a>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {decidedSection}
      {rejectDialog}
    </div>
  );
}
