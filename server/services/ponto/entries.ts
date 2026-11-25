// Escritas do livro de ponto: TimeEntry (append-only — nunca UPDATE,
// correções são linhas novas com correctsId) e PontoPhoto (ficheiro em
// UPLOAD_DIR/ponto-photos/<userId>/ + linha; sem rota pública — o painel
// é o item 4). A foto chega ANTES do registo (a Cloud só avalia depois
// de a termos) — entryId é texto simples no schema, sem FK.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  Prisma,
  TimeEntryTransport,
  TimeEntryType,
} from "@generated/client";
import { loadEnv } from "../../config/env.js";
import type { DbClient } from "../../repositories/types.js";
import { validateMagicBytes } from "../../utils/file-validation.js";
import { todayRange } from "../../utils/time-range.js";

const UPLOAD_BASE = path.resolve(loadEnv().UPLOAD_DIR);
export const PONTO_PHOTO_SUBDIR = "ponto-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];

export interface PontoTimeEntryInput {
  at: Date;
  /** Correção: aponta para a entry substituída (ex.: SAIDA presumida). */
  correctsId?: string | null;
  proofs: Record<string, unknown>;
  reason?: string | null;
  status: "APROVADO" | "POR_VALIDAR";
  transport: TimeEntryTransport;
  type: TimeEntryType;
  userId: string;
}

export function recordPontoEntry(prisma: DbClient, input: PontoTimeEntryInput) {
  return prisma.timeEntry.create({
    data: {
      at: input.at,
      correctsId: input.correctsId ?? null,
      proofs: input.proofs as Prisma.InputJsonValue,
      reason: input.reason ?? null,
      status: input.status,
      transport: input.transport,
      type: input.type,
      userId: input.userId,
      // createdById fica null — o registo é do bot, não de um utilizador.
    },
    select: { id: true },
  });
}

export interface PontoTodayEntry {
  at: Date;
  status: string;
  type: TimeEntryType;
  /** Decisão mais recente do painel — presente só em pontoEntriesSince
   *  (o status da linha não muda com a validação, é append-only). */
  validations?: { decision: string }[];
}

/** Registos do dia civil da loja (fuso das definições) para um user —
 *  usado pelo gate "entrada hoje" e pelo resumo do ESTADO. Desempate
 *  por createdAt: uma PAUSA e a SAIDA presumida ao mesmo instante ficam
 *  com ordem determinística (a escrita mais recente decide o "último").
 *  Linhas anuladas ficam de fora: as já substituídas por uma correção
 *  (senão a original e a correção contavam as duas) e as recusadas
 *  pela gerência — uma entrada recusada não pode valer como pré-
 *  requisito de PAUSA/VOLTEI/SAIDA. */
/** A validação mais recente da linha é recusa? As validações são
 *  append-only e a ÚLTIMA decisão é que conta — uma recusa seguida de
 *  re-aprovação no painel não pode esconder a marcação (por isso o
 *  filtro é em memória sobre validations[0], nunca `none` na query:
 *  esse excluiria a linha mesmo depois de re-aprovada). */
export function latestValidationIsRejection(row: {
  validations?: { decision: string }[];
}): boolean {
  return row.validations?.[0]?.decision === "RECUSADO";
}

const LATEST_VALIDATION_SELECT = {
  orderBy: { at: "desc" as const },
  select: { decision: true },
  take: 1,
};

export async function todayPontoEntries(
  prisma: DbClient,
  userId: string,
  tz: string,
  now = new Date()
): Promise<PontoTodayEntry[]> {
  const { start, end } = todayRange(tz, now);
  const rows = await prisma.timeEntry.findMany({
    orderBy: [{ at: "asc" }, { createdAt: "asc" }],
    select: {
      at: true,
      status: true,
      type: true,
      validations: LATEST_VALIDATION_SELECT,
    },
    where: {
      at: { gte: start, lt: end },
      corrections: { none: {} },
      userId,
    },
  });
  return rows.filter((r) => !latestValidationIsRejection(r));
}

/** SAIDA presumida do dia ainda por corrigir (item 5): proofs
 *  .exitReminderPresumed=true e nenhuma correction a apontar. É a
 *  "pergunta pendente" do fluxo Esquecimentos — a resposta do
 *  trabalhador, uma SAIDA normal ou a correção do painel fecham-na.
 *  Presumida recusada pela gerência NÃO é oferecida: a recusa passa
 *  a decisão para o painel e uma SAIDA normal do trabalhador nunca
 *  a pode substituir por cima da recusa — fica registo novo, e a
 *  presumida recusada continua à espera de decisão do gestor. */
export async function findOpenPresumedExit(
  prisma: DbClient,
  userId: string,
  tz: string,
  now = new Date()
): Promise<{ at: Date; id: string } | null> {
  const { start, end } = todayRange(tz, now);
  const rows = await prisma.timeEntry.findMany({
    orderBy: { at: "desc" },
    select: { at: true, id: true, validations: LATEST_VALIDATION_SELECT },
    where: {
      at: { gte: start, lt: end },
      corrections: { none: {} },
      proofs: { equals: true, path: ["exitReminderPresumed"] },
      type: "SAIDA",
      userId,
    },
  });
  const open = rows.find((r) => !latestValidationIsRejection(r));
  return open ? { at: open.at, id: open.id } : null;
}

/** Registos do user desde um instante (sem limite superior) — o ESTADO
 *  usa para as "horas da semana". Só marcações efetivas: linhas já
 *  substituídas por uma correção (correctsId a apontar para elas, ex.:
 *  a SAIDA presumida corrigida pela resposta ao lembrete) ficam de
 *  fora — senão o resumo listava a presumida e a correção, contava a
 *  pendência em duplicado e fechava o turno na primeira saída. Linhas
 *  recusadas pela gerência também ficam de fora: uma marcação anulada
 *  não conta horas nem aparece no resumo. A decisão mais recente vem
 *  no resultado — o status da linha é o da avaliação automática e não
 *  muda com a validação (append-only), por isso um registo já decidido
 *  no painel não pode continuar a contar como "por validar". */
export async function pontoEntriesSince(
  prisma: DbClient,
  userId: string,
  since: Date
): Promise<PontoTodayEntry[]> {
  const rows = await prisma.timeEntry.findMany({
    orderBy: [{ at: "asc" }, { createdAt: "asc" }],
    select: {
      at: true,
      status: true,
      type: true,
      validations: {
        orderBy: { at: "desc" },
        select: { decision: true },
        take: 1,
      },
    },
    where: {
      at: { gte: since },
      corrections: { none: {} },
      userId,
    },
  });
  return rows.filter((r) => !latestValidationIsRejection(r));
}

export function detectPontoImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function extFromMime(mime: string): string {
  if (mime === "image/png") {
    return "png";
  }
  if (mime === "image/webp") {
    return "webp";
  }
  return "jpg";
}

/**
 * Valida e grava a foto de prova. Devolve o id da PontoPhoto ou null se
 * os bytes não forem uma imagem válida — a presença da foto continua a
 * contar como prova (hasPhoto) mesmo sem ficheiro guardado.
 */
export async function savePontoPhotoFile(
  prisma: DbClient,
  userId: string,
  buffer: Buffer,
  hintedMime?: string | null,
  baseDir = UPLOAD_BASE
): Promise<{ id: string; path: string } | null> {
  if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) {
    return null;
  }
  const mime =
    hintedMime && ALLOWED_MIMES.includes(hintedMime)
      ? hintedMime
      : detectPontoImageMime(buffer);
  if (
    !(mime && ALLOWED_MIMES.includes(mime) && validateMagicBytes(buffer, mime))
  ) {
    return null;
  }
  const dir = path.join(baseDir, PONTO_PHOTO_SUBDIR, userId);
  await fs.mkdir(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${extFromMime(mime)}`;
  const abs = path.join(dir, filename);
  await fs.writeFile(abs, buffer);
  const rel = path
    .join(PONTO_PHOTO_SUBDIR, userId, filename)
    .split(path.sep)
    .join("/");
  return prisma.pontoPhoto.create({
    data: { path: rel, userId },
    select: { id: true, path: true },
  });
}

/** Liga a foto ao registo depois de este existir (provas.photoId). */
export async function linkPontoPhoto(
  prisma: DbClient,
  photoId: string,
  entryId: string
): Promise<void> {
  await prisma.pontoPhoto.update({
    data: { entryId },
    where: { id: photoId },
  });
}

/** Apaga a linha e o ficheiro — usado quando o registo não se concretiza
 *  (RECUSADO / evaluate indisponível) para não deixar órfãs. */
export async function deletePontoPhoto(
  prisma: DbClient,
  photoId: string
): Promise<void> {
  const photo = await prisma.pontoPhoto
    .findUnique({ select: { path: true }, where: { id: photoId } })
    .catch(() => null);
  await prisma.pontoPhoto.delete({ where: { id: photoId } }).catch(() => null);
  if (photo?.path) {
    const abs = path.resolve(UPLOAD_BASE, photo.path);
    // Nunca seguir caminhos fora do upload dir.
    if (abs.startsWith(UPLOAD_BASE + path.sep)) {
      await fs.unlink(abs).catch(() => null);
    }
  }
}

// A purga de fotos >90 dias vive em services/ponto-photos.service.ts
// (cleanupPontoPhotos, ligado ao runCleanup do index.ts — a linha morre,
// o TimeEntry fica com a referência órfã que o painel mostra como
// "foto expirada").
