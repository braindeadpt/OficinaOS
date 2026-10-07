import { createHash } from "node:crypto";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPaths,
  detectInstallMode,
  isUpdateInProgress,
  readUpdateStatus,
  verifySha256,
} from "../services/update.service.js";

const scOk = () => "STATE : 4 RUNNING";
const scFail = (): never => {
  throw new Error("service not found");
};

let tmp: string | null = null;
const mkTmp = () => {
  tmp = mkdtempSync(path.join(tmpdir(), "upd-test-"));
  return tmp;
};

afterEach(async () => {
  if (tmp) {
    await rm(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

describe("detectInstallMode", () => {
  it("returns docker when /.dockerenv exists", () => {
    const dir = mkTmp();
    const marker = path.join(dir, ".dockerenv");
    writeFileSync(marker, "");
    expect(detectInstallMode("linux", marker, scOk)).toBe("docker");
    expect(detectInstallMode("win32", marker, scOk)).toBe("docker");
  });

  it("returns other on non-windows without docker", () => {
    expect(detectInstallMode("linux", "/nonexistent-marker", scOk)).toBe(
      "other"
    );
  });

  it("returns service when the OficinaOS windows service exists", () => {
    expect(detectInstallMode("win32", "/nonexistent-marker", scOk)).toBe(
      "service"
    );
  });

  it("returns portable on windows without service", () => {
    expect(detectInstallMode("win32", "/nonexistent-marker", scFail)).toBe(
      "portable"
    );
  });
});

describe("buildPaths", () => {
  it("service mode keeps state under ProgramData and tools backup", () => {
    const p = buildPaths(
      "service",
      "C:\\Program Files\\OficinaOS\\app",
      "C:\\ProgramData"
    );
    expect(p.installRoot).toBe("C:\\Program Files\\OficinaOS");
    expect(p.stagingDir).toBe(
      path.win32.join("C:\\ProgramData", "OficinaOS", "update")
    );
    expect(p.backupScript).toBe(
      path.win32.join("C:\\Program Files\\OficinaOS", "tools", "backup.ps1")
    );
  });

  it("portable mode keeps state under <root>/data and root backup", () => {
    const p = buildPaths("portable", "C:\\oficinaos\\app", "");
    expect(p.installRoot).toBe("C:\\oficinaos");
    expect(p.stagingDir).toBe(
      path.win32.join("C:\\oficinaos", "data", "update")
    );
    expect(p.backupScript).toBe(path.win32.join("C:\\oficinaos", "BACKUP.ps1"));
  });
});

describe("readUpdateStatus", () => {
  it("returns idle when the status file does not exist", () => {
    const dir = mkTmp();
    expect(readUpdateStatus(path.join(dir, "nope.json")).state).toBe("idle");
  });

  it("parses a written status", () => {
    const dir = mkTmp();
    const f = path.join(dir, "status.json");
    writeFileSync(
      f,
      JSON.stringify({ state: "done", detail: "", updatedAt: "x" })
    );
    expect(readUpdateStatus(f).state).toBe("done");
  });

  it("marks stale in-progress status as failed", () => {
    const dir = mkTmp();
    const f = path.join(dir, "status.json");
    writeFileSync(
      f,
      JSON.stringify({ state: "applying", detail: "", updatedAt: "x" })
    );
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(f, old, old);
    expect(readUpdateStatus(f).state).toBe("failed");
  });

  it("keeps fresh in-progress status", () => {
    const dir = mkTmp();
    const f = path.join(dir, "status.json");
    writeFileSync(
      f,
      JSON.stringify({ state: "applying", detail: "", updatedAt: "x" })
    );
    expect(readUpdateStatus(f).state).toBe("applying");
  });
});

describe("isUpdateInProgress", () => {
  it("flags running phases", () => {
    for (const state of [
      "downloading",
      "backing_up",
      "applying",
      "restarting",
    ]) {
      expect(
        isUpdateInProgress({ state, detail: "", updatedAt: "" } as never)
      ).toBe(true);
    }
  });
  it("flags terminal phases as not running", () => {
    for (const state of ["idle", "done", "failed", "rolled_back"]) {
      expect(
        isUpdateInProgress({ state, detail: "", updatedAt: "" } as never)
      ).toBe(false);
    }
  });
});

describe("verifySha256", () => {
  it("accepts a matching digest", () => {
    const dir = mkTmp();
    const f = path.join(dir, "file.bin");
    writeFileSync(f, "conteudo");
    const hex = createHash("sha256").update("conteudo").digest("hex");
    expect(verifySha256(f, hex.toUpperCase())).toBe(true);
  });

  it("rejects a mismatched digest", () => {
    const dir = mkTmp();
    const f = path.join(dir, "file.bin");
    writeFileSync(f, "conteudo");
    expect(verifySha256(f, "0".repeat(64))).toBe(false);
  });
});
