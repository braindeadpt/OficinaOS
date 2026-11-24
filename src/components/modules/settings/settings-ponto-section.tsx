import type { ShopSettings } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import api, { getErrorMessage } from "@/lib/api";

interface PontoStatus {
  enabled: boolean;
}

interface PontoConfig {
  configured?: boolean;
  slug?: string;
}

type PontoShop = Pick<
  ShopSettings,
  | "pontoExitReminderTime"
  | "pontoExternalAutoApprove"
  | "pontoExternalPhotoRequired"
  | "pontoGeoLat"
  | "pontoGeoLng"
  | "pontoInfoText"
  | "pontoPauseReminderMinutes"
  | "pontoRadiusM"
  | "pontoSmsNumber"
  | "pontoWaNumber"
>;

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const int = (v: string) =>
  v.trim() === "" ? undefined : Number.parseInt(v, 10);

// Mesmo visual dos links «Abrir folha…» — extraído para aplicar o estado
// desativado enquanto houver alterações por guardar.
const SHEET_LINK_CLS =
  "inline-flex min-h-8 pointer-coarse:min-h-11 items-center justify-center gap-1.5 rounded-md border border-outline bg-surface-container-lowest px-3 py-1.5 font-sans font-semibold text-on-surface text-sm transition-colors";

export default function SettingsPontoSection({
  onDirtyChange,
  onToast,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PontoStatus | null>(null);
  const [config, setConfig] = useState<PontoConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [geoLat, setGeoLat] = useState("");
  const [geoLng, setGeoLng] = useState("");
  const [radius, setRadius] = useState("100");
  const [autoApprove, setAutoApprove] = useState(true);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [exitTime, setExitTime] = useState("");
  const [pauseMinutes, setPauseMinutes] = useState("20");
  const [infoText, setInfoText] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [smsNumber, setSmsNumber] = useState("");
  // Espelho local do dirty do formulário — as folhas /ponto/* leem apenas
  // a versão guardada, por isso ficam bloqueadas enquanto houver rascunho.
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const [st, shop, cfg] = await Promise.allSettled([
      api.get<PontoStatus>("/ponto/status"),
      api.get<PontoShop>("/settings/shop"),
      api.get<PontoConfig>("/ponto/config"),
    ]);
    if (st.status === "fulfilled") {
      setStatus(st.value.data);
    }
    if (shop.status === "fulfilled") {
      const s = shop.value.data;
      setGeoLat(s.pontoGeoLat?.toString() ?? "");
      setGeoLng(s.pontoGeoLng?.toString() ?? "");
      setRadius(s.pontoRadiusM?.toString() ?? "100");
      setAutoApprove(s.pontoExternalAutoApprove ?? true);
      setPhotoRequired(s.pontoExternalPhotoRequired ?? false);
      setExitTime(s.pontoExitReminderTime ?? "");
      setPauseMinutes(s.pontoPauseReminderMinutes?.toString() ?? "20");
      setInfoText(s.pontoInfoText ?? "");
      setWaNumber(s.pontoWaNumber ?? "");
      setSmsNumber(s.pontoSmsNumber ?? "");
    }
    if (cfg.status === "fulfilled") {
      setConfig(cfg.value.data);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => null);
  }, [refresh]);

  function markDirty() {
    setDirty(true);
    onDirtyChange?.(true);
  }

  async function handleSave() {
    setBusy(true);
    try {
      await api.put("/settings/shop", {
        pontoExitReminderTime: exitTime || null,
        pontoExternalAutoApprove: autoApprove,
        pontoExternalPhotoRequired: photoRequired,
        pontoGeoLat: num(geoLat),
        pontoGeoLng: num(geoLng),
        pontoInfoText: infoText,
        pontoPauseReminderMinutes: int(pauseMinutes),
        pontoRadiusM: int(radius),
        pontoSmsNumber: smsNumber || null,
        pontoWaNumber: waNumber || null,
      });
      // Empurra os números para a Cloud — a página do QR lê-os de lá.
      // Falha aqui não invalida o save local (a Cloud pode nem estar
      // deployada ainda), mas o utilizador fica a saber.
      let synced = true;
      try {
        await api.put("/ponto/config");
      } catch {
        synced = false;
      }
      await refresh();
      setDirty(false);
      onDirtyChange?.(false);
      onToast(
        t(synced ? "ponto.saved" : "ponto.saved_sync_failed"),
        synced ? "success" : "error"
      );
    } catch (err) {
      onToast(getErrorMessage(err, t("ponto.save_failed")), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!status?.enabled) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4">
      <div>
        <div className="font-semibold text-on-surface text-sm">
          {t("ponto.title")}
        </div>
        <p className="text-on-surface-variant text-xs">{t("ponto.subtitle")}</p>
      </div>

      <div>
        <p className="mb-2 font-medium text-on-surface text-sm">
          {t("ponto.location_title")}
        </p>
        <p className="mb-3 text-on-surface-variant text-xs">
          {t("ponto.location_help")}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("ponto.latitude")}>
            <Input
              inputMode="decimal"
              onChange={(e) => {
                setGeoLat(e.target.value);
                markDirty();
              }}
              placeholder="38.7223"
              type="text"
              value={geoLat}
            />
          </Field>
          <Field label={t("ponto.longitude")}>
            <Input
              inputMode="decimal"
              onChange={(e) => {
                setGeoLng(e.target.value);
                markDirty();
              }}
              placeholder="-9.1393"
              type="text"
              value={geoLng}
            />
          </Field>
          <Field hint={t("ponto.radius_help")} label={t("ponto.radius")}>
            <Input
              inputMode="numeric"
              onChange={(e) => {
                setRadius(e.target.value);
                markDirty();
              }}
              type="text"
              value={radius}
            />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 font-medium text-on-surface text-sm">
          {t("ponto.workers_title")}
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p
              className="font-medium text-on-surface text-sm"
              id="ponto-auto-approve-label"
            >
              {t("ponto.external_auto_approve")}
            </p>
            <Switch
              ariaLabelledBy="ponto-auto-approve-label"
              checked={autoApprove}
              onChange={(checked) => {
                setAutoApprove(checked);
                markDirty();
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p
              className="font-medium text-on-surface text-sm"
              id="ponto-photo-required-label"
            >
              {t("ponto.external_photo_required")}
            </p>
            <Switch
              ariaLabelledBy="ponto-photo-required-label"
              checked={photoRequired}
              onChange={(checked) => {
                setPhotoRequired(checked);
                markDirty();
              }}
            />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 font-medium text-on-surface text-sm">
          {t("ponto.reminders_title")}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            hint={t("ponto.exit_reminder_help")}
            label={t("ponto.exit_reminder")}
          >
            <Input
              onChange={(e) => {
                setExitTime(e.target.value);
                markDirty();
              }}
              type="time"
              value={exitTime}
            />
          </Field>
          <Field
            hint={t("ponto.pause_reminder_help")}
            label={t("ponto.pause_reminder")}
          >
            <Input
              inputMode="numeric"
              onChange={(e) => {
                setPauseMinutes(e.target.value);
                markDirty();
              }}
              type="text"
              value={pauseMinutes}
            />
          </Field>
        </div>
      </div>

      <Field hint={t("ponto.info_text_help")} label={t("ponto.info_text")}>
        <Textarea
          maxLength={4000}
          onChange={(e) => {
            setInfoText(e.target.value);
            markDirty();
          }}
          rows={3}
          value={infoText}
        />
      </Field>

      <div>
        <p className="mb-2 font-medium text-on-surface text-sm">
          {t("ponto.numbers_title")}
        </p>
        <p className="mb-3 text-on-surface-variant text-xs">
          {t("ponto.numbers_help")}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("ponto.wa_number")}>
            <Input
              autoComplete="off"
              inputMode="tel"
              onChange={(e) => {
                setWaNumber(e.target.value);
                markDirty();
              }}
              placeholder="+351 912 345 678"
              type="tel"
              value={waNumber}
            />
          </Field>
          <Field label={t("ponto.sms_number")}>
            <Input
              autoComplete="off"
              inputMode="tel"
              onChange={(e) => {
                setSmsNumber(e.target.value);
                markDirty();
              }}
              placeholder="+351 210 000 000"
              type="tel"
              value={smsNumber}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-on-surface-variant text-xs">
            {config?.slug
              ? t("ponto.qr_configured", { slug: config.slug })
              : t("ponto.qr_hint")}
          </p>
          {dirty && (
            <p className="text-on-surface-variant text-xs">
              {t("ponto.sheets_save_first")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            aria-disabled={dirty}
            className={
              dirty
                ? `${SHEET_LINK_CLS} cursor-not-allowed opacity-50`
                : `${SHEET_LINK_CLS} hover:bg-surface-container`
            }
            onClick={dirty ? (e) => e.preventDefault() : undefined}
            to="/ponto/info"
          >
            {t("ponto.info_open")}
          </Link>
          <Link
            aria-disabled={dirty}
            className={
              dirty
                ? `${SHEET_LINK_CLS} cursor-not-allowed opacity-50`
                : `${SHEET_LINK_CLS} hover:bg-surface-container`
            }
            onClick={dirty ? (e) => e.preventDefault() : undefined}
            to="/ponto/qr"
          >
            {t("ponto.qr_open")}
          </Link>
          <Button disabled={busy} icon="save" onClick={handleSave}>
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
