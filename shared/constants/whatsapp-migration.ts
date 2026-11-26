// Duração oficial da transição do envio Meta direto/local para o relay da
// OficinaOS Cloud. Esta constante é a fonte única partilhada pelo servidor
// (gates de envio e purge) e pela UI (contagem decrescente nas Definições).
export const WHATSAPP_LOCAL_DEPRECATION_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const WHATSAPP_LOCAL_DEPRECATION_MS =
  WHATSAPP_LOCAL_DEPRECATION_DAYS * MS_PER_DAY;

function startedAtMs(
  startedAt: Date | string | null | undefined
): number | null {
  if (!startedAt) {
    return null;
  }
  const ms =
    startedAt instanceof Date ? startedAt.getTime() : Date.parse(startedAt);
  return Number.isFinite(ms) ? ms : null;
}

export function isWhatsAppLocalDeprecationExpired(
  startedAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  const start = startedAtMs(startedAt);
  return (
    start !== null && now.getTime() >= start + WHATSAPP_LOCAL_DEPRECATION_MS
  );
}

// True apenas dentro da janela [início, fim) — é durante esta janela que o
// fallback local transitório é permitido quando a Cloud falha por rede/5xx.
export function isWhatsAppLocalTransitionActive(
  startedAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  const start = startedAtMs(startedAt);
  if (start === null) {
    return false;
  }
  const nowMs = now.getTime();
  return nowMs >= start && nowMs < start + WHATSAPP_LOCAL_DEPRECATION_MS;
}

export function whatsappLocalDeprecationDaysLeft(
  startedAt: Date | string | null | undefined,
  now: Date = new Date()
): number {
  const start = startedAtMs(startedAt);
  if (start === null) {
    return WHATSAPP_LOCAL_DEPRECATION_DAYS;
  }
  const elapsedDays = Math.max(
    0,
    Math.floor((now.getTime() - start) / MS_PER_DAY)
  );
  return Math.max(0, WHATSAPP_LOCAL_DEPRECATION_DAYS - elapsedDays);
}
