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
  approvedTemplateBodyOf,
  deriveMetaTemplate,
  isMetaBodySubmittable,
  metaSafeConditionals,
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

describe("metaSafeConditionals", () => {
  it("fecha blocos terminais com '.' após a variável", () => {
    expect(
      metaSafeConditionals(
        "Olá {{a}}.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}: {{trackingUrl}}{{endif}}"
      )
    ).toBe(
      "Olá {{a}}.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}: {{trackingUrl}}.{{endif}}"
    );
  });

  it("não toca em blocos seguidos de texto literal", () => {
    const body = "{{if jobCode}} rep {{jobCode}}{{endif}}: link {{u}}";
    expect(metaSafeConditionals(body)).toBe(body);
  });

  it("não pontua uma variável quando texto literal segue blocos {{if}} seguintes", () => {
    // Regressão Devin: o lookahead antigo só via o próximo {{if}} e
    // inseria "." mesmo com texto literal depois do bloco seguinte —
    // dentro de um URL de seguimento isso corrompia o link
    // (`?phone4=1234.&utm_medium=…`).
    const body =
      "Consulte: {{if trackingUrl}}{{trackingUrl}}{{endif}}{{if shopName}}&utm_medium=mensagem{{endif}}&utm_source=oficina";
    expect(metaSafeConditionals(body)).toBe(body);
  });

  it("pontua quando o sufixo é só blocos {{if}} completos até ao fim", () => {
    expect(
      metaSafeConditionals(
        "{{if trackingUrl}}{{trackingUrl}}{{endif}}{{if shopName}} — {{shopName}}{{endif}}"
      )
    ).toBe(
      "{{if trackingUrl}}{{trackingUrl}}.{{endif}}{{if shopName}} — {{shopName}}.{{endif}}"
    );
  });
});

describe("isMetaBodySubmittable", () => {
  it("rejeita corpos a começar/acabar num parâmetro posicional", () => {
    expect(isMetaBodySubmittable("Olá {{1}}, fim {{2}}.")).toBe(true);
    expect(isMetaBodySubmittable("Olá {{1}} — {{2}}")).toBe(false);
    expect(isMetaBodySubmittable("{{1}} texto")).toBe(false);
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
    // Decisão 2026-11-23: o relay Cloud exige o módulo "whatsapp-bot"
    // com cache fresco — sem ele resolveWhatsAppChannel devolve null.
    cloudEntitlements: ["whatsapp-bot"],
    cloudSyncedAt: new Date(),
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
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
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

  it("cloud: edição local inválida não derruba aprovação remota nem congela corpo não submetido", async () => {
    // Regressão Devin r9: um corpo inválido (a acabar em variável) era
    // persistido como REJECTED — apagava a aprovação remota que ainda
    // existe na Meta e congelava o corpo inválido como "versão remota",
    // trocando a ordem dos parâmetros após a correção ser aprovada.
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
    notificationTemplate.findMany.mockResolvedValue([
      { body: "Olá {{customerName}}", name: "job_done" }, // inválido, já aprovado remotamente
      { body: "Fim {{customerName}}", name: "new_tpl" }, // inválido, nunca submetido
    ]);
    shopSettingsFindUnique.mockResolvedValue({
      whatsappTemplatesJson: {
        job_done: {
          body: "Olá {{customerName}}, a REP {{jobCode}}.",
          status: "APPROVED",
          syncedAt: "2026-11-01T00:00:00Z",
        },
      },
    });
    mocks.cloudFetch.mockResolvedValue({
      body: { templates: [] },
      ok: true,
      status: 200,
    });

    const res = await syncWhatsAppTemplates(prisma);
    // O diagnóstico ao autor mantém-se REJECTED — o persistido não.
    expect(
      res.templates.every(
        (t) => t.status === "REJECTED" && t.reason === "INVALID_BODY_EDGES"
      )
    ).toBe(true);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappTemplatesJson: expect.objectContaining({
            job_done: expect.objectContaining({
              body: "Olá {{customerName}}, a REP {{jobCode}}.",
              reason: "INVALID_BODY_EDGES",
              status: "APPROVED",
            }),
            new_tpl: expect.objectContaining({
              body: null,
              status: "REJECTED",
            }),
          }),
        }),
      })
    );
  });

  it("cloud: edição inválida durante IN_REVIEW preserva o corpo submetido até à aprovação", async () => {
    // Regressão Devin r10: um corpo inválido persistido durante
    // IN_REVIEW apagava o corpo remoto; quando a Meta aprovava o
    // ORIGINAL, a aprovação herdava o corpo local novo (ordem de
    // variáveis invertida) e a fila enviava valores trocados.
    const remoteBody = "Olá {{customerName}}, a REP {{jobCode}}.";
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
    // 1.º sync: edição local inválida (acaba em variável, ordem trocada)
    // sobre um nome com submissão ainda IN_REVIEW.
    notificationTemplate.findMany.mockResolvedValue([
      { body: "{{jobCode}} pronta, {{customerName}}", name: "job_done" },
    ]);
    shopSettingsFindUnique.mockResolvedValue({
      whatsappTemplatesJson: {
        job_done: {
          body: remoteBody,
          status: "IN_REVIEW",
          syncedAt: "2026-11-01T00:00:00Z",
        },
      },
    });
    mocks.cloudFetch.mockResolvedValue({
      body: { templates: [] },
      ok: true,
      status: 200,
    });

    await syncWhatsAppTemplates(prisma);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappTemplatesJson: expect.objectContaining({
            job_done: expect.objectContaining({
              body: remoteBody,
              reason: "INVALID_BODY_EDGES",
              status: "IN_REVIEW",
            }),
          }),
        }),
      })
    );

    // 2.º sync: a Meta aprovou o ORIGINAL. O corpo local corrigido tem
    // a ordem invertida — a aprovação tem de ficar ligada ao remoto.
    updateSettings.mockClear();
    notificationTemplate.findMany.mockResolvedValue([
      { body: "A REP {{jobCode}} — olá {{customerName}}.", name: "job_done" },
    ]);
    shopSettingsFindUnique.mockResolvedValue({
      whatsappTemplatesJson: {
        job_done: {
          body: remoteBody,
          reason: "INVALID_BODY_EDGES",
          status: "IN_REVIEW",
          syncedAt: "2026-11-01T00:00:00Z",
        },
      },
    });
    mocks.cloudFetch.mockResolvedValue({
      body: { templates: [{ name: "job_done", status: "APPROVED" }] },
      ok: true,
      status: 200,
    });

    await syncWhatsAppTemplates(prisma);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappTemplatesJson: expect.objectContaining({
            job_done: expect.objectContaining({
              body: remoteBody,
              status: "APPROVED",
            }),
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

  it("corpo a acabar em parâmetro não é submetido — REJECTED/INVALID_BODY_EDGES", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
    notificationTemplate.findMany.mockResolvedValue([
      { body: "Olá {{customerName}}.", name: "job_done" },
      // Corpo editado pela loja a terminar num parâmetro — a Meta
      // rejeitava-o na submissão; agora nem chega à Cloud.
      {
        body: "Aviso {{jobCode}}{{if shopName}} — {{shopName}}{{endif}}",
        name: "job_ready",
      },
    ]);
    mocks.cloudFetch.mockResolvedValue({
      body: { templates: [{ name: "job_done", status: "APPROVED" }] },
      ok: true,
      status: 200,
    });

    const res = await syncWhatsAppTemplates(prisma);
    const submitted =
      mocks.cloudFetch.mock.calls[0]?.[2]?.body?.templates ?? [];
    expect(submitted.map((t: { name: string }) => t.name)).toEqual([
      "job_done",
    ]);
    expect(res.templates).toContainEqual(
      expect.objectContaining({
        name: "job_ready",
        reason: "INVALID_BODY_EDGES",
        status: "REJECTED",
      })
    );
  });

  it("aprovação fica ligada ao corpo da primeira submissão (edições não o substituem)", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(cloudSettings);
    // Segundo sync: a loja reordenou {{vars}} do corpo — mas a Meta tem
    // aprovada a versão da primeira submissão (a Cloud nunca edita
    // modelos existentes). O corpo gravado tem de ser o antigo.
    shopSettingsFindUnique.mockResolvedValue({
      whatsappTemplatesJson: {
        job_ready: {
          body: "Olá {{customerName}}, REP {{jobCode}}.",
          status: "APPROVED",
          syncedAt: "2026-11-01T00:00:00Z",
        },
      },
    });
    notificationTemplate.findMany.mockResolvedValue([
      {
        body: "Olá {{customerName}} — ref {{jobCode}} — fim.",
        name: "job_ready",
      },
    ]);
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
            job_ready: expect.objectContaining({
              body: "Olá {{customerName}}, REP {{jobCode}}.",
            }),
          }),
        }),
      })
    );
  });
});

describe("approvedTemplateBodyOf", () => {
  it("devolve o corpo gravado ou null sem registo", () => {
    expect(
      approvedTemplateBodyOf(
        { whatsappTemplatesJson: { a: { body: "Olá {{x}}." } } },
        "a"
      )
    ).toBe("Olá {{x}}.");
    expect(approvedTemplateBodyOf({ whatsappTemplatesJson: {} }, "a")).toBe(
      null
    );
  });
});
