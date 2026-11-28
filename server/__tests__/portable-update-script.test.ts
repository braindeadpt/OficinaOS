import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync("scripts/portable/ATUALIZAR.bat", "utf8");
const FILE_HASH_RE = /Get-FileHash[\s\S]*SHA256/i;
const ROBOCOPY_MIR_RE = /robocopy[^\r\n]*\/MIR/i;

describe("ATUALIZAR.bat portátil — cadeia de confiança do update", () => {
  it("mantém CRLF (cmd.exe não executa scripts batch LF de forma fiável)", () => {
    expect(raw).toContain("\r\n");
    expect(raw.replace(/\r\n/g, "")).not.toContain("\n");
    expect(raw).not.toContain("\r\r\n");
    expect(Array.from(raw).every((char) => char.charCodeAt(0) < 128)).toBe(
      true
    );
  });

  it("descarrega e verifica o SHA256 publicado antes de extrair", () => {
    expect(raw).toContain("oficinaos-portable.zip.sha256");
    expect(raw).toMatch(FILE_HASH_RE);
    expect(raw.indexOf("oficinaos-portable.zip.sha256")).toBeLessThan(
      raw.indexOf("Expand-Archive")
    );
    expect(raw.indexOf("Get-FileHash")).toBeLessThan(
      raw.indexOf("Expand-Archive")
    );
  });

  it("limpa staging antigo antes de extrair e remove zip/checksum no fim", () => {
    const clean = raw.indexOf('rmdir /s /q "%STAGE%"');
    expect(clean).toBeGreaterThan(-1);
    expect(clean).toBeLessThan(raw.indexOf("Expand-Archive"));
    expect(raw).toContain('del "%ZIP%"');
    expect(raw).toContain('del "%SHA%"');
    expect(raw).toContain('del "%TEMP%\\oficinaos-env.bak"');
    expect(raw.indexOf(":fail")).toBeGreaterThan(raw.indexOf(":cleanup"));
  });

  it("não usa /MIR e documenta porquê — mirror podia apagar dados do utilizador", () => {
    expect(raw).not.toMatch(ROBOCOPY_MIR_RE);
    expect(raw.toLowerCase()).toContain("nao usar /mir");
  });
});
