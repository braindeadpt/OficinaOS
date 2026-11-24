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

// Folha A4 «Informação aos trabalhadores» — o documento impresso é sempre
// em PT-PT (público-alvo: trabalhadores da loja; os comandos do ponto são
// eles próprios PT). Só o chrome do ecrã (voltar/imprimir/indisponível)
// segue o idioma da app.
const INFO_TITLE = "Informação sobre o registo de ponto";
const DATE_LABEL = "Data";
const SIGNATURE_HEADING = "Declaração de receção da informação";

interface InfoBlock {
  bullets?: string[];
  heading?: string;
  paragraphs?: string[];
}

// Modelo RGPD base (PT-PT) — usado quando ShopSettings.pontoInfoText está
// vazio. Tom informativo: diz o que se regista, porquê e que direitos tem
// o trabalhador, sem ameaças. O nome do responsável é interpolado.
const DEFAULT_INFO_MODEL: InfoBlock[] = [
  {
    paragraphs: [
      "{controller} utiliza um sistema eletrónico de registo de ponto para documentar o tempo de trabalho dos seus trabalhadores, nos termos do Código do Trabalho (art. 202.º).",
    ],
  },
  {
    bullets: [
      "Entradas, pausas, regresso de pausas e saídas, com a hora do servidor no momento em que cada registo é efetuado — a hora escrita na mensagem não é tida em conta.",
      "A localização é solicitada apenas no momento do registo, para confirmar que este foi efetuado dentro da área da loja ou do local de trabalho. Não existe localização contínua nem vigilância.",
      "Trabalhadores externos podem ser convidados a anexar uma fotografia como prova da visita. As fotografias são eliminadas automaticamente ao fim de 90 dias; o respetivo registo mantém-se.",
    ],
    heading: "O que é registado",
  },
  {
    bullets: [
      "Ler o código QR afixado na loja e seguir as instruções da página que abre.",
      "Enviar a mensagem indicada (WhatsApp ou SMS) e partilhar a localização quando solicitado.",
    ],
    heading: "Como registar o ponto",
  },
  {
    bullets: [
      "O registo de ponto é obrigatório por lei (Código do Trabalho, art. 202.º) e destina-se a documentar as horas de trabalho de cada trabalhador.",
      "O tratamento apoia-se na obrigação legal de registo de ponto e no legítimo interesse da loja em dispor de registos fiáveis e imputáveis.",
    ],
    heading: "Finalidade e base legal",
  },
  {
    bullets: [
      "Os registos de ponto são conservados durante 5 anos, nos termos da lei.",
      "As fotografias de prova são eliminadas ao fim de 90 dias.",
      "Não são recolhidos nem utilizados dados biométricos.",
    ],
    heading: "Conservação dos dados",
  },
  {
    bullets: [
      "Pode consultar os seus registos de ponto e pedir a retificação ou a limitação do tratamento, contactando a loja.",
      "Em caso de dúvida sobre este tratamento, fale com a gerência.",
    ],
    heading: "Os seus direitos",
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

function SignatureRow() {
  return (
    <div className="grid grid-cols-[1fr_1.6fr_0.5fr] items-end gap-x-5">
      <SignatureField label="Nome" />
      <SignatureField label="Assinatura" tall />
      <SignatureField label="Data" />
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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 bg-surface p-6 print:max-w-none print:bg-white print:p-0">
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
          <p className="font-semibold text-on-surface">{INFO_TITLE}</p>
          <p className="mt-2 text-on-surface-variant text-sm">
            {t("ponto.info_unavailable")}
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <article className="flex flex-col gap-5 rounded-2xl bg-white p-8 text-neutral-900 print:rounded-none print:p-0">
          <header className="flex flex-col gap-1">
            <h1 className="font-extrabold font-headline text-2xl">
              {INFO_TITLE}
            </h1>
            {state.shopName && (
              <p className="font-semibold text-lg">{state.shopName}</p>
            )}
            <p className="text-neutral-500 text-sm">
              {DATE_LABEL}: {today}
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
                    <h2 className="mb-1.5 font-bold">{block.heading}</h2>
                  )}
                  {block.paragraphs?.map((p) => (
                    <p className="mb-1.5" key={p}>
                      {p.replace("{controller}", controller)}
                    </p>
                  ))}
                  {block.bullets && (
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                      {block.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}

          <section className="mt-4">
            <p className="mb-4 font-semibold text-neutral-800 text-sm">
              {SIGNATURE_HEADING}
            </p>
            <div className="flex flex-col gap-6">
              {Array.from({ length: SIGNATURE_ROWS }, (_, i) => (
                <SignatureRow key={`sig-${String(i)}`} />
              ))}
            </div>
          </section>
        </article>
      )}
    </div>
  );
}
