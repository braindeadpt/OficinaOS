import { LANGUAGES } from "@shared/constants";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

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
      className="material-symbols-outlined min-h-11 min-w-11 rounded-full p-2.5 text-on-surface-variant transition-colors hover:bg-surface-container-high"
      onClick={nextLang}
      type="button"
    >
      language
    </button>
  );
}

type Platform = "ios" | "android" | "other";

const APPLE_DEVICE_RE = /iPad|iPhone|iPod/;
const ANDROID_RE = /android/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (APPLE_DEVICE_RE.test(ua)) {
    return "ios";
  }
  if (ANDROID_RE.test(ua)) {
    return "android";
  }
  return "other";
}

function Section({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface-container-low p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[22px] text-primary"
        >
          {icon}
        </span>
        <h2 className="font-bold font-headline text-lg text-on-surface">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Steps({ keys }: { keys: string[] }) {
  const { t } = useTranslation();
  return (
    <ol className="space-y-2.5">
      {keys.map((key, i) => (
        <li className="flex items-start gap-3" key={key}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-on-primary text-xs">
            {i + 1}
          </span>
          <span className="pt-0.5 text-on-surface-variant text-sm">
            {t(key)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function HelpPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const origin = window.location.origin;
  const host = window.location.hostname;
  const isLocalAddress =
    IPV4_RE.test(host) || host === "localhost" || host.endsWith(".local");
  const isRemote = window.location.protocol === "https:" && !isLocalAddress;
  const platform = detectPlatform();

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(origin);
    } catch {
      // clipboard API needs HTTPS — fall back to a temporary textarea on LAN
      const el = document.createElement("textarea");
      el.value = origin;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const iosSteps = [
    "help_install_ios_step1",
    "help_install_ios_step2",
    "help_install_ios_step3",
    "help_install_ios_step4",
  ];
  const androidSteps = [
    "help_install_android_step1",
    "help_install_android_step2",
    "help_install_android_step3",
    "help_install_android_step4",
  ];
  const installPlatforms: Platform[] =
    platform === "android" ? ["android", "ios"] : ["ios", "android"];

  const problems = [
    ["help_problem_1_q", "help_problem_1_a"],
    ["help_problem_2_q", "help_problem_2_a"],
    ["help_problem_3_q", "help_problem_3_a"],
    ["help_problem_4_q", "help_problem_4_a"],
  ];

  return (
    <main className="min-h-dvh bg-background font-body text-on-surface antialiased">
      <header className="flex items-center justify-between border-outline-variant/30 border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <img
            alt=""
            aria-hidden="true"
            className="h-9 w-9"
            height={36}
            src="/logo-mark.svg"
            width={36}
          />
          <div>
            <h1 className="font-bold font-headline text-lg text-on-surface tracking-tight">
              {t("help_title")}
            </h1>
            <p className="font-label font-medium text-on-surface-variant/60 text-xs uppercase tracking-widest">
              OficinaOS
            </p>
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <p className="text-on-surface-variant text-sm">
          {t("help_page_subtitle")}
        </p>

        <Section icon="link" title={t("help_address_title")}>
          <div className="mb-3 flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`material-symbols-outlined text-[20px] ${isRemote ? "text-tertiary" : "text-primary"}`}
            >
              {isRemote ? "public" : "wifi"}
            </span>
            <span className="font-medium text-on-surface text-sm">
              {isRemote ? t("help_address_remote") : t("help_address_lan")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-surface-container px-4 py-3 font-mono text-on-surface text-sm">
              {origin}
            </code>
            <button
              className="shrink-0 rounded-xl bg-primary px-4 py-3 font-bold text-on-primary text-sm transition-all active:scale-[0.97]"
              onClick={copyAddress}
              type="button"
            >
              {copied ? t("help_address_copied") : t("help_address_copy")}
            </button>
          </div>
        </Section>

        <Section icon="storefront" title={t("help_shop_title")}>
          <p className="mb-4 text-on-surface-variant text-sm">
            {t("help_shop_intro")}
          </p>
          <Steps
            keys={["help_shop_step1", "help_shop_step2", "help_shop_step3"]}
          />
        </Section>

        <Section icon="install_mobile" title={t("help_install_title")}>
          <div className="space-y-5">
            {installPlatforms.map((p) => (
              <div key={p}>
                <h3 className="mb-3 font-bold text-on-surface text-sm">
                  {p === "ios"
                    ? t("help_install_ios_title")
                    : t("help_install_android_title")}
                </h3>
                <Steps keys={p === "ios" ? iosSteps : androidSteps} />
                {p === "android" && (
                  <p className="mt-3 text-on-surface-variant/70 text-xs">
                    {t("help_install_android_note")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section icon="travel_explore" title={t("help_remote_title")}>
          <p className="mb-4 text-on-surface-variant text-sm">
            {t("help_remote_intro")}
          </p>
          <Steps
            keys={[
              "help_remote_step1",
              "help_remote_step2",
              "help_remote_step3",
            ]}
          />
          <p className="mt-4 rounded-xl bg-surface-container px-4 py-3 text-on-surface-variant text-xs">
            {t("help_remote_none")}
          </p>
        </Section>

        <Section icon="healing" title={t("help_problems_title")}>
          <dl className="space-y-4">
            {problems.map(([q, a]) => (
              <div key={q}>
                <dt className="mb-1 font-bold text-on-surface text-sm">
                  {t(q)}
                </dt>
                <dd className="text-on-surface-variant text-sm">{t(a)}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Link
          className="flex items-center justify-center gap-2 rounded-xl border border-outline-variant/50 px-4 py-3 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container"
          to="/"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            arrow_back
          </span>
          {t("help_back_to_app")}
        </Link>
      </div>
    </main>
  );
}
