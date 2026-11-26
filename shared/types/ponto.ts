// DTOs do painel "Livro de Ponto" (Pro module "ponto") — partilhados
// entre server/routes/ponto.ts e src/pages/ponto/*. O status EFETIVO de
// uma entry é sempre derivado: a decisão da validação mais recente, ou
// entry.status quando não há validações (o registo é append-only).

export type PontoEntryType = "ENTRADA" | "PAUSA" | "VOLTEI" | "SAIDA";
export type PontoEntryStatus = "APROVADO" | "POR_VALIDAR";
export type PontoEffectiveStatus = PontoEntryStatus | "RECUSADO";
export type PontoDecision = "APROVADO" | "RECUSADO";
export type PontoTransport =
  | "WHATSAPP_META"
  | "WHATSAPP_EVOLUTION"
  | "SMS"
  | "MANUAL";
export type PontoNowState = "a_trabalhar" | "em_pausa" | "saiu" | "sem_registo";

export interface PontoProofs {
  accuracy?: number | null;
  codeValid?: boolean;
  distanceM?: number | null;
  hasPhoto?: boolean;
  insideRadius?: boolean;
  lat?: number | null;
  lng?: number | null;
  manual?: boolean;
  onShopWifi?: boolean;
  photoSentAt?: string;
  [key: string]: unknown;
}

export interface PontoEntryUser {
  id: string;
  name: string | null;
  phoneE164: string | null;
  username: string;
}

/** Resumo da entry que uma correção (correctsId) substitui. */
export interface PontoCorrectedRef {
  at: string;
  id: string;
  type: PontoEntryType;
}

export interface PontoEntryDTO {
  at: string;
  /** Entry que corrige esta (se existir) — esta fica fora dos cálculos. */
  correctedBy: PontoCorrectedRef | null;
  corrects: PontoCorrectedRef | null;
  correctsId: string | null;
  createdAt: string;
  createdByName: string | null;
  effectiveStatus: PontoEffectiveStatus;
  hasCorrection: boolean;
  id: string;
  proofs: PontoProofs;
  reason: string | null;
  status: PontoEntryStatus;
  transport: PontoTransport;
  type: PontoEntryType;
  user: PontoEntryUser;
  validations: {
    at: string;
    byUserName: string | null;
    decision: PontoDecision;
    id: string;
    note: string | null;
  }[];
}

export type PontoPendingEntryDTO = PontoEntryDTO;

export interface PontoNowUserDTO {
  lastAt: string | null;
  lastEntryId: string | null;
  lastType: PontoEntryType | null;
  name: string;
  phoneE164: string | null;
  state: PontoNowState;
  userId: string;
}

export interface PontoEntriesResponse {
  items: PontoEntryDTO[];
  limit: number;
  offset: number;
  total: number;
}

export interface PontoDayHoursDTO {
  /** Minutos antes de pontoScheduleEnd (0 sem horário/sem saída). */
  earlyExitMinutes: number;
  firstEntradaAt: string | null;
  /** Algum evento do dia é ou foi corrigido. */
  hasCorrection: boolean;
  lastSaidaAt: string | null;
  /** Minutos de atraso vs pontoScheduleStart (0 sem horário/sem entrada). */
  lateMinutes: number;
  /** O último evento efetivo do dia não é SAIDA. */
  missingExit: boolean;
  /** Instantes em que uma foto de prova foi enviada nesse dia (nunca a imagem). */
  photoSentAts?: string[];
  /** Registos efetivamente RECUSADOS nesse dia. */
  recusadoCount: number;
  /** Minutos efetivamente trabalhados (entradas→pausa/saída, volteis→pausa/saída). */
  workedMinutes: number;
}

export interface PontoUserDayHoursDTO {
  date: string;
  hours: PontoDayHoursDTO;
  userId: string;
  userName: string;
}

export interface PontoHoursResponse {
  days: PontoUserDayHoursDTO[];
  from: string;
  to: string;
}

export interface PontoMissingExitDTO {
  date: string;
  lastAt: string;
  lastType: PontoEntryType;
  userId: string;
  userName: string;
}

// ── Exportação ACT (art. 202.º CT) ─────────────────────────────────────
// Dataset canónico gerado 100% no servidor local. O hash SHA-256 é
// calculado sobre este JSON canónico (chaves ordenadas, UTF-8), antes de
// qualquer formatação PDF/Excel ou tradução de etiquetas.

export interface PontoActCompanyDTO {
  address: string | null;
  locality: string | null;
  name: string;
  phone: string | null;
  taxId: string | null;
}

export interface PontoActActorDTO {
  id: string;
  name: string;
  username: string;
}

export interface PontoActValidationDTO {
  at: string;
  byUserName: string | null;
  decision: PontoDecision;
  note: string | null;
}

/** Vista mínima de uma entry ligada por correção (original ou correção). */
export interface PontoActLinkedEntryDTO {
  at: string;
  createdAt: string;
  createdByName: string | null;
  effectiveStatus: PontoEffectiveStatus;
  id: string;
  reason: string | null;
  status: PontoEntryStatus;
  transport: PontoTransport;
  type: PontoEntryType;
  /**
   * Validações desta linha, da mais recente para a mais antiga — uma
   * correção ligada pode ser o único registo visível de uma picagem fora
   * do período, por isso o estado/autor da decisão viajam sempre junto.
   */
  validations: PontoActValidationDTO[];
}

export interface PontoActEntryDTO extends PontoActLinkedEntryDTO {
  /** Correções desta linha, mesmo quando a correção cai fora do período. */
  corrections: PontoActLinkedEntryDTO[];
  /** Original corrigido por esta linha, mesmo quando cai fora do período. */
  corrects: PontoActLinkedEntryDTO | null;
  correctsId: string | null;
  superseded: boolean;
  validations: PontoActValidationDTO[];
}

export interface PontoActDayDTO {
  date: string;
  entries: PontoActEntryDTO[];
  pauseMinutes: number;
  weekStart: string;
  workedMinutes: number;
}

export interface PontoActWeekDTO {
  end: string;
  start: string;
  workedMinutes: number;
}

export interface PontoActWorkerDTO {
  days: PontoActDayDTO[];
  externalWork: boolean;
  name: string;
  scheduleEnd: string | null;
  scheduleExempt: boolean;
  scheduleStart: string | null;
  totalMinutes: number;
  userId: string;
  username: string;
  weeks: PontoActWeekDTO[];
}

export interface PontoActExportResponse {
  company: PontoActCompanyDTO;
  contentHash: string;
  exportedAt: string;
  exportedBy: PontoActActorDTO;
  hashAlgorithm: "SHA-256";
  hashInput: "canonical-json-v1";
  period: {
    from: string;
    timeZone: string;
    to: string;
  };
  workers: PontoActWorkerDTO[];
}
