import { LANGUAGES } from "@shared/constants";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import SignaturePad from "@/components/reports/signature-pad";
import { Icon } from "@/components/ui/icon";
import api, { type ApiError } from "@/lib/api";

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  const nextLang = () => {
    const normalizedLang = i18n.language.split("-")[0];
    const currentIdx = LANGUAGES.indexOf(
      normalizedLang as (typeof LANGUAGES)[number]
    );
    const resolvedIdx = currentIdx === -1 ? 0 : currentIdx;
    const next = LANGUAGES[(resolvedIdx + 1) % LANGUAGES.length];
    i18n.changeLanguage(next);
  };

  return (
    <button
      aria-label={t("language_switch")}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-full p-2.5 text-on-surface-variant transition-colors hover:bg-surface-container-high"
      onClick={nextLang}
      type="button"
    >
      <Icon name="language" size="lg" />
    </button>
  );
}

interface PublicShop {
  logoUrl: string | null;
  name: string | null;
}

/** Redacted view of the frozen document — what the customer is signing. */
interface PublicDocument {
  accessories: string[];
  customerName: string;
  deposit: number | null;
  device: string;
  estimatedCost: number | null;
  estimatedDelivery: string | null;
  problem: string;
  termsText: string;
  urgent: boolean;
}

type PageState = "loading" | "ready" | "signed" | "done" | "expired";

export default function SignPage() {
  const { t, i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>("loading");
  const [shopName, setShopName] = useState<string | null>(null);
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [document, setDocument] = useState<PublicDocument | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.get(`/public/sign/${token}`),
      api.get("/public/shop"),
    ]).then(([sessionRes, shopRes]) => {
      if (!alive) {
        return;
      }
      if (shopRes.status === "fulfilled") {
        const shop = shopRes.value.data as PublicShop;
        setShopName(shop.name ?? null);
        setShopLogoUrl(shop.logoUrl ?? null);
      }
      if (sessionRes.status === "rejected") {
        setState("expired");
        return;
      }
      const { signed, document: doc } = sessionRes.value.data as {
        signed: boolean;
        document: PublicDocument | null;
      };
      setDocument(doc);
      setState(signed ? "signed" : "ready");
    });
    return () => {
      alive = false;
    };
  }, [token]);

  const handleSubmit = async () => {
    if (!(signature && token) || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/public/sign/${token}`, { signatureDataUrl: signature });
      setState("done");
    } catch (err) {
      const code = (err as ApiError).code;
      if (code === "SIGNATURE_ALREADY_SUBMITTED") {
        setState("signed");
      } else if (code === "SIGNATURE_SESSION_EXPIRED") {
        setState("expired");
      } else {
        setError(t("sign_page_error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <nav className="sticky top-0 z-50 w-full bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img
              alt=""
              aria-hidden="true"
              className="h-8 w-auto max-w-[96px] object-contain"
              height={32}
              onError={() => setLogoFailed(true)}
              src={shopLogoUrl && !logoFailed ? shopLogoUrl : "/logo-mark.svg"}
              width={32}
            />
            <span className="font-bold font-headline text-2xl text-primary-container tracking-tight">
              {shopName ?? "OficinaOS"}
            </span>
          </div>
          <LanguageSwitcher />
        </div>
      </nav>

      <main className="flex flex-grow items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <div className="overflow-hidden rounded-xl bg-surface-container-low p-8 shadow-sm md:p-12">
            {state === "loading" && (
              <div className="flex justify-center py-12">
                <Icon
                  className="animate-spin text-3xl text-on-surface-variant"
                  name="progress_activity"
                />
              </div>
            )}

            {state === "expired" && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-highest">
                  <Icon
                    className="text-3xl text-on-surface-variant"
                    name="link_off"
                  />
                </div>
                <h1 className="mb-3 font-extrabold font-headline text-3xl text-on-surface tracking-tight">
                  {t("sign_page_expired_title")}
                </h1>
                <p className="max-w-sm font-body text-lg text-on-surface-variant">
                  {t("sign_page_expired_body")}
                </p>
              </div>
            )}

            {(state === "signed" || state === "done") && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary-container/20">
                  <Icon
                    className="text-3xl text-primary-container"
                    name="check_circle"
                  />
                </div>
                <h1 className="mb-3 font-extrabold font-headline text-3xl text-on-surface tracking-tight">
                  {state === "done"
                    ? t("sign_page_success_title")
                    : t("sign_page_already_signed_title")}
                </h1>
                <p className="max-w-sm font-body text-lg text-on-surface-variant">
                  {state === "done"
                    ? t("sign_page_success_body")
                    : t("sign_page_already_signed_body")}
                </p>
              </div>
            )}

            {state === "ready" && (
              <>
                <div className="mb-8 flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-highest">
                    <Icon
                      className="text-3xl text-primary-container"
                      name="edit"
                    />
                  </div>
                  <h1 className="mb-3 font-extrabold font-headline text-3xl text-on-surface tracking-tight md:text-4xl">
                    {t("sign_page_title")}
                  </h1>
                  <p className="max-w-sm font-body text-lg text-on-surface-variant">
                    {t("sign_page_subtitle")}
                  </p>
                </div>

                {document && (
                  <dl className="mb-6 space-y-2 rounded-xl bg-surface-container-lowest p-4 text-sm ring-1 ring-outline-variant">
                    <div className="flex justify-between gap-4">
                      <dt className="text-on-surface-variant">
                        {t("sign_doc_customer")}
                      </dt>
                      <dd className="font-medium text-on-surface">
                        {document.customerName}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-on-surface-variant">
                        {t("sign_doc_device")}
                      </dt>
                      <dd className="font-medium text-on-surface">
                        {document.device}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-on-surface-variant">
                        {t("sign_doc_problem")}
                      </dt>
                      <dd className="text-right font-medium text-on-surface">
                        {document.problem}
                      </dd>
                    </div>
                    {document.estimatedCost !== null && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-on-surface-variant">
                          {t("sign_doc_estimate")}
                        </dt>
                        <dd className="font-medium text-on-surface">
                          {document.estimatedCost.toFixed(2)} €
                        </dd>
                      </div>
                    )}
                    {document.estimatedDelivery && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-on-surface-variant">
                          {t("sign_doc_delivery")}
                        </dt>
                        <dd className="font-medium text-on-surface">
                          {new Date(document.estimatedDelivery).toLocaleString(
                            i18n.language
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}

                <p className="mb-6 rounded-xl bg-surface-container-lowest p-4 font-body text-on-surface-variant text-xs leading-relaxed ring-1 ring-outline-variant">
                  {document?.termsText ?? t("intake.terms_text")}
                </p>

                <SignaturePad onChange={setSignature} />

                {error && (
                  <p className="mt-4 text-error text-sm" role="alert">
                    {error}
                  </p>
                )}

                <button
                  className="mt-6 flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-primary font-bold font-headline text-lg text-on-primary shadow-lg shadow-primary/10 transition-all duration-150 active:opacity-80 disabled:opacity-50"
                  disabled={!signature || submitting}
                  onClick={handleSubmit}
                  type="button"
                >
                  <span>
                    {submitting
                      ? t("sign_page_submitting")
                      : t("sign_page_submit")}
                  </span>
                  <Icon name="arrow_forward" size="lg" />
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
