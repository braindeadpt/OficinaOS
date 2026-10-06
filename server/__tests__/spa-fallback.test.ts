import { describe, expect, it } from "vitest";
import { isFileRequestPath } from "../lib/spa-fallback.js";
import { originMatchesRequestHost } from "../plugins/security.js";

describe("isFileRequestPath", () => {
  it("flags sensitive dotfiles and dot-directories", () => {
    expect(isFileRequestPath("/.env")).toBe(true);
    expect(isFileRequestPath("/.git/config")).toBe(true);
    expect(isFileRequestPath("/.well-known/security.txt")).toBe(true);
  });

  it("flags paths with a file extension", () => {
    expect(isFileRequestPath("/robots.txt")).toBe(true);
    expect(isFileRequestPath("/package.json")).toBe(true);
    expect(isFileRequestPath("/favicon.ico")).toBe(true);
    expect(isFileRequestPath("/assets/missing.js")).toBe(true);
  });

  it("passes SPA routes through to index.html", () => {
    expect(isFileRequestPath("/")).toBe(false);
    expect(isFileRequestPath("/login")).toBe(false);
    expect(isFileRequestPath("/jobs")).toBe(false);
    expect(
      isFileRequestPath("/jobs/0192a4bc-d0e1-7f8a-9b2c-3d4e5f6a7b8c")
    ).toBe(false);
    expect(isFileRequestPath("/track/some-token")).toBe(false);
  });
});

describe("originMatchesRequestHost", () => {
  it("matches when the request arrived on that origin's host", () => {
    expect(
      originMatchesRequestHost("http://192.168.1.33:4000", "192.168.1.33:4000")
    ).toBe(true);
    expect(
      originMatchesRequestHost("ws://192.168.1.33:4000", "192.168.1.33:4000")
    ).toBe(true);
    expect(
      originMatchesRequestHost("https://app.oficinaos.app", "app.oficinaos.app")
    ).toBe(true);
  });

  it("rejects origins from a different host so they are not leaked", () => {
    expect(
      originMatchesRequestHost("http://192.168.1.33:4000", "app.oficinaos.app")
    ).toBe(false);
    expect(
      originMatchesRequestHost("https://app.oficinaos.app", "192.168.1.33:4000")
    ).toBe(false);
    expect(
      originMatchesRequestHost("http://192.168.1.33:4000", "192.168.1.34:4000")
    ).toBe(false);
  });

  it("rejects missing host headers and invalid origins", () => {
    expect(
      originMatchesRequestHost("http://192.168.1.33:4000", undefined)
    ).toBe(false);
    expect(originMatchesRequestHost("not-a-url", "example.com")).toBe(false);
  });
});
