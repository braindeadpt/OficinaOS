import { useTranslation } from "react-i18next";
import { useDemoMode } from "@/lib/demo";

/**
 * Fixed banner on every page of the public demo: fictional data, hourly
 * reset, no real data. Renders nothing on normal installs.
 */
export default function DemoBanner() {
  const { t } = useTranslation();
  const demo = useDemoMode();
  if (!demo) {
    return null;
  }
  return (
    <>
      {/* In-flow spacer keeps page content below the fixed banner. */}
      <div aria-hidden="true" className="h-10 shrink-0" />
      <div
        className="fixed inset-x-0 top-0 z-[60] flex h-10 items-center justify-center gap-3 bg-primary px-3 text-on-primary"
        role="alert"
      >
        <p className="truncate font-label font-medium text-xs sm:text-sm">
          {t("demo_banner_text")}
        </p>
        <a
          className="hidden shrink-0 items-center rounded-full bg-on-primary/15 px-3 py-1 font-semibold text-xs transition-colors hover:bg-on-primary/25 sm:inline-flex"
          href="https://oficinaos.app"
          rel="noopener noreferrer"
          target="_blank"
        >
          {t("demo_banner_cta")}
        </a>
      </div>
    </>
  );
}
