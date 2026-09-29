import { promises as fs } from "node:fs";
import path from "node:path";
import { loadEnv } from "../config/env.js";

export interface RemoteBackupStatus {
  /** ISO timestamp of the last successful off-site copy, null when never. */
  lastRemoteCopyAt: string | null;
  /** ISO timestamp of the last successful restore verification, null when never. */
  lastRestoreCheckAt: string | null;
  remoteCopyHoursAgo: number | null;
  /** Off-site copy missing or older than 26h while remote backups run. */
  remoteCopyStale: boolean;
  restoreCheckDaysAgo: number | null;
  /** Restore verification missing or older than the interval + 1 day grace. */
  restoreCheckStale: boolean;
}

export interface BackupStatus {
  /** Number of dump files the backup volume currently holds. */
  dumpCount: number;
  /** Hours elapsed since the heartbeat (rounded); null without heartbeat. */
  hoursAgo: number | null;
  /** ISO timestamp of the last heartbeat, null when never backed up. */
  lastBackupAt: string | null;
  remote: RemoteBackupStatus;
  /** Any off-site heartbeat exists (rclone destination configured and ran). */
  remoteConfigured: boolean;
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
  const remoteCopyFile = path.join(heartbeatDir, "last-remote-copy.txt");
  const restoreCheckFile = path.join(heartbeatDir, "last-restore-check.txt");
  const restoreCheckAttemptFile = path.join(
    heartbeatDir,
    "last-restore-check-attempt.txt"
  );

  const readText = (file: string) =>
    fs.readFile(file, "utf8").then(
      (v) => v.trim(),
      () => null
    );

  const [heartbeat, dumpCount, remoteCopy, restoreCheck, restoreCheckAttempt] =
    await Promise.all([
      readText(heartbeatFile),
      fs.readdir(dumpDir).then(
        (files) =>
          files.filter(
            (f) => f.startsWith("oficinaos-") && f.endsWith(".sql.gz")
          ).length,
        () => 0
      ),
      readText(remoteCopyFile),
      readText(restoreCheckFile),
      readText(restoreCheckAttemptFile),
    ]);

  if (!heartbeat) {
    return {
      lastBackupAt: null,
      hoursAgo: null,
      stale: true,
      dumpCount,
      remoteConfigured: false,
      remote: emptyRemote(),
    };
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
    ...remoteStatus(remoteCopy, restoreCheck, restoreCheckAttempt),
  };
}

function emptyRemote(): RemoteBackupStatus {
  return {
    lastRemoteCopyAt: null,
    remoteCopyHoursAgo: null,
    remoteCopyStale: false,
    lastRestoreCheckAt: null,
    restoreCheckDaysAgo: null,
    restoreCheckStale: false,
  };
}

/**
 * Off-site state from the sidecar's remote heartbeats. Without any of
 * them the destination is treated as not configured (UI hides the
 * section) and nothing is flagged stale — a local-only setup is valid.
 */
function remoteStatus(
  remoteCopy: string | null,
  restoreCheck: string | null,
  restoreCheckAttempt: string | null
): { remoteConfigured: boolean; remote: RemoteBackupStatus } {
  const remoteConfigured = Boolean(
    remoteCopy || restoreCheck || restoreCheckAttempt
  );
  if (!remoteConfigured) {
    return { remoteConfigured, remote: emptyRemote() };
  }

  const copy = toAge(remoteCopy);
  const check = toAge(restoreCheck);
  const daysAgo =
    check === null
      ? null
      : Math.round(((Date.now() - check.ms) / 86_400_000) * 10) / 10;

  return {
    remoteConfigured,
    remote: {
      lastRemoteCopyAt: copy?.iso ?? null,
      remoteCopyHoursAgo: copy?.hours ?? null,
      remoteCopyStale: copy === null || copy.hours > 26,
      lastRestoreCheckAt: check?.iso ?? null,
      restoreCheckDaysAgo: daysAgo,
      // 7-day cadence + 1 day of grace before the UI complains.
      restoreCheckStale: check === null || (daysAgo !== null && daysAgo > 8),
    },
  };
}

interface Age {
  hours: number;
  iso: string;
  ms: number;
}

function toAge(raw: string | null): Age | null {
  if (!raw) {
    return null;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return {
    ms: d.getTime(),
    iso: d.toISOString(),
    hours: Math.round(((Date.now() - d.getTime()) / 3_600_000) * 10) / 10,
  };
}
