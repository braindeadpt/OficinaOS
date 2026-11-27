// Sincronização da configuração do livro de ponto para a Cloud
// (contrato WP0.1 — a Cloud é a autoridade de avaliação: geo/raio, flags
// de externos e a escala de staff vivem lá, não no corpo do evaluate).
//
// Gatilhos: gravação das definições do ponto (PUT /api/ponto/config),
// pairing com a Cloud, arranque do servidor, mudanças de staff nos
// utilizadores e validações/correções do painel — todos best-effort:
// uma Cloud em baixo nunca impede a operação local, e o arranque
// seguinte torna a tentativa.
//
// A lista staff é a completa (internos E externos): o evaluate da Cloud
// recusa telefones não registados, por isso omitir um funcionário interno
// bloqueava-lhe as marcações mesmo com o QR certo.

import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../../lib/crypto.js";
import { getOrCreateShopSettings } from "../../repositories/settings.repository.js";
import type { DbClient } from "../../repositories/types.js";
import { isModuleEnabled } from "../../utils/modules.js";
import { cloudFetch } from "../cloud.service.js";

export interface PontoStaffConfigRow {
  externalWork: boolean;
  /** Última ENTRADA efetiva do livro local — na Cloud conta como estado
   *  manual/corrigido para a sequência do dia, nunca como prova da marcação. */
  manualEntryAt: string | null;
  phone: string;
  revokedBy?: string;
  /** Instantâneo da prova de ENTRADA a revogar (dono recusou a marcação).
   *  A Cloud só limpa a prova se coincidir com a que derivou — nunca a
   *  cria nem substitui por este campo. */
  revokeEntryAt?: string;
  smsAllowed: boolean;
}

export interface PontoCloudConfigPayload {
  alwaysAskLocation: boolean;
  externalAutoApprove: boolean;
  photoRequired: boolean;
  pinSyncVersion: 1;
  remoteAutoApprove: boolean;
  shopGeo: { lat: number; lng: number; radiusM: number } | null;
  smsNumber: string | null;
  staff: PontoStaffConfigRow[];
  timezone: string;
  waNumber: string | null;
}

interface PontoSettingsRow {
  pontoAlwaysAskLocation: boolean;
  pontoExternalAutoApprove: boolean;
  pontoExternalPhotoRequired: boolean;
  pontoGeoLat: number | null;
  pontoGeoLng: number | null;
  pontoRadiusM: number;
  pontoRemoteAutoApprove: boolean;
  pontoSmsNumber: string | null;
  pontoWaNumber: string | null;
  timezone: string | null;
}

/** Payload completo do PUT /ponto/config — puro, para teste direto. */
export function buildPontoConfigPayload(
  settings: PontoSettingsRow,
  staffUsers: {
    externalWork: boolean;
    manualEntryAt?: Date | null;
    phoneE164: string | null;
    pontoSmsAllowed: boolean;
    revokeEntryAt?: Date | null;
    revokedBy?: string | null;
  }[]
): PontoCloudConfigPayload {
  const hasGeo = settings.pontoGeoLat !== null && settings.pontoGeoLng !== null;
  return {
    alwaysAskLocation: settings.pontoAlwaysAskLocation,
    remoteAutoApprove: settings.pontoRemoteAutoApprove,
    externalAutoApprove: settings.pontoExternalAutoApprove,
    photoRequired: settings.pontoExternalPhotoRequired,
    pinSyncVersion: 1,
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
        manualEntryAt: u.manualEntryAt ? u.manualEntryAt.toISOString() : null,
        phone: u.phoneE164 as string,
        ...(u.revokeEntryAt
          ? {
              revokeEntryAt: u.revokeEntryAt.toISOString(),
              ...(u.revokedBy ? { revokedBy: u.revokedBy.slice(0, 80) } : {}),
            }
          : {}),
        smsAllowed: u.pontoSmsAllowed,
      })),
    // A timezone efetiva — mesma resolução do dashboardScope
    // (definição → env TZ → UTC): os limites de dia que a Cloud avalia
    // têm de bater com o agrupamento que o painel mostra.
    timezone: settings.timezone ?? process.env.TZ ?? "UTC",
    waNumber: settings.pontoWaNumber,
  };
}

interface StaffEntryState {
  cloudEntry?: {
    createdAt: Date;
    proofs: unknown;
    validations: {
      byUser: { name: string; username: string };
      decision: string;
    }[];
  };
  manualEntryAt: Date | null;
}

/**
 * Instantâneo que a Cloud gravou como prova da ENTRADA. O contrato novo
 * devolve-o em entryRecordedAt; instalações/entradas anteriores caem para
 * o createdAt local, gravado logo após o evaluate e dentro da tolerância
 * de revogação da Cloud em operação normal (relógios UTC sincronizados).
 */
function entryProofRecordedAt(entry: {
  createdAt: Date;
  proofs: unknown;
}): Date {
  const proofs = entry.proofs;
  if (proofs && typeof proofs === "object" && !Array.isArray(proofs)) {
    const raw = (proofs as Record<string, unknown>).entryRecordedAt;
    if (typeof raw === "string") {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return entry.createdAt;
}

/** Escala completa: Users ativos com pontoEnabled e telefone registado. */
async function fetchPontoStaffUsers(prisma: DbClient) {
  const users = await prisma.user.findMany({
    select: {
      externalWork: true,
      id: true,
      phoneE164: true,
      pontoSmsAllowed: true,
    },
    where: { isActive: true, pontoEnabled: true },
  });
  const ids = users.map((u) => u.id);
  const entries = ids.length
    ? await prisma.timeEntry.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          at: true,
          createdAt: true,
          proofs: true,
          transport: true,
          userId: true,
          validations: {
            orderBy: { at: "desc" as const },
            select: {
              byUser: { select: { name: true, username: true } },
              decision: true,
            },
            take: 1,
          },
        },
        where: {
          corrections: { none: {} },
          type: "ENTRADA",
          userId: { in: ids },
        },
      })
    : [];
  const states = new Map<string, StaffEntryState>(
    users.map((u) => [u.id, { manualEntryAt: null }])
  );
  for (const entry of entries) {
    const state = states.get(entry.userId);
    if (!state) {
      continue;
    }
    const rejected = entry.validations[0]?.decision === "RECUSADO";
    // Linhas substituídas ficam fora pela query. manualEntryAt é o estado
    // efetivo do livro local (inclui validações humanas e correções): na
    // Cloud nunca vira prova de marcação, mas preserva a sequência quando
    // a prova foi revogada ou vem de uma versão anterior. Recusadas pela
    // decisão mais recente não contam.
    if (
      !rejected &&
      (!state.manualEntryAt ||
        entry.at.getTime() > state.manualEntryAt.getTime())
    ) {
      state.manualEntryAt = entry.at;
    }
    // A prova na Cloud é a da ÚLTIMA entrada avaliada/gravada. Se essa
    // linha está recusada, o sync tem de pedir a revogação; uma entrada
    // não-manual anterior já foi substituída na Cloud e não interessa.
    if (entry.transport !== "MANUAL" && !state.cloudEntry) {
      state.cloudEntry = entry;
    }
  }
  return users.map((u) => {
    const state = states.get(u.id);
    const cloudEntry = state?.cloudEntry;
    const validation = cloudEntry?.validations[0];
    const revokedBy = validation?.byUser.name || validation?.byUser.username;
    return {
      ...u,
      manualEntryAt: state?.manualEntryAt ?? null,
      ...(cloudEntry && validation?.decision === "RECUSADO"
        ? {
            revokeEntryAt: entryProofRecordedAt(cloudEntry),
            ...(revokedBy ? { revokedBy } : {}),
          }
        : {}),
    };
  });
}

export interface PontoConfigPushResult {
  body: unknown;
  ok: boolean;
  status: number;
}

// O PUT envia a configuração COMPLETA. Sem fila, duas mutações locais
// seguidas podiam ser aplicadas fora de ordem na Cloud e a escrita mais
// antiga (lida antes da segunda mutação) apagava staff novo. A fila é
// process-wide: cada push só lê a BD depois de o anterior terminar.
let pontoConfigPushQueue: Promise<void> = Promise.resolve();

/**
 * PUT /ponto/config na Cloud com a configuração completa. Devolve null
 * quando não há pairing ou a Cloud/rede falhou — o chamador decide se o
 * erro é para o utilizador (gravação de definições) ou só para o log
 * (pairing/arranque). Nunca lança por falha de rede.
 */
export function pushPontoCloudConfig(
  prisma: DbClient,
  log: FastifyBaseLogger
): Promise<PontoConfigPushResult | null> {
  const push = pontoConfigPushQueue.then(() =>
    pushPontoCloudConfigNow(prisma, log)
  );
  pontoConfigPushQueue = push.then(
    () => undefined,
    () => undefined
  );
  return push;
}

async function pushPontoCloudConfigNow(
  prisma: DbClient,
  log: FastifyBaseLogger
): Promise<PontoConfigPushResult | null> {
  const settings = await getOrCreateShopSettings(prisma).catch(() => null);
  if (!(settings?.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    return null;
  }
  // Privacidade/minimização: sem entitlement fresco de ponto não há
  // finalidade para enviar a lista de telefones à Cloud.
  if (!isModuleEnabled(settings, "ponto")) {
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
    lastConfigPushFailed = true;
    return null;
  }
  lastConfigPushFailed = !res.ok;
  if (!res.ok) {
    log.warn({ status: res.status }, "ponto config sync: cloud recusou");
  }
  // Capacidade da Cloud: probe/needLocation + proofs.kind. Lê-se de cada
  // resposta — Cloud antiga (sem o campo) ou falha de rede mantém o
  // fluxo clássico de pedir sempre a localização.
  const body = res.body as { evaluateProbe?: unknown } | null;
  cloudEvaluateProbeSupported = res.ok && body?.evaluateProbe === true;
  return { body: res.body, ok: res.ok, status: res.status };
}

// Cache em memória da capacidade anunciada pela Cloud no último PUT de
// config bem-sucedido. Conservador por omissão (false): sem certeza, a
// app segue o fluxo clássico e pede sempre a localização primeiro.
let cloudEvaluateProbeSupported = false;

// true quando a última tentativa de enviar a config falhou (rede ou
// recusa) — o poller periódico usa-o para voltar a tentar, senão a
// sonda ficava desligada até ao próximo arranque/sync manual.
let lastConfigPushFailed = false;

/** A Cloud desta instalação já suporta probe/needLocation no evaluate? */
export function cloudSupportsEvaluateProbe(): boolean {
  return cloudEvaluateProbeSupported;
}

/** A última tentativa de PUT da config falhou e deve ser repetida? */
export function pontoConfigPushFailed(): boolean {
  return lastConfigPushFailed;
}
