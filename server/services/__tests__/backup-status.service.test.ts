import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: {
    readFile: mocks.readFile,
    readdir: mocks.readdir,
  },
}));

vi.mock("../../config/env.js", () => ({
  loadEnv: () => ({ UPLOAD_DIR: "/tmp/uploads-test" }),
}));

import { getBackupStatus } from "../backup-status.service.js";

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

describe("getBackupStatus", () => {
  beforeEach(() => {
    mocks.readFile.mockReset();
    mocks.readdir.mockReset();
  });

  it("reports a fresh heartbeat with the dump count", async () => {
    mocks.readFile.mockResolvedValue(`${isoHoursAgo(2)}\n`);
    mocks.readdir.mockResolvedValue([
      "oficinaos-20260929-030000.sql.gz",
      "oficinaos-20260928-030000.sql.gz",
      "unrelated.txt",
    ]);

    const status = await getBackupStatus();

    expect(status.lastBackupAt).not.toBeNull();
    expect(status.hoursAgo).toBeLessThanOrEqual(3);
    expect(status.stale).toBe(false);
    expect(status.dumpCount).toBe(2);
  });

  it("degrades to missing state without a heartbeat file", async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.readdir.mockRejectedValue(new Error("ENOENT"));

    const status = await getBackupStatus();

    expect(status.lastBackupAt).toBeNull();
    expect(status.hoursAgo).toBeNull();
    expect(status.stale).toBe(true);
    expect(status.dumpCount).toBe(0);
  });

  it("flags a stale heartbeat older than 26 hours", async () => {
    mocks.readFile.mockResolvedValue(isoHoursAgo(48));
    mocks.readdir.mockResolvedValue([]);

    const status = await getBackupStatus();

    expect(status.hoursAgo).toBeGreaterThan(26);
    expect(status.stale).toBe(true);
  });
});
