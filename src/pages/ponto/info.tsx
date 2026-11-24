import type { ShopSettings } from "@shared/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";

interface PontoStatus {
  enabled: boolean;
}

type PontoShop = Pick<ShopSettings, "pontoInfoText" | "shopName">;

type PontoInfoState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; infoText: string | null; shopName: string };

const SIGNATURE_ROWS = 4;

interface InfoBlock {
  bullets?: string[];
  heading?: string;
  paragraphs?: string[];
}

// Modelo RGPD base — usado quando ShopSettings.pontoInfoText está vazio.
// Só a estrutura vive aqui: os textos estão no catálogo i18n
// (ponto.info_doc_*) e são sempre renderizados em PT-PT — ver docT no
// componente. O {{controller}} do primeiro parágrafo é interpolado com o
// nome do responsável.
const DEFAULT_INFO_MODEL: InfoBlock[] = [
  {
    paragraphs: ["ponto.info_doc_intro"],
  },
  {
    bullets: [
      "ponto.info_doc_what_1",
      "ponto.info_doc_what_2",
      "ponto.info_doc_what_3",
    ],
    heading: "ponto.info_doc_what",
  },
  {
    bullets: ["ponto.info_doc_how_1", "ponto.info_doc_how_2"],
    heading: "ponto.info_doc_how",
  },
  {
    bullets: ["ponto.info_doc_purpose_1", "ponto.info_doc_purpose_2"],
    heading: "ponto.info_doc_purpose",
  },
  {
    bullets: [
      "ponto.info_doc_retention_1",
      "ponto.info_doc_retention_2",
      "ponto.info_doc_retention_3",
    ],
    heading: "ponto.info_doc_retention",
  },
  {
    bullets: ["ponto.info_doc_rights_1", "ponto.info_doc_rights_2"],
    heading: "ponto.info_doc_rights",
  },
];

async function loadPontoInfo(): Promise<PontoInfoState> {
  const [statusRes, shopRes] = await Promise.all([
    api.get<PontoStatus>("/ponto/status"),
    api.get<PontoShop>("/settings/shop"),
  ]);
  if (!statusRes.data.enabled) {
    return { kind: "unavailable" };
  }
  const shop = shopRes.data;
  const custom = shop.pontoInfoText?.trim() ? shop.pontoInfoText : null;
  return { infoText: custom, kind: "ready", shopName: shop.shopName ?? "" };
}

function SignatureField({ label, tall }: { label: string; tall?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-neutral-500 text-xs">{label}</span>
      <span
        className={`border-neutral-400 border-b ${tall ? "h-12" : "h-7"}`}
      />
    </div>
  );
}

function SignatureRow({
  labels,
}: {
  labels: { date: string; name: string; signature: string };
}) {
  return (
    <div className="grid grid-cols-[1fr_1.6fr_0.5fr] items-end gap-x-5">
      <SignatureField label={labels.name} />
      <SignatureField label={labels.signature} tall />
      <SignatureField label={labels.date} />
    </div>
  );
}

/**
 * Folha A4 para imprimir a informação do livro de ponto aos trabalhadores
 * (RGPD — informação escrita obrigatória). O corpo vem de
 * ShopSettings.pontoInfoText; se estiver vazio usa o modelo RGPD base
 * acima. Gate: módulo `ponto` ativo (/ponto/status) — sem ele a página
 * mostra o aviso de indisponível.
 */
export default function PontoInfoPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<PontoInfoState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadPontoInfo()
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

  const today = new Date().toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const controller =
    state.kind === "ready" && state.shopName ? `A ${state.shopName}` : "A loja";

  // Folha A4 «Informação aos trabalhadores» — o documento impresso é
  // sempre em PT-PT (público-alvo: trabalhadores da loja; os comandos do
  // ponto são eles próprios PT), independentemente do idioma da
  // interface. Só o chrome do ecrã (voltar/imprimir/indisponível) segue o
  // idioma da app.
  const docT = (key: string) => t(key, { controller, lng: "pt" });
  const signatureLabels = {
    date: docT("ponto.info_doc_date"),
    name: docT("ponto.info_doc_sig_name"),
    signature: docT("ponto.info_doc_sig_signature"),
  };

  return (
    <div className="print-ponto-info mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 bg-surface p-6 print:max-w-none print:bg-white print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link
          className="inline-flex items-center gap-1.5 font-semibold text-on-surface-variant text-sm"
          to="/settings"
        >
          ← {t("ponto.info_back")}
        </Link>
        <Button icon="print" onClick={() => window.print()}>
          {t("ponto.info_print")}
        </Button>
      </div>

      {state.kind === "loading" && (
        <div className="h-96 animate-pulse rounded-xl bg-surface-container-low" />
      )}

      {state.kind === "unavailable" && (
        <div className="rounded-2xl bg-surface-container-low p-6 text-center">
          <p className="font-semibold text-on-surface">
            {docT("ponto.info_doc_title")}
          </p>
          <p className="mt-2 text-on-surface-variant text-sm">
            {t("ponto.info_unavailable")}
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <article className="flex flex-col gap-5 rounded-2xl bg-white p-8 text-neutral-900 print:rounded-none print:p-0">
          <header className="flex flex-col gap-1">
            <h1 className="font-extrabold font-headline text-2xl">
              {docT("ponto.info_doc_title")}
            </h1>
            {state.shopName && (
              <p className="font-semibold text-lg">{state.shopName}</p>
            )}
            <p className="text-neutral-500 text-sm">
              {docT("ponto.info_doc_date")}: {today}
            </p>
          </header>

          {state.infoText ? (
            <div className="whitespace-pre-line text-sm leading-relaxed">
              {state.infoText}
            </div>
          ) : (
            <div className="flex flex-col gap-4 text-sm leading-relaxed">
              {DEFAULT_INFO_MODEL.map((block) => (
                <section key={block.heading ?? "intro"}>
                  {block.heading && (
                    <h2 className="mb-1.5 font-bold">{docT(block.heading)}</h2>
                  )}
                  {block.paragraphs?.map((p) => (
                    <p className="mb-1.5" key={p}>
                      {docT(p)}
                    </p>
                  ))}
                  {block.bullets && (
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                      {block.bullets.map((b) => (
                        <li key={b}>{docT(b)}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}

          <section className="mt-4">
            <p className="mb-4 font-semibold text-neutral-800 text-sm">
              {docT("ponto.info_doc_sig_heading")}
            </p>
            <div className="flex flex-col gap-6">
              {Array.from({ length: SIGNATURE_ROWS }, (_, i) => (
                <SignatureRow
                  key={`sig-${String(i)}`}
                  labels={signatureLabels}
                />
              ))}
            </div>
          </section>
        </article>
      )}
    </div>
  );
}
