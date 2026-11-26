import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(),
  syncWhatsAppTemplates: vi.fn(),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: vi.fn((value: string) =>
    value.startsWith("enc:") ? value.slice(4) : ""
  ),
  encryptSecret: vi.fn((value: string) => `enc:${value}`),
  isEncrypted: vi.fn((value: string) => value.startsWith("enc:")),
}));

vi.mock("../services/cloud.service.js", () => ({
  cloudFetch: mocks.cloudFetch,
  errorMessage: vi.fn(() => undefined),
  generateDiagPairingCode: vi.fn(async () => ({})),
  getCloudStatus: vi.fn(async () => ({})),
  listCloudStations: vi.fn(async () => []),
  pairWithCloud: vi.fn(async () => ({})),
  pullCloudIntake: vi.fn(async () => undefined),
  revokeCloudStation: vi.fn(async () => undefined),
  syncCloudEntitlements: vi.fn(async () => []),
  unpairCloud: vi.fn(async () => ({})),
}));

vi.mock("../services/whatsapp-templates.service.js", () => ({
  approvedTemplateBodyOf: vi.fn(() => null),
  deriveMetaTemplate: vi.fn(),
  expediteApprovedDeferred: vi.fn(async () => undefined),
  expandConditionals: vi.fn((body: string) => body),
  getWhatsAppTemplateStatuses: vi.fn(async () => ({})),
  isMetaBodySubmittable: vi.fn(() => true),
  metaConditionalVars: vi.fn(() => ({})),
  metaSafeConditionals: vi.fn((body: string) => body),
  orderedTemplateParams: vi.fn(() => []),
  syncWhatsAppTemplates: mocks.syncWhatsAppTemplates,
  TEMPLATE_LANG: "pt_PT",
  templateStatusOf: vi.fn(() => "MISSING"),
}));

import { settingsRoutes } from "../routes/settings.js";
import { stampWhatsAppLocalDeprecationStartedAtOnce } from "../services/settings.service.js";
import { syncWhatsAppBot } from "../services/whatsapp-bot.service.js";

interface TestSettingsRow extends Record<string, unknown> {
  whatsappApiTokenEncrypted: string | null;
  whatsappCloudConsentAt: Date | null;
  whatsappCloudMigrationNoticeSeenAt: Date | null;
  whatsappCredentialsAtCloud: boolean;
  whatsappEnabled: boolean;
  whatsappLocalDeprecationStartedAt: Date | null;
  whatsappPhoneNumberId: string | null;
  whatsappTransport: string;
}

function baseRow(overrides: Partial<TestSettingsRow> = {}): TestSettingsRow {
  return {
    cloudApiUrl: "https://cloud.example",
    cloudEntitlements: ["whatsapp-bot"],
    cloudShopTokenEncrypted: "enc:shop-token",
    cloudSyncedAt: new Date(),
    whatsappApiTokenEncrypted: null,
    whatsappBusinessId: null,
    whatsappCloudConsentAt: null,
    whatsappCloudMigrationNoticeSeenAt: null,
    whatsappCredentialsAtCloud: false,
    whatsappEnabled: true,
    whatsappLocalDeprecationStartedAt: null,
    whatsappPhoneNumberId: null,
    whatsappTransport: "meta",
    ...overrides,
  };
}

function createStatefulPrisma(initial: TestSettingsRow | null) {
  let row: TestSettingsRow | null = initial ? { ...initial } : null;
  const shopSettings = {
    findUnique: vi.fn(() => Promise.resolve(row ? { ...row } : null)),
    update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      if (row) {
        row = { ...row, ...data } as TestSettingsRow;
      }
      return Promise.resolve(row ? { ...row } : null);
    }),
    updateMany: vi.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where?: Record<string, unknown>;
      }) => {
        const current = row;
        if (!current) {
          return Promise.resolve({ count: 0 });
        }
        const matches = Object.entries(where ?? {}).every(([key, value]) => {
          if (key === "id") {
            return true;
          }
          // No Postgres uma coluna nullable sem valor é NULL; o stub omite a
          // chave quando a row é criada de raiz.
          const currentValue = current[key] === undefined ? null : current[key];
          return currentValue === value;
        });
        if (matches) {
          row = { ...current, ...data } as TestSettingsRow;
        }
        return Promise.resolve({ count: matches ? 1 : 0 });
      }
    ),
    upsert: vi.fn(
      ({
        create,
        update,
      }: {
        create?: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        row = row
          ? ({ ...row, ...update } as TestSettingsRow)
          : ({ ...(create ?? {}), ...update } as TestSettingsRow);
        return Promise.resolve({ ...row });
      }
    ),
  };
  return {
    getRow: () => (row ? { ...row } : null),
    prisma: { shopSettings },
    updateManyMock: shopSettings.updateMany,
  };
}

function buildApp(prisma: unknown) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({
        code: error.code,
        details: error.details,
        message: error.message,
      });
      return;
    }
    reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });
  app.decorate("auth", {
    api: {
      userHasPermission: () => Promise.resolve({ error: null, success: true }),
    },
  } as never);
  app.decorate("prisma", prisma as never);
  app.decorate("wsBroadcast", vi.fn() as never);
  app.addHook("onRequest", (req, _reply, done) => {
    (req as { user: unknown }).user = { id: "u1", role: "OWNER" };
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(settingsRoutes, { prefix: "/api/settings" });
  return app;
}

function credentialsUploadCalls() {
  return mocks.cloudFetch.mock.calls.filter(
    (call) => call[1] === "/shops/whatsapp-credentials"
  );
}

beforeEach(() => {
  mocks.cloudFetch.mockReset();
  mocks.cloudFetch.mockImplementation(
    async (_apiUrl: string, path: string) => ({
      body: path === "/whatsapp/inbound" ? { messages: [] } : {},
      ok: true,
      status: 200,
    })
  );
  mocks.syncWhatsAppTemplates.mockReset();
  mocks.syncWhatsAppTemplates.mockResolvedValue({});
});

describe("WP0.6 — consentimento Cloud do token Meta", () => {
  it("boot da versão nova grava a transição numa instalação fresh sem ninguém abrir as Definições", async () => {
    const state = createStatefulPrisma(null);

    const startedAt = await stampWhatsAppLocalDeprecationStartedAtOnce(
      state.prisma as never
    );

    expect(startedAt).toBeInstanceOf(Date);
    expect(state.getRow()?.whatsappLocalDeprecationStartedAt).toBeInstanceOf(
      Date
    );
    expect(state.getRow()?.whatsappLocalDeprecationStartedAt?.getTime()).toBe(
      startedAt.getTime()
    );
    expect(state.getRow()?.whatsappApiTokenEncrypted ?? null).toBeNull();

    const second = await stampWhatsAppLocalDeprecationStartedAtOnce(
      state.prisma as never
    );
    expect(second.getTime()).toBe(startedAt.getTime());
    expect(state.getRow()?.whatsappLocalDeprecationStartedAt?.getTime()).toBe(
      startedAt.getTime()
    );
  });

  it("save sem consentimento não faz upload nem grava a transição — isso pertence ao boot", async () => {
    const state = createStatefulPrisma(baseRow());
    const app = buildApp(state.prisma);

    const first = await app.inject({
      method: "PUT",
      payload: {
        apiToken: "meta-token",
        businessId: "business-1",
        enabled: true,
        phoneNumberId: "1234",
        transport: "meta",
      },
      url: "/api/settings/whatsapp",
    });
    expect(first.statusCode).toBe(200);
    expect(credentialsUploadCalls()).toHaveLength(0);
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(false);

    expect(state.getRow()?.whatsappLocalDeprecationStartedAt).toBeNull();

    const second = await app.inject({
      method: "PUT",
      payload: { trackingBaseUrl: "https://loja.example.com" },
      url: "/api/settings/whatsapp",
    });
    expect(second.statusCode).toBe(200);
    expect(state.getRow()?.whatsappLocalDeprecationStartedAt).toBeNull();
    expect(credentialsUploadCalls()).toHaveLength(0);
  });

  it("save com consentimento faz upload e grava a flag de migração", async () => {
    const state = createStatefulPrisma(
      baseRow({
        whatsappApiTokenEncrypted: "enc:meta-token",
        whatsappBusinessId: "business-1",
        whatsappPhoneNumberId: "1234",
      })
    );
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "PUT",
      payload: { cloudConsent: true, enabled: true, transport: "meta" },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(200);
    expect(credentialsUploadCalls()).toHaveLength(1);
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud.example",
      "/shops/whatsapp-credentials",
      expect.objectContaining({
        body: { accessToken: "meta-token", phoneNumberId: "1234" },
        method: "POST",
      })
    );
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(true);
    expect(state.getRow()?.whatsappCloudConsentAt).toBeInstanceOf(Date);
  });

  it("o consentimento é imutável num segundo save", async () => {
    const state = createStatefulPrisma(
      baseRow({
        whatsappApiTokenEncrypted: "enc:meta-token",
        whatsappBusinessId: "business-1",
        whatsappPhoneNumberId: "1234",
      })
    );
    const app = buildApp(state.prisma);
    const payload = { cloudConsent: true, transport: "meta" };

    await app.inject({
      method: "PUT",
      payload,
      url: "/api/settings/whatsapp",
    });
    const consentAt = state.getRow()?.whatsappCloudConsentAt;
    expect(consentAt).toBeInstanceOf(Date);

    await app.inject({
      method: "PUT",
      payload,
      url: "/api/settings/whatsapp",
    });
    expect(state.getRow()?.whatsappCloudConsentAt?.getTime()).toBe(
      consentAt?.getTime()
    );
  });

  it("poller sem consentimento não tenta upload das credenciais", async () => {
    const state = createStatefulPrisma(
      baseRow({
        whatsappApiTokenEncrypted: "enc:meta-token",
        whatsappBusinessId: "business-1",
        whatsappPhoneNumberId: "1234",
      })
    );

    await syncWhatsAppBot(
      state.prisma as never,
      "https://cloud.example",
      "shop-token",
      { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never
    );

    expect(credentialsUploadCalls()).toHaveLength(0);
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(false);
  });

  it("poller com consentimento faz upload e grava a flag", async () => {
    const state = createStatefulPrisma(
      baseRow({
        whatsappApiTokenEncrypted: "enc:meta-token",
        whatsappBusinessId: "business-1",
        whatsappCloudConsentAt: new Date(),
        whatsappPhoneNumberId: "1234",
      })
    );

    await syncWhatsAppBot(
      state.prisma as never,
      "https://cloud.example",
      "shop-token",
      { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never
    );

    expect(credentialsUploadCalls()).toHaveLength(1);
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(true);
  });

  it("GET das settings apenas lê a data de início da transição — nunca a grava", async () => {
    const startedAt = new Date("2026-01-02T10:00:00.000Z");
    const state = createStatefulPrisma(
      baseRow({
        whatsappApiTokenEncrypted: "enc:meta-token",
        whatsappBusinessId: "business-1",
        whatsappLocalDeprecationStartedAt: startedAt,
        whatsappPhoneNumberId: "1234",
      })
    );
    const app = buildApp(state.prisma);

    const first = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().cloudConsentAccepted).toBe(false);
    expect(first.json().localDeprecationStartedAt).toBe(
      startedAt.toISOString()
    );

    state.updateManyMock.mockClear();
    const second = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp",
    });
    expect(second.statusCode).toBe(200);
    expect(state.getRow()?.whatsappLocalDeprecationStartedAt?.getTime()).toBe(
      startedAt.getTime()
    );
    expect(state.updateManyMock).not.toHaveBeenCalled();
  });
});

describe("WP0.6 PR B — rotação, revogação e aviso grandfathered", () => {
  const migratedRow = () =>
    baseRow({
      whatsappApiTokenEncrypted: "enc:meta-token",
      whatsappBusinessId: "business-1",
      whatsappCloudConsentAt: new Date("2026-01-03T10:00:00.000Z"),
      whatsappCredentialsAtCloud: true,
      whatsappPhoneNumberId: "1234",
    });
  const migratedRowWith = (overrides: Partial<TestSettingsRow>) => ({
    ...migratedRow(),
    ...overrides,
  });

  it("rodar o token repõe a credencial na Cloud — sem upload a rotação ficaria morta", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "PUT",
      payload: { apiToken: "meta-token-novo" },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(200);
    const uploads = credentialsUploadCalls().filter(
      (call) => (call[2] as { method?: string }).method === "POST"
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0][2]).toMatchObject({
      body: { accessToken: "meta-token-novo", phoneNumberId: "1234" },
    });
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(true);
    expect(state.getRow()?.whatsappApiTokenEncrypted).toBe(
      "enc:meta-token-novo"
    );
  });

  it("mudar só o phoneNumberId também reenvia o par token+phoneNumberId", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "PUT",
      payload: { phoneNumberId: "5678" },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(200);
    const uploads = credentialsUploadCalls().filter(
      (call) => (call[2] as { method?: string }).method === "POST"
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0][2]).toMatchObject({
      body: { accessToken: "meta-token", phoneNumberId: "5678" },
    });
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(true);
    expect(state.getRow()?.whatsappPhoneNumberId).toBe("5678");
  });

  it("rejeita mudar só o phoneNumberId quando o token local já foi apagado", async () => {
    const state = createStatefulPrisma(
      migratedRowWith({ whatsappApiTokenEncrypted: null })
    );
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "PUT",
      payload: { phoneNumberId: "5678" },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(400);
    expect(state.getRow()).toMatchObject({
      whatsappCredentialsAtCloud: true,
      whatsappPhoneNumberId: "1234",
    });
    expect(
      credentialsUploadCalls().filter(
        (call) => (call[2] as { method?: string }).method === "POST"
      )
    ).toHaveLength(0);
  });

  it("aceita mudar o phoneNumberId sem token local quando vem token de substituição", async () => {
    const state = createStatefulPrisma(
      migratedRowWith({ whatsappApiTokenEncrypted: null })
    );
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "PUT",
      payload: { apiToken: "meta-token-novo", phoneNumberId: "5678" },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(200);
    const uploads = credentialsUploadCalls().filter(
      (call) => (call[2] as { method?: string }).method === "POST"
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0][2]).toMatchObject({
      body: { accessToken: "meta-token-novo", phoneNumberId: "5678" },
    });
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(true);
  });

  it("revogação chama DELETE na Cloud, apaga o token local e limpa o consentimento", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/cloud/revoke",
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud.example",
      "/shops/whatsapp-credentials",
      { method: "DELETE", token: "shop-token" }
    );
    expect(state.getRow()).toMatchObject({
      whatsappApiTokenEncrypted: null,
      whatsappCloudConsentAt: null,
      whatsappCredentialsAtCloud: false,
      whatsappPhoneNumberId: "1234",
    });
  });

  it("404 no DELETE da Cloud é sucesso idempotente", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);
    mocks.cloudFetch.mockImplementation(async () => ({
      body: null,
      ok: false,
      status: 404,
    }));

    const res = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/cloud/revoke",
    });

    expect(res.statusCode).toBe(200);
    expect(state.getRow()?.whatsappApiTokenEncrypted).toBeNull();
    expect(state.getRow()?.whatsappCloudConsentAt).toBeNull();
  });

  it("5xx na Cloud não apaga nada localmente e uma nova tentativa consegue concluir", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);
    mocks.cloudFetch
      .mockImplementationOnce(async () => ({
        body: null,
        ok: false,
        status: 500,
      }))
      .mockImplementation(async (_apiUrl: string, path: string) => ({
        body: path === "/whatsapp/inbound" ? { messages: [] } : {},
        ok: true,
        status: 200,
      }));

    const failed = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/cloud/revoke",
    });
    expect(failed.statusCode).toBe(502);
    expect(state.getRow()).toMatchObject({
      whatsappApiTokenEncrypted: "enc:meta-token",
      whatsappCredentialsAtCloud: true,
    });
    expect(state.getRow()?.whatsappCloudConsentAt).toBeInstanceOf(Date);

    const retry = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/cloud/revoke",
    });
    expect(retry.statusCode).toBe(200);
    expect(state.getRow()?.whatsappApiTokenEncrypted).toBeNull();
    expect(state.getRow()?.whatsappCloudConsentAt).toBeNull();
  });

  it("falha de rede na Cloud também não apaga nada localmente", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);
    mocks.cloudFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/cloud/revoke",
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("CLOUD_UNREACHABLE");
    expect(state.getRow()?.whatsappApiTokenEncrypted).toBe("enc:meta-token");
    expect(state.getRow()?.whatsappCloudConsentAt).toBeInstanceOf(Date);
    expect(state.getRow()?.whatsappCredentialsAtCloud).toBe(true);
  });

  it("GET expõe o aviso apenas para loja migrada sem consentimento e sem seenAt", async () => {
    const state = createStatefulPrisma(
      baseRow({
        whatsappCloudConsentAt: null,
        whatsappCloudMigrationNoticeSeenAt: null,
        whatsappCredentialsAtCloud: true,
      })
    );
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cloudMigrationNoticePending).toBe(true);
  });

  it.each([
    ["consentida", { whatsappCloudConsentAt: new Date() }],
    ["não migrada", { whatsappCredentialsAtCloud: false }],
    [
      "já avisada",
      {
        whatsappCloudMigrationNoticeSeenAt: new Date(),
        whatsappCredentialsAtCloud: true,
      },
    ],
  ])("GET não mostra o aviso numa loja %s", async (_label, overrides) => {
    const state = createStatefulPrisma(baseRow(overrides));
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cloudMigrationNoticePending).toBe(false);
  });

  it("dismiss grava seenAt uma única vez e a corrida devolve o timestamp canónico", async () => {
    const state = createStatefulPrisma(
      baseRow({
        whatsappCloudConsentAt: null,
        whatsappCloudMigrationNoticeSeenAt: null,
        whatsappCredentialsAtCloud: true,
      })
    );
    const app = buildApp(state.prisma);

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/settings/whatsapp/migration-notice/seen",
      }),
      app.inject({
        method: "POST",
        url: "/api/settings/whatsapp/migration-notice/seen",
      }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstSeenAt = first.json().seenAt;
    expect(firstSeenAt).toBeTruthy();
    expect(second.json().seenAt).toBe(firstSeenAt);

    const after = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp",
    });
    expect(after.json().cloudMigrationNoticePending).toBe(false);
    expect(state.updateManyMock).toHaveBeenCalledTimes(2);
  });
});
