// Wrapper do endpoint Cloud POST /ponto/evaluate (contrato do plano
// §2.3). A Cloud é a autoridade: valida código QR, janela de frescura,
// raio da loja, foto obrigatória e flags do funcionário — a app só
// transporta provas e grava o veredicto.
//
// Credenciais: cloudApiUrl + cloudShopTokenEncrypted das definições —
// mesmo esquema dos restantes serviços cloud (decryptSecret + Bearer).

import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../../lib/crypto.js";
import { getOrCreateShopSettings } from "../../repositories/settings.repository.js";
import type { DbClient } from "../../repositories/types.js";
import { cloudFetch } from "../cloud.service.js";
import type { PontoCommand } from "./commands.js";
import type { PontoPendingLocation } from "./state.js";

export type PontoEvaluateStatus = "APROVADO" | "POR_VALIDAR" | "RECUSADO";
export type PontoTransportKind = "sms" | "whatsapp_evolution" | "whatsapp_meta";

export interface PontoEvaluateInput {
  code?: string;
  externalAutoApprove: boolean;
  hasPhoto: boolean;
  location?: PontoPendingLocation;
  /** ISO do instante de envio da mensagem de comando (sentAt ??
   *  createdAt) — ver state.ts commandAt. */
  messageAt?: string;
  phone: string;
  photoRequired?: boolean;
  shopGeo: { lat: number; lng: number; radiusM: number };
  todayHasEntry: boolean;
  transport: PontoTransportKind;
  /** Comando original (ENTRADA pode ter sido convertido em VOLTEI por
   *  pausa — o `type` enviado é o efetivo). */
  type: Exclude<PontoCommand, "ESTADO">;
  user: { externalWork: boolean; smsAllowed: boolean };
}

export interface PontoEvaluateResult {
  proofs: Record<string, unknown>;
  reason?: string;
  status: PontoEvaluateStatus;
}

interface CloudEvaluateBody {
  proofs?: unknown;
  reason?: unknown;
  status?: unknown;
}

const EVALUATE_STATUSES = new Set<PontoEvaluateStatus>([
  "APROVADO",
  "POR_VALIDAR",
  "RECUSADO",
]);

/**
 * Chama a Cloud. Devolve o resultado ou null em qualquer falha
 * (sem pairing, rede, HTTP não-2xx, corpo inválido) — o chamador trata
 * null como "não consegui validar" e NÃO grava registo.
 */
export async function evaluatePontoMark(
  prisma: DbClient,
  log: FastifyBaseLogger,
  input: PontoEvaluateInput
): Promise<PontoEvaluateResult | null> {
  const settings = await getOrCreateShopSettings(prisma).catch(() => null);
  if (!(settings?.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    log.warn("ponto evaluate: loja sem pairing cloud — registo ignorado");
    return null;
  }
  const token = decryptSecret(settings.cloudShopTokenEncrypted);
  const res = await cloudFetch(settings.cloudApiUrl, "/ponto/evaluate", {
    body: input,
    method: "POST",
    token,
  }).catch(() => null);
  if (!res) {
    log.warn("ponto evaluate: cloud unreachable");
    return null;
  }
  if (!res.ok) {
    log.warn({ status: res.status }, "ponto evaluate: cloud recusou o pedido");
    return null;
  }
  const body = res.body as CloudEvaluateBody | null;
  const status = body?.status;
  if (
    typeof status !== "string" ||
    !EVALUATE_STATUSES.has(status as PontoEvaluateStatus)
  ) {
    log.warn({ body: res.body }, "ponto evaluate: resposta inválida da cloud");
    return null;
  }
  return {
    proofs:
      body?.proofs && typeof body.proofs === "object"
        ? (body.proofs as Record<string, unknown>)
        : {},
    reason: typeof body?.reason === "string" ? body.reason : undefined,
    status: status as PontoEvaluateStatus,
  };
}
