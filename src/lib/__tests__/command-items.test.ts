import { describe, expect, it, vi } from "vitest";

// buildCommands filters through the same permission check the sidebar uses.
// Replace it here so the catalogue can be exercised without a live auth client.
vi.mock("@/hooks/use-can", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/use-can")>("@/hooks/use-can");
  return { ...actual, can: () => true };
});

import {
  buildCommands,
  filterCommands,
  scoreCommand,
} from "@/lib/command-items";

const PT: Record<string, string> = {
  ai_agent_title: "Assistente IA",
  customers: "Clientes",
  inventory_2: "",
  jobs: "Reparações",
  new_checkin: "Novo check-in",
  notifications: "Notificações",
  parts_inventory: "Inventário de peças",
  pos: "Ponto de venda",
  repair_services: "Serviços de reparação",
  reports: "Relatórios",
  returns_nav_label: "Devoluções",
  settings: "Definições",
  auth_sign_out_instead: "Sair",
  profile_title: "Perfil",
  dashboard: "Painel",
};

const t = (key: string) => PT[key] ?? key;

function deps() {
  return {
    logout: vi.fn(),
    navigate: vi.fn(),
    openIntakeModal: vi.fn(),
    role: "OWNER",
    signOut: vi.fn(),
  };
}

describe("buildCommands", () => {
  it("offers every navigation destination as a page", () => {
    const commands = buildCommands(deps());
    const paths = commands.filter((c) => c.kind === "page").map((c) => c.to);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/jobs",
        "/returns",
        "/customers",
        "/parts",
        "/pos",
        "/repairs",
        "/notifications",
        "/reports",
        "/ai-analyst",
        "/settings",
      ])
    );
  });

  it("offers the actions that are not navigation", () => {
    const labels = buildCommands(deps())
      .filter((c) => c.kind === "action")
      .map((c) => c.labelKey);
    expect(labels).toEqual(
      expect.arrayContaining([
        "new_checkin",
        "profile_title",
        "settings",
        "auth_sign_out_instead",
      ])
    );
  });

  it("keeps the sign out available whatever the role", () => {
    const commands = buildCommands({ ...deps(), role: "TECHNICIAN" });
    expect(commands.some((c) => c.labelKey === "auth_sign_out_instead")).toBe(
      true
    );
  });

  it("runs the injected callbacks rather than importing them", () => {
    const d = deps();
    const commands = buildCommands(d);

    commands.find((c) => c.labelKey === "new_checkin")?.run();
    expect(d.openIntakeModal).toHaveBeenCalled();

    commands.find((c) => c.to === "/pos")?.run();
    expect(d.navigate).toHaveBeenCalledWith("/pos");
  });
});

describe("filterCommands", () => {
  it("returns everything for an empty query, actions first", () => {
    const all = buildCommands(deps());
    const found = filterCommands(all, "", t);
    expect(found).toHaveLength(all.length);
    expect(found[0].kind).toBe("action");
  });

  it("matches regardless of case and accents", () => {
    const all = buildCommands(deps());
    expect(filterCommands(all, "DEVOLUCOES", t).map((c) => c.to)).toContain(
      "/returns"
    );
    expect(filterCommands(all, "devoluções", t).map((c) => c.to)).toContain(
      "/returns"
    );
  });

  it("finds a page through a keyword that is not in its label", () => {
    const all = buildCommands(deps());
    expect(filterCommands(all, "fatura", t).map((c) => c.to)).toContain("/pos");
    expect(filterCommands(all, "faturas", t).map((c) => c.to)).toContain(
      "/pos"
    );
  });

  it("requires every term to match, so extra words do not widen the net", () => {
    const all = buildCommands(deps());
    expect(filterCommands(all, "zzzz clientes", t)).toHaveLength(0);
    expect(filterCommands(all, "clientes zzzz", t)).toHaveLength(0);
  });

  it("prefers a word-start match over a mid-word one", () => {
    // "rep" is a word start in "Reparações" and mid-word in "reparação".
    expect(scoreCommand("rep", "Reparações", [])).toBeGreaterThan(
      scoreCommand("rep", "Serviços de reparação", [])
    );
    expect(scoreCommand("clien", "Clientes", [])).toBeGreaterThan(
      scoreCommand("clien", "Configuração de clientes", [])
    );
  });

  it("ranks the visible label above an equally good keyword", () => {
    const withKeyword = scoreCommand("pneu", "Oficina", ["pneu"]);
    const inLabel = scoreCommand("pneu", "Pneus da oficina", []);
    expect(inLabel).toBeGreaterThan(withKeyword);
  });

  it("returns nothing for a term that matches nothing", () => {
    const all = buildCommands(deps());
    expect(filterCommands(all, "zzzz", t)).toHaveLength(0);
  });
});
