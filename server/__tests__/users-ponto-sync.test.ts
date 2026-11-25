import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/crypto.js";

const userServiceMocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  toggleStatus: vi.fn(),
  updateUserProfileService: vi.fn(),
}));

vi.mock("../services/user.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/user.service.js")>();
  return {
    ...actual,
    createUser: userServiceMocks.createUser,
    toggleStatus: userServiceMocks.toggleStatus,
    updateUserProfileService: userServiceMocks.updateUserProfileService,
  };
});

import { usersRoutes } from "../routes/users.js";

const CLOUD_URL = "https://cloud.test";
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function cloudJson(body: unknown, status = 200) {
  return Promise.resolve(Response.json(body, { status }));
}

function fakePrisma() {
  const row = {
    cloudApiUrl: CLOUD_URL,
    cloudEntitlements: ["ponto"],
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    cloudSyncedAt: new Date(),
    pontoExternalAutoApprove: true,
    pontoExternalPhotoRequired: false,
    pontoGeoLat: 38.7,
    pontoGeoLng: -9.1,
    pontoRadiusM: 100,
    pontoSmsNumber: "+351210000000",
    pontoWaNumber: "+351912345678",
    timezone: "Europe/Lisbon",
  };
  return {
    shopSettings: {
      findUnique: vi.fn(async () => ({ ...row })),
    },
    timeEntry: {
      findMany: vi.fn(async () => []),
    },
    user: {
      findMany: vi.fn(async () => []),
    },
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
    } else {
      reply.status(500).send({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal error",
      });
    }
  });
  app.decorate("auth", {
    api: {
      userHasPermission: () => Promise.resolve({ error: null, success: true }),
    },
  } as never);
  app.decorate("prisma", prisma as never);
  app.addHook("onRequest", (req, _reply, done) => {
    (req as { user: unknown }).user = { id: "owner-1", role: "OWNER" };
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(usersRoutes, { prefix: "/api/users" });
  return app;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  userServiceMocks.createUser.mockResolvedValue({ id: "created-user" });
  userServiceMocks.toggleStatus.mockResolvedValue({
    id: "user-1",
    isActive: false,
  });
  userServiceMocks.updateUserProfileService.mockResolvedValue({ id: "user-1" });
});

describe("users — sync da configuração Cloud do ponto", () => {
  it("criar utilizador com campos de ponto dispara o push", async () => {
    fetchMock.mockImplementation(() => cloudJson({ ok: true }));
    const app = buildApp(fakePrisma());

    const res = await app.inject({
      method: "POST",
      payload: {
        email: "novo@example.com",
        password: "Password1",
        phoneE164: "+351911111111",
        pontoEnabled: true,
        role: "TECHNICIAN",
        username: "novo_tech",
      },
      url: "/api/users",
    });

    expect(res.statusCode).toBe(201);
    expect(userServiceMocks.createUser).toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/ponto/config`);
    expect(init.method).toBe("PUT");
  });

  it("editar campos que entram na escala dispara o push", async () => {
    fetchMock.mockImplementation(() => cloudJson({ ok: true }));
    const app = buildApp(fakePrisma());

    const res = await app.inject({
      method: "PATCH",
      payload: {
        externalWork: true,
        phoneE164: "+351911111111",
        pontoEnabled: true,
      },
      url: "/api/users/user-1",
    });

    expect(res.statusCode).toBe(200);
    expect(userServiceMocks.updateUserProfileService).toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("desativar utilizador dispara o push mesmo sem editar campos de ponto", async () => {
    fetchMock.mockImplementation(() => cloudJson({ ok: true }));
    const app = buildApp(fakePrisma());

    const res = await app.inject({
      method: "PATCH",
      payload: { isActive: false },
      url: "/api/users/user-1/status",
    });

    expect(res.statusCode).toBe(200);
    expect(userServiceMocks.toggleStatus).toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("edição só de perfil (sem campos da escala) não envia staff à Cloud", async () => {
    const app = buildApp(fakePrisma());

    const res = await app.inject({
      method: "PATCH",
      payload: { name: "Nome Novo" },
      url: "/api/users/user-1",
    });

    expect(res.statusCode).toBe(200);
    await flushAsyncWork();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha da Cloud não quebra a mutação local do utilizador", async () => {
    fetchMock.mockRejectedValue(new Error("net down"));
    const app = buildApp(fakePrisma());

    const res = await app.inject({
      method: "PATCH",
      payload: {
        phoneE164: "+351911111111",
        pontoEnabled: true,
      },
      url: "/api/users/user-1",
    });

    expect(res.statusCode).toBe(200);
    expect(userServiceMocks.updateUserProfileService).toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
