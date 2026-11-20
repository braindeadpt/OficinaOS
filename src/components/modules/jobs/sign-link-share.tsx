import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

interface SignLinkShareProps {
  onSend: () => void;
  sendErrorCode: string | null;
  sendState: "idle" | "sending" | "sent" | "error";
  url: string;
}

/**
 * The share/send block both signing dialogs render under the QR when the
 * live link is reachable off-LAN: a copyable URL plus the staff-initiated
 * "send by message" action (WhatsApp/SMS outbox server-side).
 */
export default function SignLinkShare({
  url,
  onSend,
  sendState,
  sendErrorCode,
}: SignLinkShareProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 w-full">
      <p className="mb-1 text-center text-on-surface-variant text-xs">
        {t("intake.sign_remote_send_link")}
      </p>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
            readOnly
            value={url}
          />
        </div>
        <button
          className="shrink-0 rounded-lg bg-surface-container-high px-3 py-2 font-label text-on-surface text-xs"
          onClick={async () => {
            // Só confirma se a cópia correu mesmo — um writeText rejeitado
            // (sem foco/permissão) não pode mostrar «Copiado» com o link
            // por copiar.
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              /* clipboard indisponível — o input continua selecionável */
            }
          }}
          type="button"
        >
          {copied
            ? t("intake.sign_remote_copied")
            : t("intake.sign_remote_copy")}
        </button>
      </div>
      <button
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 font-label text-on-primary text-xs disabled:opacity-50"
        disabled={sendState === "sending" || sendState === "sent"}
        onClick={onSend}
        type="button"
      >
        {sendState === "sending" ? (
          <Icon className="animate-spin text-base" name="progress_activity" />
        ) : (
          <Icon className="text-base" name="send" />
        )}
        {sendState === "sent"
          ? t("intake.sign_remote_sent")
          : t("intake.sign_remote_send")}
      </button>
      {sendState === "error" && (
        <p className="mt-1 text-center text-error text-xs" role="alert">
          {sendErrorCode
            ? t(`errors.${sendErrorCode.toLowerCase()}`)
            : t("intake.sign_remote_send_error")}
        </p>
      )}
    </div>
  );
}
