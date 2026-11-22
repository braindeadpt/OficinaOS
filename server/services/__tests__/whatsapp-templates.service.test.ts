import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(),
  decryptSecret: vi.fn((v: string) => (v.startsWith("enc:") ? v.slice(4) : v)),
  decryptWhatsAppConfig: vi.fn(
    (input: { apiTokenEncrypted?: string; businessId?: string }) =>
      input.apiTokenEncrypted && input.businessId
        ? { businessId: input.businessId, token: input.apiTokenEncrypted }
        : null
  ),
  getOrCreateShopSettings: vi.fn(),
}));

vi.mock("../../lib/crypto.js", () => ({
  decryptSecret: mocks.decryptSecret,
  isEncrypted: (v: string) => v.startsWith("enc:"),
}));

vi.mock("../notification-sender.js", () => ({
  decryptWhatsAppConfig: mocks.decryptWhatsAppConfig,
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));

vi.mock("../cloud.service.js", () => ({
  cloudFetch: mocks.cloudFetch,
}));

import {
  deriveMetaTemplate,
  orderedTemplateParams,
  syncWhatsAppTemplates,
} from "../whatsapp-templates.service.js";

const updateSettings = vi.fn(async () => ({}));
const notificationTemplate = {
  findMany: vi.fn(async (): Promise<{ body: string; name: string }[]> => []),
};
const prisma = {
  notificationTemplate,
  shopSettings: { update: updateSettings },
} as never;

const graphOk = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("deriveMetaTemplate", () => {
  it("converte {{var}} em {{n}} posicionais e preserva a ordem de aparecimento", () => {
    const spec = deriveMetaTemplate(
      "job_ready",
      "Olá {{customerName}}, a reparação {{jobCode}} na {{shopName}} está pronta. Ref {{jobCode}}."
    );
    expect(spec.vars).toEqual(["customerName", "jobCode", "shopName"]);
    expect(spec.body).toBe(
      "Olá {{1}}, a reparação {{2}} na {{3}} está pronta. Ref {{2}}."
    );
  });
});

describe("orderedTemplateParams", () => {
  it("devolve valores na ordem dos placeholders do corpo", () => {
    const params = orderedTemplateParams(
      "Olá {{customerName}}, REP {{jobCode}}.",
      { customerName: "Ana", jobCode: "R-42", shopName: "Loja" }
    );
    expect(params).toEqual(["Ana", "R-42"]);
  });

  it("remove a marcação {{if}}/{{/if}} antes de contar os placeholders", () => {
    const params = orderedTemplateParams(
      "Olá {{customerName}}.{{if eta}} Chega {{eta}}.{{/if}}",
      { customerName: "Ana", eta: "amanhã" }
    );
    expect(params).toEqual(["Ana", "amanhã"]);
  });
});

describe("syncWhatsAppTemplates", () => {
  const localSettings = {
    whatsappApiTokenEncrypted: "enc:meta-token",
    whatsappBusinessId: "waba-1",
    whatsappEnabled: true,
    whatsappTransport: "meta",
  };

  function seedTemplates() {
    notificationTemplate.findMany.mockResolvedValue([
      { body: "Olá {{customerName}}, REP {{jobCode}}.", name: "job_ready" },
      { body: "Olá {{customerName}}.", name: "job_done" },
    ]);
  }

  it("modo local: GET primeiro, cria só os em falta, persiste estados", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(localSettings);
    seedTemplates();
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: { method?: string }) => {
        const u = String(url);
        calls.push({ method: init?.method ?? "GET", url: u });
        if (init?.method === "POST") {
          return Promise.resolve(graphOk({ id: "tpl2" }));
        }
        if (u.includes("name=job_ready")) {
          return Promise.resolve(
            graphOk({ data: [{ name: "job_ready", status: "APPROVED" }] })
          );
        }
        return Promise.resolve(graphOk({ data: [] }));
      })
    );

    const res = await syncWhatsAppTemplates(prisma);
    expect(res.total).toBe(2);
    expect(res.templates.map((t) => t.status)).toEqual([
      "APPROVED",
      // Criado agora — o re-GET devolve lista vazia até a Meta indexar,
      // e o status marca MISSING para a UI mostrar "Não enviado".
      "MISSING",
    ]);
    // 1 POST (só o job_done em falta)
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    const created = calls.find((c) => c.method === "POST");
    expect(created?.url).toContain("waba-1/message_templates");
    // Estado persistido em whatsappTemplatesJson
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappTemplatesJson: expect.objectContaining({
            job_ready: expect.objectContaining({ status: "APPROVED" }),
          }),
        }),
      })
    );
  });

  it("modo cloud: delega na Cloud e não chama a Graph API", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...localSettings,
      cloudApiUrl: "https://cloud.example",
      cloudShopTokenEncrypted: "enc:shop-token",
      whatsappCredentialsAtCloud: true,
    });
    seedTemplates();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mocks.cloudFetch.mockResolvedValue({
      body: {
        templates: [
          { name: "job_ready", status: "APPROVED" },
          { name: "job_done", status: "REJECTED", reason: "promo" },
        ],
      },
      ok: true,
      status: 200,
    });

    const res = await syncWhatsAppTemplates(prisma);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud.example",
      "/whatsapp/templates/sync",
      expect.objectContaining({ method: "POST", token: "shop-token" })
    );
    expect(res.ready).toBe(1);
    expect(res.templates[1]?.status).toBe("REJECTED");
  });

  it("sem templates WHATSAPP não fala a lado nenhum", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(localSettings);
    notificationTemplate.findMany.mockResolvedValue([]);
    const res = await syncWhatsAppTemplates(prisma);
    expect(res).toEqual({ ready: 0, templates: [], total: 0 });
  });
});
