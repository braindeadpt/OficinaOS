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
        const blocked = Object.entries(where ?? {}).some(
          ([key, value]) =>
            key !== "id" &&
            value === null &&
            current[key] !== null &&
            current[key] !== undefined
        );
        if (!blocked) {
          row = { ...current, ...data } as TestSettingsRow;
        }
        return Promise.resolve({ count: blocked ? 0 : 1 });
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
