// Sincronização da configuração do livro de ponto para a Cloud
// (contrato WP0.1 — a Cloud é a autoridade de avaliação: geo/raio, flags
// de externos e a escala de staff vivem lá, não no corpo do evaluate).
//
// Gatilhos: gravação das definições do ponto (PUT /api/ponto/config),
// pairing com a Cloud e arranque do servidor — todos best-effort: uma
// Cloud em baixo nunca impede a operação local, e o arranque seguinte
// torna a tentativa.
//
// A lista staff é a completa (internos E externos): o evaluate da Cloud
// recusa telefones não registados, por isso omitir um funcionário interno
// bloqueava-lhe as marcações mesmo com o QR certo.

import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../../lib/crypto.js";
import { getOrCreateShopSettings } from "../../repositories/settings.repository.js";
import type { DbClient } from "../../repositories/types.js";
import { cloudFetch } from "../cloud.service.js";

export interface PontoStaffConfigRow {
  externalWork: boolean;
  phone: string;
  smsAllowed: boolean;
}

export interface PontoCloudConfigPayload {
  externalAutoApprove: boolean;
  photoRequired: boolean;
  shopGeo: { lat: number; lng: number; radiusM: number } | null;
  smsNumber: string | null;
  staff: PontoStaffConfigRow[];
  timezone: string;
  waNumber: string | null;
}

interface PontoSettingsRow {
  pontoExternalAutoApprove: boolean;
  pontoExternalPhotoRequired: boolean;
  pontoGeoLat: number | null;
  pontoGeoLng: number | null;
  pontoRadiusM: number;
  pontoSmsNumber: string | null;
  pontoWaNumber: string | null;
  timezone: string | null;
}

/** Payload completo do PUT /ponto/config — puro, para teste direto. */
export function buildPontoConfigPayload(
  settings: PontoSettingsRow,
  staffUsers: {
    externalWork: boolean;
    phoneE164: string | null;
    pontoSmsAllowed: boolean;
  }[]
): PontoCloudConfigPayload {
  const hasGeo = settings.pontoGeoLat !== null && settings.pontoGeoLng !== null;
  return {
    externalAutoApprove: settings.pontoExternalAutoApprove,
    photoRequired: settings.pontoExternalPhotoRequired,
    shopGeo: hasGeo
      ? {
          lat: settings.pontoGeoLat as number,
          lng: settings.pontoGeoLng as number,
          radiusM: settings.pontoRadiusM,
        }
      : null,
    smsNumber: settings.pontoSmsNumber,
    staff: staffUsers
      .filter((u) => u.phoneE164)
      .map((u) => ({
        externalWork: u.externalWork,
        phone: u.phoneE164 as string,
        smsAllowed: u.pontoSmsAllowed,
      })),
    // A timezone efetiva — mesma resolução do dashboardScope
    // (definição → env TZ → UTC): os limites de dia que a Cloud avalia
    // têm de bater com o agrupamento que o painel mostra.
    timezone: settings.timezone ?? process.env.TZ ?? "UTC",
    waNumber: settings.pontoWaNumber,
  };
}

/** Escala completa: Users ativos com pontoEnabled e telefone registado. */
async function fetchPontoStaffUsers(prisma: DbClient) {
  return await prisma.user.findMany({
    select: {
      externalWork: true,
      phoneE164: true,
      pontoSmsAllowed: true,
    },
    where: { isActive: true, pontoEnabled: true },
  });
}

export interface PontoConfigPushResult {
  body: unknown;
  ok: boolean;
  status: number;
}

/**
 * PUT /ponto/config na Cloud com a configuração completa. Devolve null
 * quando não há pairing ou a Cloud/rede falhou — o chamador decide se o
 * erro é para o utilizador (gravação de definições) ou só para o log
 * (pairing/arranque). Nunca lança por falha de rede.
 */
export async function pushPontoCloudConfig(
  prisma: DbClient,
  log: FastifyBaseLogger
): Promise<PontoConfigPushResult | null> {
  const settings = await getOrCreateShopSettings(prisma).catch(() => null);
  if (!(settings?.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    return null;
  }
  const staff = await fetchPontoStaffUsers(prisma);
  const payload = buildPontoConfigPayload(settings, staff);
  const token = decryptSecret(settings.cloudShopTokenEncrypted);
  const res = await cloudFetch(settings.cloudApiUrl, "/ponto/config", {
    body: payload,
    method: "PUT",
    token,
  }).catch(() => null);
  if (!res) {
    log.warn("ponto config sync: cloud unreachable");
    return null;
  }
  if (!res.ok) {
    log.warn({ status: res.status }, "ponto config sync: cloud recusou");
  }
  return { body: res.body, ok: res.ok, status: res.status };
}
