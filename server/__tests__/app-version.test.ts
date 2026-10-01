import { afterEach, describe, expect, it } from "vitest";
import {
  getAppVersionInfo,
  resetAppVersionCache,
} from "../services/app-version.service.js";
import { isNewerVersion, parseVersion } from "../utils/version.js";

function fakeReleaseFetch(tag: string, url = "https://example.com/r") {
  return (() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ tag_name: tag, html_url: url }),
    })) as unknown as typeof fetch;
}

describe("isNewerVersion", () => {
  it("detects a newer release tag", () => {
    expect(isNewerVersion("v1.3.0", "1.0.2")).toBe(true);
    expect(isNewerVersion("1.0.3", "1.0.2")).toBe(true);
  });

  it("is false for same or older versions", () => {
    expect(isNewerVersion("v1.0.2", "1.0.2")).toBe(false);
    expect(isNewerVersion("1.0.1", "1.0.2")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.2")).toBe(false);
  });

  it("ignores pre-release suffixes and rejects garbage", () => {
    expect(isNewerVersion("v1.1.0-beta.1", "1.0.2")).toBe(true);
    expect(isNewerVersion("not-a-version", "1.0.2")).toBe(false);
    expect(parseVersion("")).toBeNull();
  });
});

describe("getAppVersionInfo", () => {
  afterEach(() => {
    resetAppVersionCache();
  });

  it("reports an update when GitHub has a newer tag", async () => {
    const info = await getAppVersionInfo(fakeReleaseFetch("v99.0.0"));
    expect(info.updateAvailable).toBe(true);
    expect(info.latest).toBe("99.0.0");
    expect(info.releaseUrl).toBe("https://example.com/r");
    expect(info.checkedAt).not.toBeNull();
  });

  it("reports no update when the release is older or equal", async () => {
    const info = await getAppVersionInfo(fakeReleaseFetch("v0.0.1"));
    expect(info.updateAvailable).toBe(false);
    expect(info.latest).toBe("0.0.1");
  });

  it("stays silent when GitHub is unreachable (offline shop)", async () => {
    const offline = (() =>
      Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const info = await getAppVersionInfo(offline);
    expect(info.updateAvailable).toBe(false);
    expect(info.latest).toBeNull();
    expect(info.checkedAt).toBeNull();
  });

  it("stays silent on non-200 responses", async () => {
    const rateLimited = (() =>
      Promise.resolve({ ok: false, status: 403 })) as unknown as typeof fetch;
    const info = await getAppVersionInfo(rateLimited);
    expect(info.updateAvailable).toBe(false);
    expect(info.latest).toBeNull();
  });

  it("caches the result instead of refetching", async () => {
    let calls = 0;
    const counting = (() => {
      calls += 1;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ tag_name: "v9.9.9", html_url: "https://x" }),
      });
    }) as unknown as typeof fetch;

    await getAppVersionInfo(counting);
    await getAppVersionInfo(counting);
    expect(calls).toBe(1);
  });
});
