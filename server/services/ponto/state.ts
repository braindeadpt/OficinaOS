// Estado pendente do fluxo ponto — em memória, por instância.
// Chave: `${transport}:${phoneDigits}` — um pedido de localização (3 min)
// ou de foto (5 min) pendente; o passo seguinte (localização ou foto)
// completa o registo. Tal como o rate limiter, reiniciar o processo
// perde pendentes — efeito aceite: o funcionário reenvia o comando.
//
// TTLs do plano: localização 3 min, foto 5 min. Um comando novo
// substitui o pendente anterior; uma foto tardia depois do timeout é
// finalizada com hasPhoto=false (o registo não se perde — §2.1).

import type { PontoCommand } from "./commands.js";

export const PONTO_LOCATION_TTL_MS = 3 * 60 * 1000;
export const PONTO_PHOTO_TTL_MS = 5 * 60 * 1000;

export interface PontoPendingLocation {
  accuracy?: number;
  lat: number;
  lng: number;
}

export interface PendingPonto {
  /** Código de 4 dígitos do QR — só ENTRADA o usa. */
  code?: string;
  command: Exclude<PontoCommand, "ESTADO">;
  /** ISO do instante de envio da mensagem de COMANDO — sentAt da Meta
   *  quando a fila oficial o traz, senão msg.createdAt (na Evolution o
   *  createdAt já é o timestamp da mensagem). A Cloud valida o código
   *  contra este instante (skew ≤2 min) e a frescura do registo
   *  (≤5 min de atraso). */
  commandAt: string;
  expiresAt: number;
  externalWork: boolean;
  location?: PontoPendingLocation;
  /** ISO do msg.createdAt da mensagem de localização — base do `at`
   *  (hora do servidor ≈ momento da prova de presença). */
  locationAt?: string;
  /** ISO do último PAUSA do dia — base do "(pausa de N min)" na
   *  confirmação de VOLTEI/Regresso. */
  pauseSinceAt?: string;
  stage: "location" | "photo";
  /** Entrada já existia hoje no comando (gate PAUSA/VOLTEI/SAIDA). */
  todayHasEntry: boolean;
  userId: string;
  userName: string;
  /** ExternalWork exige foto de prova (plano §2.1). */
  wantPhoto: boolean;
}

const pending = new Map<string, PendingPonto>();

export function pontoPendingKey(
  transport: string,
  phoneDigits: string
): string {
  return `${transport}:${phoneDigits}`;
}

export function setPendingPonto(key: string, value: PendingPonto): void {
  pending.set(key, value);
}

export function clearPendingPonto(key: string): void {
  pending.delete(key);
}

/** Pendência viva, ou null (e remove) se expirada. */
export function getPendingPonto(
  key: string,
  now = Date.now()
): PendingPonto | null {
  const p = pending.get(key);
  if (!p) {
    return null;
  }
  if (p.expiresAt <= now) {
    pending.delete(key);
    return null;
  }
  return p;
}

/** Pendência expirada (para o handler decidir o que fazer — ex.:
 *  finalizar foto com hasPhoto=false), ou null se viva/inexistente. */
export function takeExpiredPonto(
  key: string,
  now = Date.now()
): PendingPonto | null {
  const p = pending.get(key);
  if (p && p.expiresAt <= now) {
    pending.delete(key);
    return p;
  }
  return null;
}

/** Apenas para testes — esvazia o mapa entre casos. */
export function clearAllPendingPonto(): void {
  pending.clear();
}
