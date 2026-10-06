import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api from "@/lib/api";

interface RenameDialogProps {
  conversationId: string;
  currentTitle: string;
  onClose: () => void;
  onRenamed: (newTitle: string) => void;
  open: boolean;
}

export default function RenameDialog({
  conversationId,
  currentTitle,
  onClose,
  onRenamed,
  open,
}: RenameDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  if (open && title !== currentTitle && !saving) {
    setTitle(currentTitle);
  }

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === currentTitle) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await api.put(`/ai/${conversationId}`, { title: trimmed });
      onRenamed(trimmed);
      onClose();
    } catch {
      toast.error(t("ai_agent_stream_error"));
    } finally {
      setSaving(false);
    }
  }, [conversationId, currentTitle, onClose, onRenamed, title, t]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div
        className="w-full max-w-sm rounded-2xl bg-surface-container-high p-6 shadow-xl"
        role="dialog"
      >
        <h3 className="mb-4 font-bold text-lg text-on-surface">
          {t("ai_history_rename_title")}
        </h3>
        <input
          className="mb-5 w-full rounded-xl bg-surface-container-lowest px-4 py-3 text-sm"
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSave();
            }
          }}
          placeholder={t("ai_history_rename_placeholder")}
          ref={inputRef}
          type="text"
          value={title}
        />
        <div className="flex justify-end gap-2">
          <button
            className="rounded-xl px-4 py-2 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            {t("ai_history_cancel")}
          </button>
          <button
            className="rounded-xl bg-primary px-4 py-2 font-bold text-on-primary text-sm transition-colors hover:opacity-90 disabled:opacity-50"
            disabled={saving || !title.trim()}
            onClick={() => {
              handleSave();
            }}
            type="button"
          >
            {t("ai_history_save")}
          </button>
        </div>
      </div>
    </div>
  );
}
