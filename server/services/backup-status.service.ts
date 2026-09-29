import { promises as fs } from "node:fs";
import path from "node:path";
import { loadEnv } from "../config/env.js";

export interface BackupStatus {
  /** Number of dump files the backup volume currently holds. */
  dumpCount: number;
  /** Hours elapsed since the heartbeat (rounded); null without heartbeat. */
  hoursAgo: number | null;
  /** ISO timestamp of the last heartbeat, null when never backed up. */
  lastBackupAt: string | null;
  /** True when the heartbeat is missing or older than 26h. */
  stale: boolean;
}

/**
 * Reads the backup sidecar status. The db-backup container writes a
 * heartbeat file plus timestamped dumps into volumes mounted under
 * /backups-status and /backups respectively (see docker-compose*.yml).
 * Missing files degrade gracefully to nulls so the UI can show
 * "backups not configured" instead of erroring.
 */
export async function getBackupStatus(): Promise<BackupStatus> {
  const uploadDir = path.resolve(loadEnv().UPLOAD_DIR);
  const heartbeatDir = path.join(uploadDir, "backups-status");
  const dumpDir = path.join(uploadDir, "backups");
  const heartbeatFile = path.join(heartbeatDir, "last-backup.txt");

  const [heartbeat, dumpCount] = await Promise.all([
    fs.readFile(heartbeatFile, "utf8").then(
      (v) => v.trim(),
      () => null
    ),
    fs.readdir(dumpDir).then(
      (files) =>
        files.filter((f) => f.startsWith("oficinaos-") && f.endsWith(".sql.gz"))
          .length,
      () => 0
    ),
  ]);

  if (!heartbeat) {
    return { lastBackupAt: null, hoursAgo: null, stale: true, dumpCount };
  }

  const last = new Date(heartbeat);
  const hoursAgo =
    Math.round(((Date.now() - last.getTime()) / 3_600_000) * 10) / 10;
  const valid = !Number.isNaN(last.getTime());

  return {
    lastBackupAt: valid ? last.toISOString() : null,
    hoursAgo: valid ? hoursAgo : null,
    stale: !valid || hoursAgo > 26,
    dumpCount,
  };
}
