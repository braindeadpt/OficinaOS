import { describe, expect, it } from "vitest";
import { pontoConfigMissingText } from "../transport";

describe("pontoConfigMissingText", () => {
  it("mantém loja numa oficina", () => {
    expect(pontoConfigMissingText("repair_shop")).toContain("A loja");
  });

  it("usa empresa no modo só ponto", () => {
    expect(pontoConfigMissingText("ponto_only")).toContain("A empresa");
    expect(pontoConfigMissingText("ponto_only")).not.toContain("A loja");
  });
});
