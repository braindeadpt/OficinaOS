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
 * Reads the backup sidecar status. In Docker mode the db-backup
 * container's heartbeat and dump volumes are mounted on the app outside
 * UPLOAD_DIR (BACKUP_HEARTBEAT_DIR / BACKUP_DIR, see docker-compose*.yml);
 * the Windows scripts write UPLOAD_DIR/backups-status and
 * UPLOAD_DIR/backups, which uploads-static never serves. Missing files
 * degrade gracefully to nulls so the UI can show "backups not
 * configured" instead of erroring.
 */
export async function getBackupStatus(): Promise<BackupStatus> {
  const env = loadEnv();
  const uploadDir = path.resolve(env.UPLOAD_DIR);
  const heartbeatDir = path.resolve(
    env.BACKUP_HEARTBEAT_DIR ?? path.join(uploadDir, "backups-status")
  );
  const dumpDir = path.resolve(
    env.BACKUP_DIR ?? path.join(uploadDir, "backups")
  );
  const heartbeatFile = path.join(heartbeatDir, "last-backup.txt");
  const remoteCopyFile = path.join(heartbeatDir, "last-remote-copy.txt");
  const restoreCheckFile = path.join(heartbeatDir, "last-restore-check.txt");
  const restoreCheckAttemptFile = path.join(
    heartbeatDir,
    "last-restore-check-attempt.txt"
  );
  const encryptedCopyFile = path.join(heartbeatDir, "last-encrypted-copy.txt");

  const readText = (file: string) =>
    fs.readFile(file, "utf8").then(
      (v) => v.trim(),
      () => null
    );

  const [
    heartbeat,
    backupFiles,
    remoteCopy,
    restoreCheck,
    restoreCheckAttempt,
    encryptedCopy,
  ] = await Promise.all([
    readText(heartbeatFile),
    fs.readdir(dumpDir).then(
      (files) =>
        files.filter(
          (f) =>
            f.startsWith("oficinaos-") &&
            (f.endsWith(".sql.gz") || f.endsWith(".dump.age"))
        ),
      () => [] as string[]
    ),
    readText(remoteCopyFile),
    readText(restoreCheckFile),
    readText(restoreCheckAttemptFile),
    readText(encryptedCopyFile),
  ]);

  if (!heartbeat) {
    return {
      lastBackupAt: null,
      hoursAgo: null,
      stale: true,
      dumpCount: backupFiles.length,
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
    dumpCount: backupFiles.length,
    ...remoteStatus(
      remoteCopy,
      restoreCheck,
      restoreCheckAttempt,
      encryptedCopy !== null
    ),
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
  restoreCheckAttempt: string | null,
  encryptedBackups = false
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
      // Legado semanal: 7+1 dias. Ponto cifrado: verificação mensal + 1 dia
      // de graça. O formato presente no volume é o sinal disponível na app.
      restoreCheckStale:
        check === null ||
        (daysAgo !== null && daysAgo > (encryptedBackups ? 32 : 8)),
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
