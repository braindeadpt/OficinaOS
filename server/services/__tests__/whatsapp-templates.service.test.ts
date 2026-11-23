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
const shopSettingsFindUnique = vi.fn(async (): Promise<unknown> => null);
const notificationTemplate = {
  findMany: vi.fn(async (): Promise<{ body: string; name: string }[]> => []),
};
const notificationOutbox = {
  findMany: vi.fn(async (): Promise<{ templateName: string }[]> => []),
};
const prisma = {
  notificationOutbox,
  notificationTemplate,
  shopSettings: { findUnique: shopSettingsFindUnique, update: updateSettings },
} as never;

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
  const cloudSettings = {
    ...localSettings,
    cloudApiUrl: "https://cloud.example",
    cloudShopTokenEncrypted: "enc:shop-token",
    whatsappCredentialsAtCloud: true,
  };

  function seedTemplates() {
    notificationTemplate.findMany.mockResolvedValue([
      { body: "Olá {{customerName}}, REP {{jobCode}}.", name: "job_ready" },
      { body: "Olá {{customerName}}.", name: "job_done" },
    ]);
  }

  it("modo local: zero chamadas à Graph API — grátis = só envio", async () => {
    // A app não gere templates na Meta em modo grátis/local: nada de
    // graphList/graphCreate/graphEdit — envia pelo nome e a Meta
    // rejeita o que faltar como erro normal de envio.
    mocks.getOrCreateShopSettings.mockResolvedValue(localSettings);
    seedTemplates();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await syncWhatsAppTemplates(prisma);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    expect(res).toEqual({ ready: 0, templates: [], total: 2 });
    // Também não persiste estado — não há sync local a persistir.
    expect(updateSettings).not.toHaveBeenCalled();
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

  it("cloud: mantém o estado de nomes com mensagens em fila após rename", async () => {
    // Regressão Devin r8: renomear job_done→job_ready não apaga o modelo
    // antigo na Meta — entradas em fila para job_done ficavam "unsynced"
    // até expirar. O sync preserva o estado de nomes referenciados.
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
    notificationTemplate.findMany.mockResolvedValue([
      { body: "Olá {{customerName}}, REP {{jobCode}}.", name: "job_ready" },
    ]);
    notificationOutbox.findMany.mockResolvedValue([
      { templateName: "job_done" },
    ]);
    shopSettingsFindUnique.mockResolvedValue({
      whatsappTemplatesJson: {
        job_done: { status: "APPROVED", syncedAt: "2026-11-01T00:00:00Z" },
      },
    });
    mocks.cloudFetch.mockResolvedValue({
      body: { templates: [{ name: "job_ready", status: "APPROVED" }] },
      ok: true,
      status: 200,
    });

    await syncWhatsAppTemplates(prisma);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappTemplatesJson: expect.objectContaining({
            job_done: expect.objectContaining({ status: "APPROVED" }),
            job_ready: expect.objectContaining({ status: "APPROVED" }),
          }),
        }),
      })
    );
  });

  it("cloud: nome renomeado fora da resposta preserva o estado anterior", async () => {
    // Um rename não devolvido pela Cloud não entra no resultado —
    // persistStatuses preserva o APPROVED anterior em vez de gravar
    // MISSING e adiar a fila 30min.
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
    notificationTemplate.findMany.mockResolvedValue([
      { body: "Olá {{customerName}}, REP {{jobCode}}.", name: "job_ready" },
    ]);
    notificationOutbox.findMany.mockResolvedValue([
      { templateName: "job_done" },
    ]);
    shopSettingsFindUnique.mockResolvedValue({
      whatsappTemplatesJson: {
        job_done: { status: "APPROVED", syncedAt: "2026-11-01T00:00:00Z" },
      },
    });
    mocks.cloudFetch.mockResolvedValue({
      body: { templates: [{ name: "job_ready", status: "APPROVED" }] },
      ok: true,
      status: 200,
    });

    const res = await syncWhatsAppTemplates(prisma);
    expect(res.templates.map((t) => t.name)).toEqual(["job_ready"]);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappTemplatesJson: expect.objectContaining({
            job_done: expect.objectContaining({ status: "APPROVED" }),
          }),
        }),
      })
    );
  });

  it("cloud: ready conta só os modelos atuais — nomes de fila ficam de fora", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
    notificationTemplate.findMany.mockResolvedValue([
      { body: "Olá {{customerName}}, REP {{jobCode}}.", name: "job_ready" },
    ]);
    notificationOutbox.findMany.mockResolvedValue([
      { templateName: "job_done" },
    ]);
    shopSettingsFindUnique.mockResolvedValue(null);
    mocks.cloudFetch.mockResolvedValue({
      body: {
        templates: [
          { name: "job_ready", status: "APPROVED" },
          // A Cloud pode devolver nomes extra (ex.: modelo antigo ainda
          // aprovado) — não entram no resultado nem no ready.
          { name: "job_done", status: "APPROVED" },
        ],
      },
      ok: true,
      status: 200,
    });

    const res = await syncWhatsAppTemplates(prisma);
    // job_done aprovado na Meta serve a fila, mas o aviso de sync
    // mede os modelos atuais — sem ele ficava «2 de 1 aprovados».
    expect(res.ready).toBe(1);
    expect(res.total).toBe(1);
  });

  it("sem templates WHATSAPP não fala a lado nenhum", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(localSettings);
    notificationTemplate.findMany.mockResolvedValue([]);
    const res = await syncWhatsAppTemplates(prisma);
    expect(res).toEqual({ ready: 0, templates: [], total: 0 });
  });
});
