import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export default function NotFoundContent() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <span className="material-symbols-outlined text-6xl text-on-surface-variant/40">
        error_outline
      </span>
      <h1 className="mt-4 font-extrabold font-headline text-3xl text-on-surface">
        {t("not_found.title")}
      </h1>
      <p className="mt-2 text-on-surface-variant">
        {t("not_found.description")}
      </p>
      <Link
        className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-6 font-bold text-on-primary text-sm"
        to="/"
      >
        {t("not_found.go_home")}
      </Link>
    </div>
  );
}
