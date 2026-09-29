import { useTranslation } from "react-i18next";
import { Link } from "react-router";

interface ChatEmptyStateProps {
  agentEnabled: boolean;
  onSendMessage: (message: string) => void;
}

const QUICK_PROMPTS = [
  {
    icon: "shopping_cart",
    key: "daily_revenue",
    textKey: "ai_agent_prompt_daily_revenue_text",
  },
  {
    icon: "database",
    key: "low_stock",
    textKey: "ai_agent_prompt_low_stock_text",
  },
  {
    icon: "pie_chart",
    key: "profit_margin",
    textKey: "ai_agent_prompt_profit_margin_text",
  },
] as const;

export default function ChatEmptyState({
  agentEnabled,
  onSendMessage,
}: ChatEmptyStateProps) {
  const { t } = useTranslation();

  if (!agentEnabled) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm rounded-2xl bg-surface-container-lowest p-6 text-center shadow-sm">
          <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant">
            smart_toy
          </span>
          <h3 className="mb-2 font-bold text-lg text-on-surface">
            {t("ai_agent_disabled")}
          </h3>
          <p className="mb-4 text-on-surface-variant text-sm">
            {t("ai_agent_disabled_desc")}
          </p>
          <Link
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold text-on-primary text-sm transition-colors hover:opacity-90"
            to="/settings?tab=ai"
          >
            <span className="material-symbols-outlined text-base">
              settings
            </span>
            {t("ai_agent_open_settings")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h2 className="mb-2 font-bold font-headline text-2xl text-on-surface">
            {t("ai_agent_empty_welcome")}
          </h2>
          <p className="text-on-surface-variant text-sm">
            {t("ai_agent_empty_desc")}
          </p>
        </div>

        <div>
          <p className="mb-3 font-bold text-on-surface-variant text-xs uppercase tracking-wider">
            {t("ai_agent_empty_quick_tip")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                className="flex min-h-24 items-start gap-3 rounded-2xl bg-surface-container-lowest p-4 text-start transition-colors hover:bg-surface-container-high"
                key={prompt.key}
                onClick={() => {
                  onSendMessage(t(prompt.textKey));
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-primary text-xl">
                  {prompt.icon}
                </span>
                <span className="flex flex-col gap-2">
                  <span className="font-bold text-on-surface text-sm">
                    {t(`ai_agent_prompt_${prompt.key}`)}
                  </span>
                  <span className="text-on-surface-variant text-xs leading-relaxed">
                    {t(prompt.textKey)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
