import type { ShopSettings } from "@shared/types";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";

interface PontoStatus {
  enabled: boolean;
}

interface PontoConfig {
  configured?: boolean;
  qrId?: string;
  slug?: string;
  smsNumber?: string | null;
  waNumber?: string | null;
}

type PontoShop = Pick<
  ShopSettings,
  "cloudApiUrl" | "pontoSmsNumber" | "pontoWaNumber" | "shopName"
>;

const STEPS = ["ponto.qr_step1", "ponto.qr_step2", "ponto.qr_step3"] as const;

const TRAILING_SLASHES = /\/+$/;

// A folha é A5 — sem @page o botão de impressão usava o papel que o
// navegador tivesse selecionado.
const PRINT_CSS = "@page { size: A5; margin: 10mm; }";

type PontoQrState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      qrUrl: string | null;
      shopName: string;
      smsNumber: string | null;
      url: string;
      waNumber: string | null;
    };

async function loadPontoQr(): Promise<PontoQrState> {
  const [statusRes, shopRes, configRes] = await Promise.all([
    api.get<PontoStatus>("/ponto/status"),
    api.get<PontoShop>("/settings/shop"),
    api.get<PontoConfig>("/ponto/config"),
  ]);
  const config = configRes.data;
  const shop = shopRes.data;
  // qrId (aleatório, WP0.2) é o identificador público atual — o slug
  // legado só serve de fallback para instalações ainda não migradas.
  const qrKey = config.qrId ?? config.slug;
  if (
    !statusRes.data.enabled ||
    config.configured === false ||
    !qrKey ||
    !shop.cloudApiUrl
  ) {
    return { kind: "unavailable" };
  }
  const url = `${shop.cloudApiUrl.replace(TRAILING_SLASHES, "")}/ponto/${qrKey}`;
  const qrUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 640,
  }).catch(() => null);
  return {
    kind: "ready",
    qrUrl,
    shopName: shop.shopName ?? "",
    smsNumber: config.smsNumber ?? shop.pontoSmsNumber,
    url,
    waNumber: config.waNumber ?? shop.pontoWaNumber,
  };
}

/**
 * Folha A5 para imprimir o QR fixo do livro de ponto. O QR aponta para a
 * página pública da Cloud (`<apiUrl>/ponto/<qrId>`) — o qrId aleatório
 * vem de GET /api/ponto/config (slug legado como fallback) e os números
 * exibidos são os que a Cloud guardou (fallback para as definições
 * locais se a Cloud ainda não os devolver).
 */
export default function PontoQrPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<PontoQrState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadPontoQr()
      .then((s) => {
        if (!cancelled) {
          setState(s);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "unavailable" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 bg-surface p-6 print:max-w-none print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="flex items-center justify-between print:hidden">
        <Link
          className="inline-flex items-center gap-1.5 font-semibold text-on-surface-variant text-sm"
          to="/settings"
        >
          ← {t("ponto.qr_back")}
        </Link>
        <Button icon="print" onClick={() => window.print()}>
          {t("ponto.qr_print")}
        </Button>
      </div>

      {state.kind === "loading" && (
        <div className="h-96 animate-pulse rounded-xl bg-surface-container-low" />
      )}

      {state.kind === "unavailable" && (
        <div className="rounded-2xl bg-surface-container-low p-6 text-center">
          <p className="font-semibold text-on-surface">
            {t("ponto.qr_page_title")}
          </p>
          <p className="mt-2 text-on-surface-variant text-sm">
            {t("ponto.qr_unavailable")}
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <div className="flex flex-col items-center gap-5 rounded-2xl bg-white p-8 text-center text-neutral-900 print:rounded-none print:p-0">
          <div>
            <h1 className="font-extrabold font-headline text-2xl">
              {state.shopName}
            </h1>
            <p className="mt-1 font-semibold text-neutral-600 text-sm uppercase tracking-wide">
              {t("ponto.qr_page_title")}
            </p>
          </div>

          {state.qrUrl ? (
            <img
              alt={t("ponto.qr_page_title")}
              className="size-72"
              height={288}
              src={state.qrUrl}
              width={288}
            />
          ) : (
            <p className="text-neutral-500 text-sm">{state.url}</p>
          )}

          <p className="break-all font-mono text-neutral-500 text-xs">
            {state.url}
          </p>

          {(state.waNumber || state.smsNumber) && (
            <div className="flex flex-col gap-1 text-sm">
              {state.waNumber && (
                <p>
                  <span className="font-semibold">
                    {t("ponto.qr_wa_label")}:
                  </span>{" "}
                  {state.waNumber}
                </p>
              )}
              {state.smsNumber && (
                <p>
                  <span className="font-semibold">
                    {t("ponto.qr_sms_label")}:
                  </span>{" "}
                  {state.smsNumber}
                </p>
              )}
            </div>
          )}

          <div className="w-full text-left">
            <p className="mb-2 font-semibold text-sm">
              {t("ponto.qr_instructions")}
            </p>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-neutral-700 text-sm">
              {STEPS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
