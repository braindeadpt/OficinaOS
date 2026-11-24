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
  /** A correção aponta para a linha que substitui — o `at` dela é o dia
   *  civil do turno a que a correção pertence (uma saída corrigida para
   *  depois da meia-noite continua a fechar o turno do dia em que
   *  abriu). */
  corrects?: { at: Date } | null;
  status: string;
  type: TimeEntryType;
}

/** Registos do dia civil da loja (fuso das definições) para um user —
 *  usado pelo gate "entrada hoje" e pelo resumo do ESTADO. Desempate
 *  por createdAt: uma PAUSA e a SAIDA presumida ao mesmo instante ficam
 *  com ordem determinística (a escrita mais recente decide o "último"). */
export function todayPontoEntries(
  prisma: DbClient,
  userId: string,
  tz: string,
  now = new Date()
): Promise<PontoTodayEntry[]> {
  const { start, end } = todayRange(tz, now);
  return prisma.timeEntry.findMany({
    orderBy: [{ at: "asc" }, { createdAt: "asc" }],
    select: { at: true, status: true, type: true },
    where: { at: { gte: start, lt: end }, userId },
  });
}

/** SAIDA presumida do dia ainda por corrigir (item 5): proofs
 *  .exitReminderPresumed=true e nenhuma correction a apontar. É a
 *  "pergunta pendente" do fluxo Esquecimentos — a resposta do
 *  trabalhador, uma SAIDA normal ou a correção do painel fecham-na. */
export function findOpenPresumedExit(
  prisma: DbClient,
  userId: string,
  tz: string,
  now = new Date()
): Promise<{ at: Date; id: string } | null> {
  const { start, end } = todayRange(tz, now);
  return prisma.timeEntry.findFirst({
    orderBy: { at: "desc" },
    select: { at: true, id: true },
    where: {
      at: { gte: start, lt: end },
      corrections: { none: {} },
      proofs: { equals: true, path: ["exitReminderPresumed"] },
      type: "SAIDA",
      userId,
    },
  });
}

/** Registos do user desde um instante (sem limite superior) — o ESTADO
 *  usa para as "horas da semana". Só marcações efetivas: linhas já
 *  substituídas por uma correção (correctsId a apontar para elas, ex.:
 *  a SAIDA presumida corrigida pela resposta ao lembrete) ficam de
 *  fora — senão o resumo listava a presumida e a correção, contava a
 *  pendência em duplicado e fechava o turno na primeira saída. */
export function pontoEntriesSince(
  prisma: DbClient,
  userId: string,
  since: Date
): Promise<PontoTodayEntry[]> {
  return prisma.timeEntry.findMany({
    orderBy: [{ at: "asc" }, { createdAt: "asc" }],
    select: {
      at: true,
      corrects: { select: { at: true } },
      status: true,
      type: true,
    },
    where: { at: { gte: since }, corrections: { none: {} }, userId },
  });
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
// (cleanupPontoPhotos, ligado ao runCleanup do index.ts na branch do
// painel — feat/ponto-panel).
