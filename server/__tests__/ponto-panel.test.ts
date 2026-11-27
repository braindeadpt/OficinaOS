import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/crypto.js";
import { __resetTzCache } from "../middlewares/dashboard-scope.js";
import { pontoRoutes } from "../routes/ponto.js";
import {
  effectiveStatusOf,
  isSuperseded,
  localDateKey,
  resolvePontoRange,
  usableEntries,
} from "../services/ponto-panel.service.js";
import { localDayRange } from "../utils/time-range.js";

const CLOUD_URL = "https://cloud.test";

function baseSettings() {
  return {
    cloudApiUrl: CLOUD_URL,
    cloudEntitlements: ["ponto"],
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    cloudSyncedAt: new Date(),
    pontoGeoLat: 38.72,
    pontoGeoLng: -9.14,
    pontoRadiusM: 100,
    pontoSmsNumber: "+351210000000",
    pontoWaNumber: "+351912345678",
    timezone: "Europe/Lisbon",
  };
}

interface FakePrismaOpts {
  entries?: unknown[];
  missingExitRows?: unknown[];
  pendingEntryId?: string;
  shopMode?: string;
  users?: unknown[];
  validations?: unknown[];
}

function fakePrisma(opts: FakePrismaOpts = {}) {
  const settings = baseSettings();
  return {
    shopSettings: {
      findFirst: vi.fn(async () => ({ timezone: settings.timezone })),
      findUnique: vi.fn(async () => ({
        ...settings,
        shopMode: opts.shopMode ?? "repair_shop",
      })),
    },
    timeEntry: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "new-entry",
        ...args.data,
      })),
      findMany: vi.fn(async () => opts.entries ?? []),
      findUnique: vi.fn(async () =>
        opts.pendingEntryId ? { id: opts.pendingEntryId } : null
      ),
    },
    timeEntryValidation: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        at: new Date("2026-01-15T10:00:00Z"),
        byUser: { name: "Boss", username: "boss" },
        decision: args.data.decision,
        id: "val1",
        note: args.data.note ?? null,
      })),
    },
    user: {
      findMany: vi.fn(async () => opts.users ?? []),
      findUnique: vi.fn(async () => ({ id: "u-target" })),
    },
  };
}

function buildApp(
  prisma: unknown,
  user: { id: string; role: string } | null = { id: "u1", role: "OWNER" }
) {
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
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = user;
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(pontoRoutes, { prefix: "/api/ponto" });
  return app;
}

interface TestEntry {
  at: Date;
  corrections: unknown[];
  id: string;
  status: "APROVADO" | "POR_VALIDAR";
  type: "ENTRADA" | "PAUSA" | "VOLTEI" | "SAIDA";
  validations: { decision: "APROVADO" | "RECUSADO" }[];
  [key: string]: unknown;
}

function entryRow(
  overrides: Partial<TestEntry> & Record<string, unknown> = {}
): TestEntry {
  return {
    at: new Date("2026-01-15T09:00:00Z"),
    corrects: null,
    correctsId: null,
    corrections: [],
    createdAt: new Date("2026-01-15T09:00:01Z"),
    createdBy: null,
    createdById: null,
    id: "e1",
    proofs: {},
    reason: null,
    status: "APROVADO",
    transport: "WHATSAPP_META",
    type: "ENTRADA",
    user: {
      id: "u1",
      name: "Ana",
      phoneE164: "+351912345678",
      username: "ana",
    },
    userId: "u1",
    validations: [],
    ...overrides,
  } as TestEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetTzCache();
});

afterEach(() => {
  __resetTzCache();
});

// ── Lógica pura: status efetivo / correções ─────────────────────────────

describe("ponto-panel — effective status", () => {
  it("uses the machine status when there are no validations", () => {
    const e = entryRow({ status: "POR_VALIDAR" });
    expect(effectiveStatusOf(e)).toBe("POR_VALIDAR");
    expect(usableEntries([e])).toHaveLength(1);
  });

  it("latest validation wins (append-only re-validation)", () => {
    const e = entryRow({
      status: "POR_VALIDAR",
      validations: [
        { decision: "RECUSADO" }, // mais recente primeiro (ordem da query)
        { decision: "APROVADO" },
      ],
    });
    expect(effectiveStatusOf(e)).toBe("RECUSADO");
    expect(usableEntries([e])).toHaveLength(0);
  });

  it("a corrected entry leaves the calculations; the correction stays", () => {
    const original = entryRow({ id: "e-old" });
    const corrected = entryRow({
      corrects: { at: original.at, id: "e-old", type: "ENTRADA" },
      correctsId: "e-old",
      corrections: [],
      id: "e-new",
    });
    const superseded = entryRow({
      corrections: [{ at: corrected.at, id: "e-new", type: "ENTRADA" }],
      id: "e-old",
    });
    expect(isSuperseded(superseded)).toBe(true);
    const usable = usableEntries([superseded, corrected]);
    expect(usable.map((u) => u.id)).toEqual(["e-new"]);
    expect(original).toBeDefined();
  });
});

// ── Lógica pura: ranges e photos ────────────────────────────────────────

describe("ponto-panel — ranges", () => {
  it("localDayRange returns shop-local day bounds in UTC instants", () => {
    const r = localDayRange("Europe/Lisbon", "2026-01-15");
    expect(r.start.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });

  it("resolvePontoRange defaults to the last 30 days ending today", () => {
    const r = resolvePontoRange(undefined, undefined, "UTC");
    expect(r.toDate <= new Date().toISOString().slice(0, 10)).toBe(true);
    expect(r.fromDate < r.toDate).toBe(true);
  });
});

// ── Rotas ───────────────────────────────────────────────────────────────

describe("ponto panel — GET /now", () => {
  it("401 without a session", async () => {
    const app = buildApp(fakePrisma(), null);
    const res = await app.inject({ method: "GET", url: "/api/ponto/now" });
    expect(res.statusCode).toBe(401);
  });

  it("derives each worker's state from today's usable entries", async () => {
    const now = new Date();
    const prisma = fakePrisma({
      entries: [
        entryRow({
          at: now,
          id: "e-in",
          type: "ENTRADA",
          userId: "u1",
          user: { id: "u1", name: "Ana", phoneE164: null, username: "ana" },
        }),
        entryRow({
          at: new Date(now.getTime() - 3_600_000),
          id: "e-out",
          type: "SAIDA",
          userId: "u2",
          user: { id: "u2", name: "Bruno", phoneE164: null, username: "bruno" },
        }),
      ],
      users: [
        { id: "u1", name: "Ana", phoneE164: null, username: "ana" },
        { id: "u2", name: "Bruno", phoneE164: null, username: "bruno" },
        { id: "u3", name: "Carla", phoneE164: null, username: "carla" },
      ],
    });
    // entries precisam do userId correto — entryRow fixa userId u1; ajustar:
    (prisma.timeEntry.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      async () => [
        {
          ...entryRow({ at: now, id: "e-in", type: "ENTRADA", userId: "u1" }),
          user: { id: "u1", name: "Ana", phoneE164: null, username: "ana" },
        },
        {
          ...entryRow({
            at: new Date(now.getTime() - 3_600_000),
            id: "e-out",
            type: "SAIDA",
            userId: "u2",
          }),
          user: { id: "u2", name: "Bruno", phoneE164: null, username: "bruno" },
        },
      ]
    );
    const app = buildApp(prisma);
    const res = await app.inject({ method: "GET", url: "/api/ponto/now" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byId = Object.fromEntries(
      body.map((u: { userId: string }) => [u.userId, u])
    );
    expect(byId.u1.state).toBe("a_trabalhar");
    expect(byId.u2.state).toBe("saiu");
    expect(byId.u3.state).toBe("sem_registo");
  });
});

describe("ponto panel — GET /pending + POST validate", () => {
  it("lists pending entries without photo urls — only the temporal proof", async () => {
    const prisma = fakePrisma({
      entries: [
        entryRow({
          id: "pend1",
          proofs: {
            distanceM: 42,
            hasPhoto: true,
            photoSentAt: "2026-01-15T09:00:00.000Z",
          },
          status: "POR_VALIDAR",
          validations: [],
        }),
      ],
      pendingEntryId: "pend1",
    });
    const app = buildApp(prisma);
    const res = await app.inject({ method: "GET", url: "/api/ponto/pending" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].effectiveStatus).toBe("POR_VALIDAR");
    expect(body[0].proofs.photoSentAt).toBe("2026-01-15T09:00:00.000Z");
    expect(body[0]).not.toHaveProperty("photos");
    expect(body[0].proofs).not.toHaveProperty("photoId");
  });

  it("validate appends a decision and returns the effective status", async () => {
    const prisma = fakePrisma({ pendingEntryId: "pend1" });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/entries/pend1/validate",
      payload: { decision: "APROVADO", note: "ok" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().effectiveStatus).toBe("APROVADO");
    expect(prisma.timeEntryValidation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          byUserId: "u1",
          decision: "APROVADO",
          entryId: "pend1",
          note: "ok",
        }),
      })
    );
  });

  it("validate 404s on unknown entry", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/entries/nope/validate",
      payload: { decision: "APROVADO" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("ponto panel — POST /entries (manual)", () => {
  it("creates an approved MANUAL entry credited to the actor", async () => {
    const prisma = fakePrisma({ entries: [entryRow({ id: "new-entry" })] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/entries",
      payload: {
        at: "2026-01-15T18:00:00.000Z",
        reason: "forgot clock-out",
        type: "SAIDA",
        userId: "u-target",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdById: "u1",
          reason: "forgot clock-out",
          status: "APROVADO",
          transport: "MANUAL",
          type: "SAIDA",
          userId: "u-target",
        }),
      })
    );
  });

  it("rejects a correction pointing at another worker's entry", async () => {
    const prisma = fakePrisma();
    // user.findUnique devolve sempre {id:"u-target"}; o lookup do alvo da
    // correção (timeEntry.findUnique) devolve uma entry de OUTRO worker.
    (prisma.timeEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        id: "corr",
        userId: "someone-else",
      }
    );
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/entries",
      payload: {
        at: "2026-01-15T18:00:00.000Z",
        correctsId: "corr",
        type: "SAIDA",
        userId: "u-target",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("ponto panel — GET /hours + /missing-exits", () => {
  const entrada = entryRow({
    at: new Date("2026-01-15T09:00:00Z"),
    id: "e1",
    type: "ENTRADA",
  });
  const saida = entryRow({
    at: new Date("2026-01-15T17:00:00Z"),
    id: "e2",
    type: "SAIDA",
  });

  it("computes worked minutes excluding pauses", async () => {
    const pausa = entryRow({
      at: new Date("2026-01-15T12:00:00Z"),
      id: "e3",
      type: "PAUSA",
    });
    const voltei = entryRow({
      at: new Date("2026-01-15T13:00:00Z"),
      id: "e4",
      type: "VOLTEI",
    });
    const prisma = fakePrisma({ entries: [entrada, pausa, voltei, saida] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/ponto/hours?from=2026-01-15&to=2026-01-15",
    });
    expect(res.statusCode).toBe(200);
    const day = res.json().days[0];
    // 9→12 (180) + 13→17 (240) = 420 min
    expect(day.hours.workedMinutes).toBe(420);
    expect(day.hours.missingExit).toBe(false);
  });

  it("um mês com correções produz as mesmas horas em oficina e só-ponto", async () => {
    const original = entryRow({
      at: new Date("2026-01-15T09:00:00Z"),
      corrections: [
        {
          at: new Date("2026-01-15T09:30:00Z"),
          id: "e-correction",
          type: "ENTRADA",
        },
      ],
      id: "e-original",
      type: "ENTRADA",
    });
    const correction = entryRow({
      at: new Date("2026-01-15T09:30:00Z"),
      corrects: { at: original.at, id: "e-original", type: "ENTRADA" },
      correctsId: "e-original",
      id: "e-correction",
      type: "ENTRADA",
    });
    const bodies: unknown[] = [];
    for (const shopMode of ["repair_shop", "ponto_only"]) {
      const prisma = fakePrisma({
        entries: [original, correction, saida],
        shopMode,
      });
      const res = await buildApp(prisma).inject({
        method: "GET",
        url: "/api/ponto/hours?from=2026-01-15&to=2026-01-15",
      });
      expect(res.statusCode).toBe(200);
      bodies.push(res.json());
      expect(res.json().days[0].hours.workedMinutes).toBe(450);
      expect(res.json().days[0].hours.hasCorrection).toBe(true);
    }
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it("flags a day whose last event is not SAIDA", async () => {
    const prisma = fakePrisma({ entries: [entrada] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/ponto/missing-exits?from=2026-01-15&to=2026-01-15",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].userId).toBe("u1");
    expect(body[0].lastType).toBe("ENTRADA");
  });

  it("turno overnight NÃO emparelha: corta no fim do dia civil (decisão 2026-11-25)", async () => {
    // ENTRADA 22:00 → SAIDA 07:00 do dia seguinte. Sem overnight (§2.2):
    // o dia da entrada corta à meia-noite e fica esquecimento para o
    // gestor fechar à mão; a saída do dia seguinte fica órfã.
    const nightIn = entryRow({
      at: new Date("2025-06-10T22:00:00Z"),
      id: "n1",
      type: "ENTRADA",
    });
    const nightOut = entryRow({
      at: new Date("2025-06-11T07:00:00Z"),
      id: "n2",
      type: "SAIDA",
    });
    const prisma = fakePrisma({ entries: [nightIn, nightOut] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/ponto/hours?from=2025-06-10&to=2025-06-11",
    });
    expect(res.statusCode).toBe(200);
    const days = res.json().days;
    const total = days.reduce(
      (acc: number, d: { hours: { workedMinutes: number } }) =>
        acc + d.hours.workedMinutes,
      0
    );
    // Em Lisboa (UTC+1 em junho) a entrada é 23:00 local: 23:00→24:00
    // = 60 min no dia da entrada; nada no dia seguinte.
    expect(total).toBe(60);
    const diaEntrada = days.find(
      (d: { date: string }) => d.date === "2025-06-10"
    );
    expect(diaEntrada.hours.missingExit).toBe(true);

    const miss = await app.inject({
      method: "GET",
      url: "/api/ponto/missing-exits?from=2025-06-10&to=2025-06-11",
    });
    expect(miss.statusCode).toBe(200);
    // O dia da entrada aparece como saída em falta — um fecho no dia
    // civil seguinte nunca resolve.
    expect(
      miss.json().some((m: { date: string }) => m.date === "2025-06-10")
    ).toBe(true);
  });

  it("caps a forgotten-exit shift at day end; a next-day ENTRADA opens a new shift", async () => {
    // Ana entra seg 09:00 e esquece a saída; ter entra 09:00 e sai 17:00
    // (UTC = hora da loja em janeiro, Europe/Lisbon).
    const prisma = fakePrisma({
      entries: [
        entryRow({
          at: new Date("2026-01-12T09:00:00Z"),
          id: "m1",
          type: "ENTRADA",
        }),
        entryRow({
          at: new Date("2026-01-13T09:00:00Z"),
          id: "t1",
          type: "ENTRADA",
        }),
        entryRow({
          at: new Date("2026-01-13T17:00:00Z"),
          id: "t2",
          type: "SAIDA",
        }),
      ],
    });
    const app = buildApp(prisma);

    // Relatório só de terça: 8h — antes contava as 17h desde seg 00:00.
    const tueOnly = await app.inject({
      method: "GET",
      url: "/api/ponto/hours?from=2026-01-13&to=2026-01-13",
    });
    expect(tueOnly.json().days[0].hours.workedMinutes).toBe(480);

    const res = await app.inject({
      method: "GET",
      url: "/api/ponto/hours?from=2026-01-12&to=2026-01-13",
    });
    const byDate = Object.fromEntries(
      res
        .json()
        .days.map(
          (d: {
            date: string;
            hours: { missingExit: boolean; workedMinutes: number };
          }) => [d.date, d]
        )
    );
    // Seg: o turno por fechar conta até ao fim do PRÓPRIO dia (15h)…
    expect(byDate["2026-01-12"].hours.workedMinutes).toBe(900);
    // …e a saída esquecida continua assinalada — a ENTRADA de terça não
    // a resolve, ao contrário da SAIDA de um turno overnight.
    expect(byDate["2026-01-12"].hours.missingExit).toBe(true);
    expect(byDate["2026-01-13"].hours.missingExit).toBe(false);

    const miss = await app.inject({
      method: "GET",
      url: "/api/ponto/missing-exits?from=2026-01-12&to=2026-01-13",
    });
    expect(miss.json().map((m: { date: string }) => m.date)).toEqual([
      "2026-01-12",
    ]);
  });

  it("does not flag the current civil day as a missing exit", async () => {
    const prisma = fakePrisma({
      entries: [
        entryRow({
          at: new Date(),
          id: "today-in",
          type: "ENTRADA",
        }),
      ],
    });
    const app = buildApp(prisma);
    const todayKey = localDateKey("Europe/Lisbon", new Date());
    const ymd = (offsetDays: number) =>
      new Date(Date.parse(`${todayKey}T00:00:00Z`) + offsetDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const res = await app.inject({
      method: "GET",
      url: `/api/ponto/missing-exits?from=${ymd(-1)}&to=${ymd(1)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(
      res.json().filter((m: { date: string }) => m.date === todayKey)
    ).toHaveLength(0);
  });
});

describe("ponto panel — GET /photos/:id", () => {
  it("photo serving route no longer exists", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "GET",
      url: "/api/ponto/photos/nope",
    });
    expect(res.statusCode).toBe(404);
  });
});
