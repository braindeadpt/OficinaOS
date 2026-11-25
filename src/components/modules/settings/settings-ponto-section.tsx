import type { ShopSettings } from "@shared/types";
import { isValidPhone, normalizePhone } from "@shared/utils/phone";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
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
  qrId?: string;
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

interface PontoFieldErrors {
  geoLat?: string;
  geoLng?: string;
  pauseMinutes?: string;
  radius?: string;
  smsNumber?: string;
  waNumber?: string;
}

interface PontoFormFields {
  geoLat: string;
  geoLng: string;
  pauseMinutes: string;
  radius: string;
  smsNumber: string;
  waNumber: string;
}

interface PontoFormValues {
  geoLat: number | null;
  geoLng: number | null;
  pauseMinutes: number | undefined;
  radius: number | undefined;
  smsNumber: string | null;
  waNumber: string | null;
}

type TranslateFn = ReturnType<typeof useTranslation>["t"];

// Coordenada decimal: "." ou "," — "38,7223" e "38.7223" valem o mesmo.
// "" → null (o par fica limpo); inválido → NaN, rejeitado antes do pedido:
// Number("38,7") seria NaN e o JSON serializava-o como null, apagando a
// localização guardada sem aviso.
const GEO_RE = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
const INT_RE = /^\d+$/;
// O esquema da API exige ^\+?\d{8,15}$ — depois de normalizePhone.
const PONTO_PHONE_RE = /^\+?\d{8,15}$/;

function parseCoord(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  if (!GEO_RE.test(trimmed)) {
    return Number.NaN;
  }
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : Number.NaN;
}

/** "" → sem retorno (campo omitido — a API mantém o valor guardado). */
function parseIntField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return;
  }
  if (!INT_RE.test(trimmed)) {
    return Number.NaN;
  }
  return Number.parseInt(trimmed, 10);
}

/** "" → null (limpa); inválido → sem retorno (erro no formulário). */
function parsePontoPhone(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  // isValidPhone rejeita letras/símbolos antes de o normalizePhone os
  // varrer — "912abc" não pode virar "912" em silêncio.
  if (!isValidPhone(trimmed)) {
    return;
  }
  const normalized = normalizePhone(trimmed);
  if (!PONTO_PHONE_RE.test(normalized)) {
    return;
  }
  return normalized;
}

// Parse + valida os campos de texto antes do pedido — valores inválidos
// viram erros por campo e o save aborta (nunca seguem como null).
function parsePontoForm(
  fields: PontoFormFields,
  t: TranslateFn
): { errors: PontoFieldErrors; values: PontoFormValues | null } {
  const geoLat = parseCoord(fields.geoLat);
  const geoLng = parseCoord(fields.geoLng);
  const radius = parseIntField(fields.radius);
  const pauseMinutes = parseIntField(fields.pauseMinutes);
  const waNumber = parsePontoPhone(fields.waNumber);
  const smsNumber = parsePontoPhone(fields.smsNumber);

  const errors: PontoFieldErrors = {};
  if (Number.isNaN(geoLat)) {
    errors.geoLat = t("validations.invalid_number");
  }
  if (Number.isNaN(geoLng)) {
    errors.geoLng = t("validations.invalid_number");
  }
  // Par incompleto (um vazio, outro preenchido): a API rejeita com o
  // refine do esquema, mas o erro por campo explica melhor que o toast.
  if (
    !(Number.isNaN(geoLat) || Number.isNaN(geoLng)) &&
    (geoLat === null) !== (geoLng === null)
  ) {
    errors.geoLat = t("validations.incomplete_point");
    errors.geoLng = t("validations.incomplete_point");
  }
  if (Number.isNaN(radius)) {
    errors.radius = t("validations.invalid_integer");
  }
  if (Number.isNaN(pauseMinutes)) {
    errors.pauseMinutes = t("validations.invalid_integer");
  }
  if (waNumber === undefined) {
    errors.waNumber = t("ponto.invalid_phone");
  }
  if (smsNumber === undefined) {
    errors.smsNumber = t("ponto.invalid_phone");
  }
  if (Object.keys(errors).length > 0) {
    return { errors, values: null };
  }
  // errors vazio ⇒ waNumber/smsNumber nunca são undefined (seria erro).
  return {
    errors,
    values: {
      geoLat,
      geoLng,
      pauseMinutes,
      radius,
      smsNumber: smsNumber ?? null,
      waNumber: waNumber ?? null,
    },
  };
}

// Mesmo visual dos links «Abrir folha…» — extraído para aplicar o estado
// Com alterações por guardar, o clique pede confirmação antes de sair.
const SHEET_LINK_CLS =
  "inline-flex min-h-8 pointer-coarse:min-h-11 items-center justify-center gap-1.5 rounded-md border border-outline bg-surface-container-lowest px-3 py-1.5 font-sans font-semibold text-on-surface text-sm transition-colors hover:bg-surface-container";

export default function SettingsPontoSection({
  hasUnsavedChanges = false,
  onDirtyChange,
  onToast,
  refreshNonce = 0,
}: {
  // Sujo de QUALQUER secção Cloud (faturação + ponto) — o link do QR
  // abandona a página toda, por isso o aviso cobre as duas.
  hasUnsavedChanges?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onToast: (msg: string, type: "success" | "error") => void;
  // Incrementa a cada "Sincronize agora" — pode ter ativado o módulo.
  refreshNonce?: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PontoStatus | null>(null);
  const [config, setConfig] = useState<PontoConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<PontoFieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [confirmSheetLeave, setConfirmSheetLeave] = useState<string | null>(
    null
  );
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
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
  const lastNonceRef = useRef(refreshNonce);

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

  // "Sincronize agora" na Cloud pode ter ativado o módulo — recarrega a
  // secção, mas nunca por cima de um rascunho local (refresh() reescreve
  // os campos). Com rascunho, o nonce fica por consumir: a próxima
  // limpeza de dirty (ex.: após gravar) dispara o refresh.
  useEffect(() => {
    if (refreshNonce === lastNonceRef.current || dirty) {
      return;
    }
    lastNonceRef.current = refreshNonce;
    refresh().catch(() => null);
  }, [refreshNonce, refresh, dirty]);

  function markDirty() {
    setDirty(true);
    setErrors({});
    onDirtyChange?.(true);
  }

  async function handleSave() {
    const { errors: fieldErrors, values } = parsePontoForm(
      { geoLat, geoLng, pauseMinutes, radius, smsNumber, waNumber },
      t
    );
    if (!values) {
      setErrors(fieldErrors);
      return;
    }

    setBusy(true);
    try {
      await api.put("/settings/shop", {
        pontoExitReminderTime: exitTime || null,
        pontoExternalAutoApprove: autoApprove,
        pontoExternalPhotoRequired: photoRequired,
        pontoGeoLat: values.geoLat,
        pontoGeoLng: values.geoLng,
        pontoInfoText: infoText,
        pontoPauseReminderMinutes: values.pauseMinutes,
        pontoRadiusM: values.radius,
        pontoSmsNumber: values.smsNumber,
        pontoWaNumber: values.waNumber,
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

  // Regenerar o QR aleatório invalida imediatamente a folha impressa —
  // a confirmação é obrigatória e o toast de sucesso repete o aviso de
  // que é preciso imprimir/substituir.
  async function handleRegenerate() {
    setConfirmRegenerate(false);
    setRegenerating(true);
    try {
      await api.post("/ponto/regenerate-qr");
      // Só o qrId/config mudou — refresh() reescreveria o rascunho por
      // guardar da secção. As definições locais continuam exatamente como
      // o utilizador as tinha.
      const cfg = await api.get<PontoConfig>("/ponto/config");
      setConfig(cfg.data);
      onToast(t("ponto.qr_regenerated"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("ponto.qr_regenerate_failed")), "error");
    } finally {
      setRegenerating(false);
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
          <Field error={errors.geoLat} label={t("ponto.latitude")}>
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
          <Field error={errors.geoLng} label={t("ponto.longitude")}>
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
          <Field
            error={errors.radius}
            hint={t("ponto.radius_help")}
            label={t("ponto.radius")}
          >
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
            error={errors.pauseMinutes}
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
          <Field error={errors.waNumber} label={t("ponto.wa_number")}>
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
          <Field error={errors.smsNumber} label={t("ponto.sms_number")}>
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
            className={SHEET_LINK_CLS}
            onClick={(e) => {
              // Ctrl/⌘/Shift+click abre noutro separador — o formulário
              // fica montado na mesma, sem perda de rascunho.
              if (
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                e.altKey ||
                !hasUnsavedChanges
              ) {
                return;
              }
              e.preventDefault();
              setConfirmSheetLeave("/ponto/info");
            }}
            to="/ponto/info"
          >
            {t("ponto.info_open")}
          </Link>
          <Link
            className={SHEET_LINK_CLS}
            onClick={(e) => {
              if (
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                e.altKey ||
                !hasUnsavedChanges
              ) {
                return;
              }
              e.preventDefault();
              setConfirmSheetLeave("/ponto/qr");
            }}
            to="/ponto/qr"
          >
            {t("ponto.qr_open")}
          </Link>
          <Button
            disabled={regenerating || busy}
            onClick={() => setConfirmRegenerate(true)}
            type="button"
            variant="destructive-soft"
          >
            {t("ponto.qr_regenerate")}
          </Button>
          <Button disabled={busy} icon="save" onClick={handleSave}>
            {t("save")}
          </Button>
        </div>
      </div>

      {confirmSheetLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
          <ConfirmDiscardDialog
            onDiscard={() => {
              const target = confirmSheetLeave;
              setConfirmSheetLeave(null);
              navigate(target);
            }}
            onKeepEditing={() => setConfirmSheetLeave(null)}
            open
          />
        </div>
      )}

      {confirmRegenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
          <ConfirmDiscardDialog
            description={t("ponto.qr_regenerate_desc")}
            discardLabel={t("ponto.qr_regenerate_confirm")}
            keepLabel={t("cancel")}
            onDiscard={() => {
              handleRegenerate().catch(() => null);
            }}
            onKeepEditing={() => setConfirmRegenerate(false)}
            open
            title={t("ponto.qr_regenerate_title")}
          />
        </div>
      )}
    </div>
  );
}
