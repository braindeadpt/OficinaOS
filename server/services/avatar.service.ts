import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/env.js";
import {
  findUserImage,
  updateUserImage,
} from "../repositories/avatar.repository.js";
import type { DbClient } from "../repositories/types.js";
import { validateMagicBytes } from "../utils/file-validation.js";

const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // file may not exist — ignore
  }
}

export async function uploadAvatar(
  prisma: DbClient,
  userId: string,
  file: { mimetype: string; toBuffer: () => Promise<Buffer> }
) {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return { error: "INVALID_FILE_TYPE" as const };
  }

  const buffer = await file.toBuffer();
  if (buffer.length > MAX_SIZE) {
    return { error: "FILE_TOO_LARGE" as const };
  }
  if (!validateMagicBytes(buffer, file.mimetype)) {
    return { error: "INVALID_FILE_CONTENT" as const };
  }

  const user = await findUserImage(prisma, userId);
  if (!user) {
    return null;
  }

  const ext = MIME_EXT[file.mimetype];
  const uploadBase = path.resolve(loadEnv().UPLOAD_DIR);
  await fs.mkdir(path.join(uploadBase, "avatars"), { recursive: true });

  const relativePath = `avatars/${userId}.${ext}`;
  const dest = path.resolve(uploadBase, relativePath);
  if (dest !== uploadBase && !dest.startsWith(uploadBase + path.sep)) {
    return { error: "INVALID_FILE_TYPE" as const };
  }
  const tmpPath = `${dest}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, buffer);
  try {
    await fs.rename(tmpPath, dest);
  } catch (err) {
    // Don't leave an orphan .tmp file behind; the original error still throws.
    await removeFile(tmpPath);
    throw err;
  }

  if (
    user.image &&
    !user.image.startsWith("data:") &&
    user.image !== relativePath
  ) {
    const oldPath = path.resolve(uploadBase, user.image);
    if (oldPath !== uploadBase && oldPath.startsWith(uploadBase + path.sep)) {
      await removeFile(oldPath);
    }
  }

  await updateUserImage(prisma, userId, relativePath);

  return { image: relativePath };
}

export async function deleteAvatar(prisma: DbClient, userId: string) {
  const user = await findUserImage(prisma, userId);
  if (!user) {
    return null;
  }
  if (!user.image) {
    return { image: null };
  }

  if (!user.image.startsWith("data:")) {
    await removeFile(path.resolve(loadEnv().UPLOAD_DIR, user.image));
  }

  await updateUserImage(prisma, userId, null);

  return { image: null };
}
