import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  env: { UPLOAD_DIR: "/tmp/uploads-test" } as Record<string, string>,
}));

vi.mock("node:fs", () => ({
  promises: {
    readFile: mocks.readFile,
    readdir: mocks.readdir,
  },
}));

vi.mock("../../config/env.js", () => ({
  loadEnv: () => mocks.env,
}));

import { getBackupStatus } from "../backup-status.service.js";

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const files = (over: Record<string, string | null> = {}) => {
  const base: Record<string, string | null> = {
    "last-backup.txt": isoHoursAgo(2),
    "last-remote-copy.txt": null,
    "last-restore-check.txt": null,
    "last-restore-check-attempt.txt": null,
  };
  return { ...base, ...over };
};

const PATH_SEP = /[\\/]/;

function mockFs(state: Record<string, string | null>, dumps: string[] = []) {
  mocks.readFile.mockImplementation((p: string) => {
    const name = String(p).split(PATH_SEP).pop() ?? "";
    const v = state[name] ?? null;
    return v === null
      ? Promise.reject(new Error("ENOENT"))
      : Promise.resolve(v);
  });
  mocks.readdir.mockResolvedValue(dumps);
}

describe("getBackupStatus", () => {
  beforeEach(() => {
    mocks.readFile.mockReset();
    mocks.readdir.mockReset();
    mocks.env = { UPLOAD_DIR: "/tmp/uploads-test" };
  });

  it("reads BACKUP_DIR / BACKUP_HEARTBEAT_DIR when set (Docker, outside UPLOAD_DIR)", async () => {
    mocks.env = {
      UPLOAD_DIR: "/tmp/uploads-test",
      BACKUP_DIR: "/tmp/backups-test",
      BACKUP_HEARTBEAT_DIR: "/tmp/backups-status-test",
    };
    mockFs(files(), ["oficinaos-20260929-030000.sql.gz"]);

    await getBackupStatus();

    expect(mocks.readdir).toHaveBeenCalledWith(
      path.resolve("/tmp/backups-test")
    );
    expect(mocks.readFile).toHaveBeenCalledWith(
      path.join(path.resolve("/tmp/backups-status-test"), "last-backup.txt"),
      "utf8"
    );
  });

  it("falls back to UPLOAD_DIR/backups* when unset (Windows layouts)", async () => {
    mockFs(files());

    await getBackupStatus();

    expect(mocks.readdir).toHaveBeenCalledWith(
      path.join(path.resolve("/tmp/uploads-test"), "backups")
    );
    expect(mocks.readFile).toHaveBeenCalledWith(
      path.join(
        path.resolve("/tmp/uploads-test"),
        "backups-status",
        "last-backup.txt"
      ),
      "utf8"
    );
  });

  it("reports a fresh heartbeat with the dump count", async () => {
    mockFs(files(), [
      "oficinaos-20260929-030000.sql.gz",
      "oficinaos-20260928-030000.sql.gz",
      "oficinaos-20260929-040000-1.dump.age",
      "unrelated.txt",
    ]);

    const status = await getBackupStatus();

    expect(status.lastBackupAt).not.toBeNull();
    expect(status.hoursAgo).toBeLessThanOrEqual(3);
    expect(status.stale).toBe(false);
    expect(status.dumpCount).toBe(3);
  });

  it("degrades to missing state without a heartbeat file", async () => {
    mockFs({});

    const status = await getBackupStatus();

    expect(status.lastBackupAt).toBeNull();
    expect(status.hoursAgo).toBeNull();
    expect(status.stale).toBe(true);
    expect(status.dumpCount).toBe(0);
    expect(status.remoteConfigured).toBe(false);
  });

  it("flags a stale heartbeat older than 26 hours", async () => {
    mockFs(files({ "last-backup.txt": isoHoursAgo(48) }));

    const status = await getBackupStatus();

    expect(status.hoursAgo).toBeGreaterThan(26);
    expect(status.stale).toBe(true);
  });

  it("reports remote copy and restore check when configured", async () => {
    mockFs(
      files({
        "last-remote-copy.txt": isoHoursAgo(3),
        "last-restore-check.txt": isoHoursAgo(48),
        "last-restore-check-attempt.txt": isoHoursAgo(48),
      }),
      ["oficinaos-20260929-030000.sql.gz"]
    );

    const status = await getBackupStatus();

    expect(status.remoteConfigured).toBe(true);
    expect(status.remote.remoteCopyStale).toBe(false);
    expect(status.remote.remoteCopyHoursAgo).toBeLessThanOrEqual(4);
    expect(status.remote.restoreCheckStale).toBe(false);
    expect(status.remote.restoreCheckDaysAgo).toBe(2);
  });

  it("flags remote copy stale after 26h and restore check stale after 8 days", async () => {
    mockFs(
      files({
        "last-remote-copy.txt": isoHoursAgo(30),
        "last-restore-check.txt": isoHoursAgo(24 * 10),
        "last-restore-check-attempt.txt": isoHoursAgo(24 * 10),
      }),
      ["oficinaos-20260929-030000.sql.gz"]
    );

    const status = await getBackupStatus();

    expect(status.remote.remoteCopyStale).toBe(true);
    expect(status.remote.restoreCheckStale).toBe(true);
  });

  it("uses the monthly window after a successful encrypted upload", async () => {
    mockFs(
      files({
        "last-remote-copy.txt": isoHoursAgo(3),
        "last-encrypted-copy.txt": isoHoursAgo(3),
        "last-restore-check.txt": isoHoursAgo(24 * 10),
      }),
      ["oficinaos-20260929-030000.dump.age"]
    );

    const status = await getBackupStatus();

    expect(status.remote.restoreCheckStale).toBe(false);
  });

  it("keeps the weekly window when an encrypted dump never left the server", async () => {
    mockFs(
      files({
        "last-remote-copy.txt": isoHoursAgo(3),
        "last-restore-check.txt": isoHoursAgo(24 * 10),
      }),
      ["oficinaos-20260929-030000.dump.age"]
    );

    const status = await getBackupStatus();

    expect(status.remote.restoreCheckStale).toBe(true);
  });

  it("treats a failed check (attempt without success) as never verified", async () => {
    mockFs(
      files({
        "last-remote-copy.txt": isoHoursAgo(3),
        "last-restore-check-attempt.txt": isoHoursAgo(24 * 10),
      }),
      ["oficinaos-20260929-030000.sql.gz"]
    );

    const status = await getBackupStatus();

    expect(status.remoteConfigured).toBe(true);
    expect(status.remote.lastRestoreCheckAt).toBeNull();
    expect(status.remote.restoreCheckStale).toBe(true);
  });
});
