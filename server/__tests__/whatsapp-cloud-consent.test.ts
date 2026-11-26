import { isAppError } from "@shared/errors/app-error.js";
import { updateWhatsAppSettingsSchema } from "@shared/schemas/settings.schema";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ENCRYPTED_SETTINGS_KEY_RE = /Encrypted/i;

const mocks = vi.hoisted(() => ({
  assertNotDemoMode: vi.fn(),
  cloudFetch: vi.fn(),
  sendWhatsApp: vi.fn(),
  sendWhatsAppInteractiveMessage: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
  setEvolutionWebhook: vi.fn(),
  syncWhatsAppTemplates: vi.fn(),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: vi.fn((value: string) =>
    value.startsWith("enc:") ? value.slice(4) : ""
  ),
  encryptSecret: vi.fn((value: string) => `enc:${value}`),
  isEncrypted: vi.fn((value: string) => value.startsWith("enc:")),
}));

vi.mock("../services/notification-sender.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/notification-sender.js")>();
  return {
    ...actual,
    sendWhatsApp: mocks.sendWhatsApp,
    sendWhatsAppInteractiveMessage: mocks.sendWhatsAppInteractiveMessage,
    sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
  };
});

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

vi.mock("../lib/demo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/demo.js")>();
  return {
    ...actual,
    assertNotDemoMode: mocks.assertNotDemoMode,
  };
});

vi.mock("../services/evolution.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/evolution.service.js")>();
  return {
    ...actual,
    setEvolutionWebhook: mocks.setEvolutionWebhook,
  };
});

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
import {
  resolveWhatsAppChannel,
  sendWhatsAppText,
} from "../services/whatsapp-channel.js";
import { purgeExpiredWhatsAppLocalToken } from "../services/whatsapp-local-sunset.service.js";

interface TestSettingsRow extends Record<string, unknown> {
  whatsappApiTokenEncrypted: string | null;
  whatsappApiTokenWrittenAt: Date | null;
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
    whatsappApiTokenWrittenAt: null,
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
  const migrationEvents: Record<string, unknown>[] = [];
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
        const matchesCondition = (
          condition: Record<string, unknown>
        ): boolean =>
          Object.entries(condition).every(([key, value]) => {
            if (key === "id") {
              return true;
            }
            // No Postgres uma coluna nullable sem valor é NULL; o stub omite a
            // chave quando a row é criada de raiz.
            const currentValue =
              current[key] === undefined ? null : current[key];
            if (
              value &&
              typeof value === "object" &&
              !(value instanceof Date) &&
              "lte" in value
            ) {
              const upper = (value as { lte?: unknown }).lte;
              return (
                currentValue instanceof Date &&
                upper instanceof Date &&
                currentValue.getTime() <= upper.getTime()
              );
            }
            if (
              value &&
              typeof value === "object" &&
              !(value instanceof Date) &&
              "lt" in value
            ) {
              const upper = (value as { lt?: unknown }).lt;
              return (
                currentValue instanceof Date &&
                upper instanceof Date &&
                currentValue.getTime() < upper.getTime()
              );
            }
            return currentValue === value;
          });
        const directCondition = Object.fromEntries(
          Object.entries(where ?? {}).filter(([key]) => key !== "OR")
        );
        const orClauses = where?.OR;
        const matches =
          matchesCondition(directCondition) &&
          (!Array.isArray(orClauses) ||
            orClauses.some((clause) =>
              matchesCondition(clause as Record<string, unknown>)
            ));
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
  const whatsAppMigrationEvent = {
    create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      const event = {
        createdAt: new Date(),
        id: `event-${migrationEvents.length + 1}`,
        ...data,
      };
      migrationEvents.push(event);
      return Promise.resolve(event);
    }),
    findMany: vi.fn(() => Promise.resolve([...migrationEvents].reverse())),
  };
  return {
    getMigrationEvents: () => [...migrationEvents],
    getRow: () => (row ? { ...row } : null),
    migrationEventCreateMock: whatsAppMigrationEvent.create,
    prisma: {
      $transaction: vi.fn(
        (
          callback: (tx: {
            shopSettings: typeof shopSettings;
            whatsAppMigrationEvent: typeof whatsAppMigrationEvent;
          }) => Promise<unknown>
        ) => callback({ shopSettings, whatsAppMigrationEvent })
      ),
      shopSettings,
      whatsAppMigrationEvent,
    },
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

async function waitForCondition(
  condition: () => boolean,
  description: string
): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!condition()) {
    throw new Error(`Timed out waiting for ${description}`);
  }
}

function mockCloudInvalidCredentials() {
  mocks.cloudFetch.mockImplementation((_apiUrl: string, path: string) => {
    if (path === "/shops/whatsapp-credentials") {
      return Promise.resolve({
        body: {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Meta rejected",
          },
        },
        ok: false,
        status: 400,
      });
    }
    return Promise.resolve({ body: {}, ok: true, status: 200 });
  });
}

beforeEach(() => {
  mocks.assertNotDemoMode.mockReset();
  mocks.cloudFetch.mockReset();
  mocks.cloudFetch.mockImplementation(
    async (_apiUrl: string, path: string) => ({
      body: path === "/whatsapp/inbound" ? { messages: [] } : {},
      ok: true,
      status: 200,
    })
  );
  mocks.sendWhatsApp.mockReset();
  mocks.sendWhatsApp.mockResolvedValue({ success: true });
  mocks.sendWhatsAppInteractiveMessage.mockReset();
  mocks.sendWhatsAppInteractiveMessage.mockResolvedValue({ success: true });
  mocks.sendWhatsAppTemplate.mockReset();
  mocks.sendWhatsAppTemplate.mockResolvedValue({ success: true });
  mocks.setEvolutionWebhook.mockReset();
  mocks.setEvolutionWebhook.mockResolvedValue({ success: true });
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

  it("rejeição definitiva no primeiro setup remove o candidato em vez de o reter como upload pendente", async () => {
    const state = createStatefulPrisma(baseRow());
    const app = buildApp(state.prisma);
    mocks.cloudFetch.mockImplementation((_apiUrl: string, path: string) => {
      if (path === "/shops/whatsapp-credentials") {
        return Promise.resolve({
          body: {
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Meta rejected",
            },
          },
          ok: false,
          status: 400,
        });
      }
      return Promise.resolve({ body: {}, ok: true, status: 200 });
    });

    const res = await app.inject({
      method: "PUT",
      payload: {
        apiToken: "meta-token-invalido",
        businessId: "business-1",
        cloudConsent: true,
        phoneNumberId: "1234",
      },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CLOUD_INVALID_CREDENTIALS");
    expect(state.getRow()).toMatchObject({
      whatsappApiTokenEncrypted: null,
      whatsappApiTokenWrittenAt: null,
      whatsappCredentialsAtCloud: false,
    });
    expect(credentialsUploadCalls()).toHaveLength(1);
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

  it("duas rotações rejeitadas em paralelo repõem a configuração Cloud original", async () => {
    const state = createStatefulPrisma(
      migratedRowWith({ whatsappApiTokenEncrypted: null })
    );
    const app = buildApp(state.prisma);
    const rejectUploads: Array<() => void> = [];
    mocks.cloudFetch.mockImplementation((_apiUrl: string, path: string) => {
      if (path === "/shops/whatsapp-credentials") {
        return new Promise((resolve) => {
          rejectUploads.push(() =>
            resolve({
              body: {
                error: {
                  code: "INVALID_CREDENTIALS",
                  message: "Meta rejected",
                },
              },
              ok: false,
              status: 400,
            })
          );
        });
      }
      return Promise.resolve({ body: {}, ok: true, status: 200 });
    });
    const parseSpy = vi.spyOn(updateWhatsAppSettingsSchema, "safeParse");

    try {
      const first = app.inject({
        method: "PUT",
        payload: { apiToken: "meta-token-invalido-a" },
        url: "/api/settings/whatsapp",
      });
      await waitForCondition(
        () => rejectUploads.length === 1,
        "o primeiro upload ficar pendente"
      );
      const second = app.inject({
        method: "PUT",
        payload: { apiToken: "meta-token-invalido-b" },
        url: "/api/settings/whatsapp",
      });
      // safeParse é a primeira operação do handler; como não há await entre
      // ela e a entrada na fila, este sinal garante que o segundo PUT já está
      // retido antes de libertarmos a validação do primeiro.
      await waitForCondition(
        () => parseSpy.mock.calls.length === 2,
        "o segundo PUT entrar no handler"
      );
      expect(rejectUploads).toHaveLength(1);

      rejectUploads[0]?.();
      const firstRes = await first;
      expect(firstRes.statusCode).toBe(400);
      await waitForCondition(
        () => rejectUploads.length === 2,
        "o segundo upload ficar pendente"
      );
      rejectUploads[1]?.();
      const secondRes = await second;

      expect(secondRes.statusCode).toBe(400);
      expect(state.getRow()).toMatchObject({
        whatsappApiTokenEncrypted: null,
        whatsappCredentialsAtCloud: true,
        whatsappPhoneNumberId: "1234",
      });
    } finally {
      // Se uma asserção falhar a meio, uploads simulados ficariam pendentes
      // e bloqueariam para sempre a fila partilhada (e os testes seguintes).
      // Repomos a implementação que resolve de imediato — uploads que ainda
      // não arrancaram deixam de ficar retidos — e libertamos os que já
      // estão pendentes, garantindo que a fila drena.
      mocks.cloudFetch.mockImplementation(async () => ({
        body: {},
        ok: true,
        status: 200,
      }));
      for (const release of rejectUploads) {
        release();
      }
      parseSpy.mockRestore();
    }
  });

  it("revogação espera por gravações em fila e nenhuma rotação pendente repõe o token depois dela", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);
    const parseSpy = vi.spyOn(updateWhatsAppSettingsSchema, "safeParse");
    let releaseWebhook!: () => void;
    const webhookGate = new Promise<void>((resolve) => {
      releaseWebhook = resolve;
    });
    mocks.setEvolutionWebhook.mockImplementation(async () => {
      await webhookGate;
      return { success: true };
    });

    try {
      const evolutionSave = app.inject({
        headers: { host: "192.168.1.50:4000" },
        method: "PUT",
        payload: {
          botDisclaimerAccepted: true,
          disclaimerAccepted: true,
          enabled: true,
          evolutionApiKey: "evo-key",
          evolutionInstance: "oficinaos",
          evolutionUrl: "http://evolution.local:8080",
          transport: "evolution",
        },
        url: "/api/settings/whatsapp",
      });
      await waitForCondition(
        () => mocks.setEvolutionWebhook.mock.calls.length === 1,
        "a gravação Evolution ficar retida no webhook"
      );

      const rotation = app.inject({
        method: "PUT",
        payload: { apiToken: "meta-token-novo", transport: "meta" },
        url: "/api/settings/whatsapp",
      });
      await waitForCondition(
        () => parseSpy.mock.calls.length === 2,
        "a rotação entrar no handler e ficar na fila"
      );

      const handlerEntriesBeforeRevoke =
        mocks.assertNotDemoMode.mock.calls.length;
      const revoke = app.inject({
        method: "POST",
        url: "/api/settings/whatsapp/cloud/revoke",
      });
      await waitForCondition(
        () =>
          mocks.assertNotDemoMode.mock.calls.length ===
          handlerEntriesBeforeRevoke + 1,
        "a revogação entrar no handler e ficar na fila"
      );
      // Antes de libertar o webhook nenhuma operação de credenciais pode
      // passar à frente da gravação que já ocupava a fila.
      expect(credentialsUploadCalls()).toHaveLength(0);

      releaseWebhook();
      const [evolutionRes, rotationRes, revokeRes] = await Promise.all([
        evolutionSave,
        rotation,
        revoke,
      ]);

      expect(evolutionRes.statusCode).toBe(200);
      expect(rotationRes.statusCode).toBe(200);
      expect(revokeRes.statusCode).toBe(200);
      expect(
        credentialsUploadCalls().map(
          (call) => (call[2] as { method?: string }).method
        )
      ).toEqual(["POST", "DELETE"]);
      expect(credentialsUploadCalls()[0]?.[2]).toMatchObject({
        body: { accessToken: "meta-token-novo", phoneNumberId: "1234" },
      });
      expect(state.getRow()).toMatchObject({
        whatsappApiTokenEncrypted: null,
        whatsappCloudConsentAt: null,
        whatsappCredentialsAtCloud: false,
      });
    } finally {
      releaseWebhook();
      parseSpy.mockRestore();
    }
  });

  it("rotação com token inválido mostra erro e mantém a configuração Cloud que estava a funcionar", async () => {
    const state = createStatefulPrisma(
      migratedRowWith({
        whatsappApiTokenEncrypted: null,
        whatsappBusinessId: "waba-antigo",
      })
    );
    const app = buildApp(state.prisma);
    mockCloudInvalidCredentials();

    const res = await app.inject({
      method: "PUT",
      payload: { apiToken: "meta-token-invalido", businessId: "waba-novo" },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "CLOUD_INVALID_CREDENTIALS",
      message: "errors.cloud_invalid_credentials",
    });
    expect(state.getRow()).toMatchObject({
      whatsappApiTokenEncrypted: null,
      whatsappBusinessId: "waba-antigo",
      whatsappCredentialsAtCloud: true,
      whatsappPhoneNumberId: "1234",
    });
    expect(
      credentialsUploadCalls().filter(
        (call) => (call[2] as { method?: string }).method === "POST"
      )
    ).toHaveLength(1);
  });

  it("rotação inválida antes do primeiro upload mantém o token local e não marca a flag Cloud", async () => {
    const state = createStatefulPrisma(
      baseRow({
        whatsappApiTokenEncrypted: "enc:meta-token-antigo",
        whatsappCloudConsentAt: new Date("2026-01-03T10:00:00.000Z"),
        whatsappCredentialsAtCloud: false,
        whatsappPhoneNumberId: "1234",
      })
    );
    const app = buildApp(state.prisma);
    mockCloudInvalidCredentials();

    const res = await app.inject({
      method: "PUT",
      payload: { apiToken: "meta-token-invalido" },
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "CLOUD_INVALID_CREDENTIALS",
    });
    expect(state.getRow()).toMatchObject({
      whatsappApiTokenEncrypted: "enc:meta-token-antigo",
      whatsappCredentialsAtCloud: false,
      whatsappPhoneNumberId: "1234",
    });
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

  it("revogar duas vezes é idempotente: o segundo 404 mantém o mesmo estado final", async () => {
    const state = createStatefulPrisma(migratedRow());
    const app = buildApp(state.prisma);

    const first = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/cloud/revoke",
    });
    expect(first.statusCode).toBe(200);
    const afterFirst = state.getRow();

    mocks.cloudFetch.mockImplementation(async () => ({
      body: null,
      ok: false,
      status: 404,
    }));
    const second = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/cloud/revoke",
    });

    expect(second.statusCode).toBe(200);
    expect(state.getRow()).toEqual(afterFirst);
    expect(
      mocks.cloudFetch.mock.calls.filter(
        (call) =>
          call[1] === "/shops/whatsapp-credentials" &&
          (call[2] as { method?: string }).method === "DELETE"
      )
    ).toHaveLength(2);
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

describe("fallback transitório, sunset e purge auditado", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const activeTransitionRow = (overrides: Partial<TestSettingsRow> = {}) =>
    baseRow({
      whatsappApiTokenEncrypted: "enc:meta-token",
      whatsappBusinessId: "business-1",
      whatsappCloudConsentAt: new Date("2026-01-03T10:00:00.000Z"),
      whatsappCredentialsAtCloud: true,
      whatsappLocalDeprecationStartedAt: new Date(Date.now() - 10 * DAY_MS),
      whatsappPhoneNumberId: "1234",
      ...overrides,
    });
  const cloudChannel = {
    apiUrl: "https://cloud.example",
    mode: "cloud" as const,
    shopToken: "shop-token",
  };

  it("durante a transição, falha de rede da Cloud cai no token local mesmo sem consentimento (grandfathered) e persiste o evento", async () => {
    const row = activeTransitionRow({ whatsappCloudConsentAt: null });
    const state = createStatefulPrisma(row);
    mocks.cloudFetch.mockRejectedValueOnce(
      Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" })
    );

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(true);
    expect(mocks.sendWhatsApp).toHaveBeenCalledWith(
      {
        apiToken: "meta-token",
        businessId: "business-1",
        phoneNumberId: "1234",
      },
      "912345678",
      "A reparação está pronta",
      "PT"
    );
    expect(state.getMigrationEvents()).toEqual([
      expect.objectContaining({
        reason: "cloud_network_error",
        type: "LOCAL_FALLBACK",
      }),
    ]);
  });

  it("durante a transição, 5xx da Cloud cai no token local com motivo auditável", async () => {
    const row = activeTransitionRow();
    const state = createStatefulPrisma(row);
    mocks.cloudFetch.mockResolvedValueOnce({
      body: { error: { message: "relay down" } },
      ok: false,
      status: 503,
    });

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(true);
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(state.getMigrationEvents()).toEqual([
      expect.objectContaining({
        reason: "cloud_http_5xx",
        type: "LOCAL_FALLBACK",
      }),
    ]);
  });

  it.each([
    400, 402, 429,
  ])("%i da Cloud nunca usa fallback local nem persiste evento", async (status) => {
    const row = activeTransitionRow();
    const state = createStatefulPrisma(row);
    mocks.cloudFetch.mockResolvedValueOnce({
      body: { error: { message: `HTTP ${status}` } },
      ok: false,
      status,
    });

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(false);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(state.getMigrationEvents()).toHaveLength(0);
  });

  it("depois de uma revogação, mesmo com settings/cloud channel em stale cache, não há fallback local", async () => {
    const staleRow = activeTransitionRow();
    const state = createStatefulPrisma(
      activeTransitionRow({
        whatsappApiTokenEncrypted: null,
        whatsappCloudConsentAt: null,
        whatsappCredentialsAtCloud: false,
      })
    );
    mocks.cloudFetch.mockResolvedValueOnce({
      body: {},
      ok: false,
      status: 500,
    });

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      staleRow
    );

    expect(result.success).toBe(false);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(state.getMigrationEvents()).toHaveLength(0);
  });

  it("depois do fim da transição não há fallback local, mesmo com token e consentimento ainda presentes", async () => {
    const row = activeTransitionRow({
      whatsappLocalDeprecationStartedAt: new Date(Date.now() - 31 * DAY_MS),
    });
    const state = createStatefulPrisma(row);
    mocks.cloudFetch.mockResolvedValueOnce({
      body: {},
      ok: false,
      status: 500,
    });

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(false);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(state.getMigrationEvents()).toHaveLength(0);
  });

  it("se o evento de auditoria não puder ser persistido, o fallback local também não é usado", async () => {
    const row = activeTransitionRow();
    const state = createStatefulPrisma(row);
    state.migrationEventCreateMock.mockRejectedValueOnce(new Error("db down"));
    mocks.cloudFetch.mockResolvedValueOnce({
      body: {},
      ok: false,
      status: 500,
    });

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(false);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("defesa no envio bloqueia um channel local stale depois do prazo, mesmo com consentimento", async () => {
    const row = activeTransitionRow({
      whatsappLocalDeprecationStartedAt: new Date(Date.now() - 31 * DAY_MS),
    });
    const state = createStatefulPrisma(row);

    const result = await sendWhatsAppText(
      state.prisma as never,
      {
        config: {
          apiToken: "meta-token",
          businessId: "business-1",
          phoneNumberId: "1234",
        },
        mode: "local",
      },
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("WHATSAPP_LOCAL_DIRECT_SEND_ENDED");
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("defesa no envio bloqueia um channel Cloud stale depois do prazo sem consentimento", async () => {
    const row = activeTransitionRow({
      whatsappCloudConsentAt: null,
      whatsappLocalDeprecationStartedAt: new Date(Date.now() - 31 * DAY_MS),
    });
    const state = createStatefulPrisma(row);

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("WHATSAPP_CLOUD_AUTHORIZATION_REQUIRED");
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("depois do prazo sem consentimento não resolve Meta — nem Cloud nem local", () => {
    const row = activeTransitionRow({
      whatsappCloudConsentAt: null,
      whatsappLocalDeprecationStartedAt: new Date(Date.now() - 31 * DAY_MS),
    });

    expect(resolveWhatsAppChannel(row)).toBeNull();
  });

  it("depois do prazo, consentimento sem credenciais na Cloud não ressuscita o envio local", () => {
    const row = activeTransitionRow({
      whatsappCredentialsAtCloud: false,
      whatsappLocalDeprecationStartedAt: new Date(Date.now() - 31 * DAY_MS),
    });

    expect(resolveWhatsAppChannel(row)).toBeNull();
  });

  it("dentro do prazo uma loja grandfathered continua a resolver o relay Cloud", () => {
    const row = activeTransitionRow({ whatsappCloudConsentAt: null });

    expect(resolveWhatsAppChannel(row)).toEqual({
      apiUrl: "https://cloud.example",
      mode: "cloud",
      shopToken: "shop-token",
    });
  });

  it("depois do prazo uma loja consentida com credenciais na Cloud continua pelo relay", () => {
    const row = activeTransitionRow({
      whatsappLocalDeprecationStartedAt: new Date(Date.now() - 31 * DAY_MS),
    });

    expect(resolveWhatsAppChannel(row)).toEqual({
      apiUrl: "https://cloud.example",
      mode: "cloud",
      shopToken: "shop-token",
    });
  });

  it("purge depois do prazo apaga o token uma única vez e grava o evento de auditoria", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const state = createStatefulPrisma(
      activeTransitionRow({
        whatsappLocalDeprecationStartedAt: new Date(
          now.getTime() - 31 * DAY_MS
        ),
      })
    );

    await expect(
      purgeExpiredWhatsAppLocalToken(state.prisma as never, now)
    ).resolves.toBe(true);

    expect(state.getRow()?.whatsappApiTokenEncrypted).toBeNull();
    expect(state.getMigrationEvents()).toEqual([
      expect.objectContaining({
        reason: "transition_deadline_reached",
        type: "LOCAL_TOKEN_PURGED",
      }),
    ]);
    expect(state.updateManyMock).toHaveBeenCalledWith({
      data: {
        whatsappApiTokenEncrypted: null,
        whatsappApiTokenWrittenAt: null,
      },
      where: expect.objectContaining({
        id: "default",
        whatsappApiTokenEncrypted: "enc:meta-token",
      }),
    });

    await expect(
      purgeExpiredWhatsAppLocalToken(state.prisma as never, now)
    ).resolves.toBe(false);
    expect(state.getMigrationEvents()).toHaveLength(1);
  });

  it("purge antes do fim do prazo não apaga o token nem grava evento", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const state = createStatefulPrisma(
      activeTransitionRow({
        whatsappLocalDeprecationStartedAt: new Date(
          now.getTime() - 29 * DAY_MS
        ),
      })
    );

    await expect(
      purgeExpiredWhatsAppLocalToken(state.prisma as never, now)
    ).resolves.toBe(false);

    expect(state.getRow()?.whatsappApiTokenEncrypted).toBe("enc:meta-token");
    expect(state.getMigrationEvents()).toHaveLength(0);
  });

  it("GET das settings expõe os eventos de migração para as Definições", async () => {
    const state = createStatefulPrisma(activeTransitionRow());
    await state.prisma.whatsAppMigrationEvent.create({
      data: {
        reason: "transition_deadline_reached",
        type: "LOCAL_TOKEN_PURGED",
      },
    });
    const app = buildApp(state.prisma);

    const res = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().migrationEvents).toEqual([
      expect.objectContaining({
        reason: "transition_deadline_reached",
        type: "LOCAL_TOKEN_PURGED",
      }),
    ]);
  });

  it("timeout ambíguo da Cloud não usa fallback local nem duplica por retry direto", async () => {
    const row = activeTransitionRow();
    const state = createStatefulPrisma(row);
    mocks.cloudFetch.mockRejectedValueOnce(
      Object.assign(new Error("relay timeout"), { name: "AbortError" })
    );

    const result = await sendWhatsAppText(
      state.prisma as never,
      cloudChannel,
      "912345678",
      "A reparação está pronta",
      "PT",
      row
    );

    expect(result.success).toBe(false);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(state.getMigrationEvents()).toHaveLength(0);
  });

  it("purge retém token introduzido depois do prazo enquanto o upload Cloud está pendente", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const startedAt = new Date(now.getTime() - 31 * DAY_MS);
    const state = createStatefulPrisma(
      activeTransitionRow({
        whatsappApiTokenWrittenAt: new Date(
          now.getTime() - 12 * 60 * 60 * 1000
        ),
        whatsappCredentialsAtCloud: false,
        whatsappLocalDeprecationStartedAt: startedAt,
      })
    );

    await expect(
      purgeExpiredWhatsAppLocalToken(state.prisma as never, now)
    ).resolves.toBe(false);

    expect(state.getRow()?.whatsappApiTokenEncrypted).toBe("enc:meta-token");
    expect(state.getMigrationEvents()).toHaveLength(0);
  });

  it("purge não retém um token pós-prazo sem consentimento Cloud para upload", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const startedAt = new Date(now.getTime() - 31 * DAY_MS);
    const state = createStatefulPrisma(
      activeTransitionRow({
        whatsappApiTokenWrittenAt: new Date(
          now.getTime() - 12 * 60 * 60 * 1000
        ),
        whatsappCloudConsentAt: null,
        whatsappCredentialsAtCloud: false,
        whatsappLocalDeprecationStartedAt: startedAt,
      })
    );

    await expect(
      purgeExpiredWhatsAppLocalToken(state.prisma as never, now)
    ).resolves.toBe(true);
    expect(state.getRow()?.whatsappApiTokenEncrypted).toBeNull();
  });

  it("purge apaga token pós-prazo quando as credenciais já foram confirmadas na Cloud", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const startedAt = new Date(now.getTime() - 31 * DAY_MS);
    const state = createStatefulPrisma(
      activeTransitionRow({
        whatsappApiTokenWrittenAt: new Date(
          now.getTime() - 12 * 60 * 60 * 1000
        ),
        whatsappCredentialsAtCloud: true,
        whatsappLocalDeprecationStartedAt: startedAt,
      })
    );

    await expect(
      purgeExpiredWhatsAppLocalToken(state.prisma as never, now)
    ).resolves.toBe(true);

    expect(state.getRow()?.whatsappApiTokenEncrypted).toBeNull();
    expect(state.getRow()?.whatsappApiTokenWrittenAt).toBeNull();
  });

  it("GET e PUT nunca expõem tokens nem blobs cifrados das settings WhatsApp", async () => {
    const state = createStatefulPrisma(activeTransitionRow());
    const app = buildApp(state.prisma);

    for (const request of [
      { method: "GET" as const, url: "/api/settings/whatsapp" },
      {
        method: "PUT" as const,
        payload: { enabled: true },
        url: "/api/settings/whatsapp",
      },
    ]) {
      const res = await app.inject(request);
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      for (const key of Object.keys(body)) {
        expect(key).not.toMatch(ENCRYPTED_SETTINGS_KEY_RE);
      }
      expect(JSON.stringify(body)).not.toContain("enc:meta-token");
      expect(body.hasApiToken).toBe(true);
    }
  });
});
