import type { NotificationTemplate } from "@shared/types";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settings";

interface SettingsNotificationsTabProps {
  onEditTemplate: (template: NotificationTemplate) => void;
}

export default function SettingsNotificationsTab({
  onEditTemplate,
}: SettingsNotificationsTabProps) {
  const { t } = useTranslation();
  const { notificationTemplates } = useSettingsStore();

  function renderTemplateGroup(
    title: string,
    icon: string,
    templates: NotificationTemplate[]
  ) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-on-surface">
            {icon}
          </span>
          <h4 className="font-bold font-headline text-on-surface text-sm">
            {title}
          </h4>
        </div>
        {templates.length === 0 ? (
          <div className="rounded-2xl bg-surface-container-low py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">
              markdown
            </span>
            <p className="mt-3 text-on-surface-variant text-sm">
              {t("no_templates")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map((tpl) => (
              <div
                className="rounded-2xl bg-surface-container-low p-4 transition-colors hover:bg-surface-container-high/60"
                key={tpl.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-on-surface text-sm">
                        {tpl.name}
                      </span>
                      {tpl.isDefault && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary text-xs uppercase">
                          {t("default_template")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 font-mono text-on-surface-variant text-xs leading-relaxed sm:text-sm">
                      {tpl.body}
                    </p>
                  </div>
                  <button
                    aria-label={`${t("edit")} ${tpl.name}`}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-on-surface-variant text-xs transition-colors hover:bg-surface-container hover:text-primary"
                    onClick={() => onEditTemplate(tpl)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      edit
                    </span>
                    <span className="hidden sm:inline">{t("edit")}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const whatsappTemplates = notificationTemplates.filter(
    (tpl) => tpl.channel === "WHATSAPP"
  );
  const smsTemplates = notificationTemplates.filter(
    (tpl) => tpl.channel === "SMS"
  );

  return (
    <div className="space-y-8">
      {renderTemplateGroup(t("whatsapp_templates"), "chat", whatsappTemplates)}
      {renderTemplateGroup(t("sms_templates"), "sms", smsTemplates)}
    </div>
  );
}
