/** Teletrabalho (risco R3 da AIPD): pedir a localização em casa do
 *  trabalhador revelaria a morada. Por isso o campo por trabalhador —
 *  dias da semana em ISO 8601 (1 = segunda … 7 = domingo); vazio = nunca.
 *  Nesses dias a picagem nunca pede localização e a Cloud aplica a regra
 *  de validação que a empresa escolheu (ver remoteAutoApprove). */

/** Dia da semana ISO (1-7) no fuso da loja. */
function isoWeekdayInTz(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = {
    Fri: 5,
    Mon: 1,
    Sat: 6,
    Sun: 7,
    Thu: 4,
    Tue: 2,
    Wed: 3,
  };
  return map[parts] ?? 0;
}

/** Hoje é dia de teletrabalho do trabalhador? */
export function isTeleworkDay(
  days: number[] | null | undefined,
  tz: string,
  now: Date
): boolean {
  if (!days || days.length === 0) {
    return false;
  }
  return days.includes(isoWeekdayInTz(now, tz));
}
