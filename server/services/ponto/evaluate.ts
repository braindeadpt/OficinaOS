// Wrapper do endpoint Cloud POST /ponto/evaluate (contrato do plano
// §2.3). A Cloud é a autoridade: valida código QR, janela de frescura,
// raio da loja, foto obrigatória e flags do funcionário — a app só
// transporta provas e grava o veredicto.
//
// WP0.1: geo/raio, externalWork/smsAllowed, autoaprovação e "tem entrada
// hoje" são lidos pela Cloud da configuração autoritativa (PUT
// /ponto/config — ver config-sync.ts). Versões anteriores deste módulo
// enviavam esses campos no corpo do evaluate; a Cloud atual tolera-os
// mas ignora-os, por isso deixaram de ser enviados. todayHasEntry
// continua a ser calculado localmente para o fluxo de conversa
// (PAUSA/VOLTEI/SAIDA exigem entrada — ver handler.ts), só não segue
// no payload.
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
  hasPhoto: boolean;
  location?: PontoPendingLocation;
  /** ISO do instante de envio da mensagem de comando (sentAt ??
   *  createdAt) — ver state.ts commandAt. */
  messageAt?: string;
  phone: string;
  /** Sonda (Cloud nova): a app ainda pode recolher localização. A Cloud
   *  responde needLocation sem consumir o código nem gravar nada, ou
   *  finaliza logo se a prova chegar sem coordenadas. Ignorado por
   *  Clouds antigas — por isso só se envia quando a config anuncia a
   *  capacidade (ver config-sync.ts). */
  probe?: boolean;
  transport: PontoTransportKind;
  /** Comando original (ENTRADA pode ter sido convertido em VOLTEI por
   *  pausa — o `type` enviado é o efetivo). */
  type: Exclude<PontoCommand, "ESTADO">;
}

export interface PontoEvaluateResult {
  /** Instante da prova gravada pela Cloud — necessário para revogar uma
   *  ENTRADA que o dono recuse depois. Clouds sem o campo novo omitem-no. */
  entryRecordedAt?: string;
  /** Resposta a uma sonda: falta prova — recolher localização e reenviar.
   *  Nada foi consumido nem gravado. Clouds antigas nunca o enviam. */
  needLocation?: boolean;
  proofs: Record<string, unknown>;
  reason?: string;
  status: PontoEvaluateStatus;
}

interface CloudEvaluateBody {
  entryRecordedAt?: unknown;
  needLocation?: unknown;
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
  const entryRecordedAt =
    typeof body?.entryRecordedAt === "string" &&
    !Number.isNaN(Date.parse(body.entryRecordedAt))
      ? body.entryRecordedAt
      : undefined;
  return {
    ...(entryRecordedAt ? { entryRecordedAt } : {}),
    ...(body?.needLocation === true ? { needLocation: true } : {}),
    proofs:
      body?.proofs && typeof body.proofs === "object"
        ? (body.proofs as Record<string, unknown>)
        : {},
    reason: typeof body?.reason === "string" ? body.reason : undefined,
    status: status as PontoEvaluateStatus,
  };
}
