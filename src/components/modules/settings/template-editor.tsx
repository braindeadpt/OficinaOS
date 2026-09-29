import type { NotificationTemplate } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { useSettingsStore } from "@/stores/settings";

const TEMPLATE_VARIABLES = [
  "{{customerName}}",
  "{{jobCode}}",
  "{{status}}",
  "{{estimatedDate}}",
];

interface TemplateEditorProps {
  onClose: () => void;
  onSaved: () => void;
  open: boolean;
  template: NotificationTemplate | null;
}

export default function TemplateEditor({
  template,
  open,
  onClose,
  onSaved,
}: TemplateEditorProps) {
  const { t } = useTranslation();
  const updateTemplate = useSettingsStore((s) => s.updateNotificationTemplate);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP">("WHATSAPP");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useModalEffects(open, onClose, dialogRef);

  useEffect(() => {
    if (!(open && template)) {
      return;
    }
    setName(template.name);
    setChannel(template.channel as "WHATSAPP");
    setBody(template.body);
    setError(null);
  }, [open, template]);

  const insertVariable = useCallback(
    (variable: string) => {
      const el = textareaRef.current;
      if (el) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const before = body.slice(0, start);
        const after = body.slice(end);
        setBody(before + variable + after);
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + variable.length;
          el.focus();
        });
      } else {
        setBody((prev) => prev + variable);
      }
    },
    [body]
  );

  const handleSave = useCallback(async () => {
    if (!(template && name.trim() && body.trim())) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateTemplate(template.id, {
        name: name.trim(),
        channel,
        body: body.trim(),
      });
      onSaved();
      onClose();
    } catch {
      setError(t("errors.update_notification_template"));
    } finally {
      setSaving(false);
    }
  }, [template, name, channel, body, updateTemplate, onSaved, onClose, t]);

  if (!(open && template)) {
    return null;
  }

  const canSave = name.trim().length > 0 && body.trim().length > 0;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-on-surface/40"
        onClick={onClose}
        type="button"
      />
      <div
        className="modal-surface relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl"
        ref={dialogRef}
      >
        <div className="flex items-center justify-between border-outline-variant border-b px-6 py-4">
          <h2 className="font-bold font-headline text-lg text-on-surface">
            {t("notifications_edit_template")}
          </h2>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="tpl-name"
              >
                {t("notifications_template_name")}
              </label>
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                id="tpl-name"
                onChange={(e) => setName(e.target.value)}
                type="text"
                value={name}
              />
            </div>

            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="tpl-channel"
              >
                {t("notifications_channel")}
              </label>
              <select
                className="h-12 w-full appearance-none rounded-xl bg-surface-container-highest px-4 text-on-surface"
                id="tpl-channel"
                onChange={(e) => setChannel(e.target.value as "WHATSAPP")}
                value={channel}
              >
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>

            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="tpl-body"
              >
                {t("notifications_template_body")}
              </label>
              <textarea
                className="min-h-[120px] w-full rounded-xl bg-surface-container-highest p-4 text-on-surface"
                id="tpl-body"
                onChange={(e) => setBody(e.target.value)}
                ref={textareaRef}
                rows={5}
                value={body}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <button
                    className="rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-on-surface-variant text-xs transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                    key={v}
                    onClick={() => insertVariable(v)}
                    type="button"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div
            className="border-outline-variant border-t px-6 py-2"
            role="alert"
          >
            <p className="font-body text-error text-xs">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 border-outline-variant border-t px-6 py-4">
          <button
            className="px-4 py-2 font-bold font-headline text-on-surface-variant text-sm hover:text-on-surface"
            onClick={onClose}
            type="button"
          >
            {t("cancel")}
          </button>
          <button
            className="rounded-xl bg-primary px-6 py-2 font-bold font-headline text-on-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSave || saving}
            onClick={handleSave}
            type="button"
          >
            {saving ? "..." : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
