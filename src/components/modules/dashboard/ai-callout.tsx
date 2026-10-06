import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";

interface AiCalloutProps {
  insight: string;
}

export default function AiCallout({ insight }: AiCalloutProps) {
  const { t } = useTranslation();

  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-container-highest p-1">
      <div className="rounded-[10px] bg-surface-container-low p-5">
        <div className="mb-4 flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary md:h-12 md:w-12">
            <Icon name="psychology" size="lg" />
          </div>
          <div>
            <h4 className="font-bold font-headline text-on-surface text-sm md:text-base">
              {t("ask_ai_assistant")}
            </h4>
            <p className="text-on-surface-variant text-xs md:text-xs">
              {t("ai_assistant_subtitle")}
            </p>
          </div>
        </div>
        <div className="mb-4 rounded-lg border border-surface-container-lowest/80 bg-surface-container/60 p-3 text-on-surface-variant text-xs italic md:text-sm">
          &ldquo;{insight}&rdquo;
        </div>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-on-surface py-2.5 font-bold text-on-primary text-sm transition-all hover:bg-inverse-surface"
          type="button"
        >
          {t("ask_ai")}
          <Icon className="text-sm" name="north_east" />
        </button>
      </div>
    </div>
  );
}
