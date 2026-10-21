import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import { loadEnv } from "../config/env.js";
import {
  countPhotos,
  createPhoto as createPhotoRepo,
  deletePhotoById,
  findJobById,
  findPhotoByIdAndJob,
} from "../repositories/job-photo.repository.js";
import { validateMagicBytes } from "../utils/file-validation.js";
import { assertJobMutable } from "../utils/job-mutations.js";
import { createAuditLog } from "./audit.service.js";

const UPLOAD_BASE = path.resolve(loadEnv().UPLOAD_DIR);
const PHOTO_SUBDIR = "job-photos";
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];

function extFromMime(mime: string): string {
  if (mime === "image/png") {
    return "png";
  }
  if (mime === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export async function upload(
  prisma: PrismaClient,
  jobId: string,
  file: { mimetype: string; toBuffer: () => Promise<Buffer> },
  userId: string,
  options?: {
    skipMutabilityCheck?: boolean;
    stage?: "INTAKE" | "REPAIR" | "FINAL";
  }
) {
  const job = await findJobById(prisma, jobId);
  if (!job) {
    return null;
  }
  if (!options?.skipMutabilityCheck) {
    const mutabilityError = assertJobMutable(job);
    if (mutabilityError) {
      return mutabilityError;
    }
  }

  const photoCount = await countPhotos(prisma, jobId);
  if (photoCount >= MAX_PHOTOS) {
    return { error: "PHOTO_LIMIT_REACHED" as const };
  }

  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return { error: "INVALID_FILE_TYPE" as const };
  }

  const buffer = await file.toBuffer();
  if (buffer.length > MAX_PHOTO_BYTES) {
    return { error: "FILE_TOO_LARGE" as const };
  }
  if (!validateMagicBytes(buffer, file.mimetype)) {
    return { error: "INVALID_FILE_CONTENT" as const };
  }

  const ext = extFromMime(file.mimetype);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const jobDir = path.join(UPLOAD_BASE, PHOTO_SUBDIR, jobId);
  const filePath = path.join(jobDir, filename);

  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  const relativePath = `job-photos/${jobId}/${filename}`;
  let photo: Awaited<ReturnType<typeof createPhotoRepo>>;
  try {
    photo = await createPhotoRepo(prisma, {
      job: { connect: { id: jobId } },
      path: relativePath,
      ...(options?.stage ? { stage: options.stage } : {}),
    });
  } catch (err) {
    await fs.unlink(filePath).catch(() => undefined);
    throw err;
  }

  await createAuditLog(prisma, {
    jobId,
    userId,
    action: AuditAction.PHOTO_ADDED,
    toValue: filename,
  });

  return photo;
}

export async function remove(
  prisma: PrismaClient,
  jobId: string,
  photoId: string,
  userId: string
) {
  const photo = await findPhotoByIdAndJob(prisma, photoId, jobId);
  if (!photo) {
    return null;
  }

  const fullPath = path.resolve(UPLOAD_BASE, photo.path);
  if (
    fullPath !== UPLOAD_BASE &&
    !fullPath.startsWith(UPLOAD_BASE + path.sep)
  ) {
    await deletePhotoById(prisma, photoId);
    return true;
  }
  await fs.unlink(fullPath).catch(() => undefined);

  await deletePhotoById(prisma, photoId);

  await createAuditLog(prisma, {
    jobId,
    userId,
    action: AuditAction.PHOTO_REMOVED,
    fromValue: photo.path,
    note: `Photo deleted: ${photo.path}`,
  });

  return true;
}
