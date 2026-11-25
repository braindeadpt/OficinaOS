import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(
    async (
      _apiUrl: string,
      _path: string,
      _init: { body?: unknown; method?: string; token?: string }
    ) => ({ body: {}, ok: true, status: 200 })
  ),
  canReplayStaffInboxTool: vi.fn(
    async (_prisma: unknown, _tool: string, _userId: string) => true
  ),
  runStaffInboxTool: vi.fn(
    async (
      _prisma: unknown,
      _log: unknown,
      _input: { signal?: AbortSignal }
    ) => ({ result: { ok: true } })
  ),
}));

vi.mock("../services/cloud.service.js", () => ({
  cloudFetch: mocks.cloudFetch,
}));

vi.mock("../services/staff-inbox-tools.js", () => ({
  canReplayStaffInboxTool: mocks.canReplayStaffInboxTool,
  runStaffInboxTool: mocks.runStaffInboxTool,
}));

vi.mock("../services/inbox.service.js", () => ({
  cleanupInboxRetention: vi.fn(async () => undefined),
}));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: vi.fn(async () => null),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: vi.fn((value: string) => value),
}));

const { handleCall } = await import("../jobs/ai-inbox-link.js");

const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
const app = { log, prisma: {} } as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function responseBodies() {
  return mocks.cloudFetch.mock.calls.map((call) => {
    const init = call[2] as { body: Record<string, unknown> };
    return init.body;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ai-inbox link — idempotência e cancelamento", () => {
  it("mesma idempotencyKey concorrente executa 1 vez e responde igual aos dois callIds", async () => {
    const key = "test-key-concurrent";
    const execution = deferred<{ result: { ok: boolean } }>();
    mocks.runStaffInboxTool.mockImplementationOnce(() => execution.promise);
    const frame = {
      args: { rascunhoId: "draft-1" },
      idempotencyKey: key,
      tool: "enviar_rascunho",
      userId: "u-owner",
    };
    const first = handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "call-1",
    });
    const second = handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "call-2",
    });
    expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(1);
    execution.resolve({ result: { ok: true } });
    await Promise.all([first, second]);

    const bodies = responseBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.callId).sort()).toEqual([
      "call-1",
      "call-2",
    ]);
    for (const body of bodies) {
      expect(body.result).toEqual({ ok: true });
    }

    // Completed dentro do TTL: replay sem nova execução.
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "call-3",
    });
    expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(1);
    expect(responseBodies()).toHaveLength(3);
    expect(responseBodies()[2]).toMatchObject({
      callId: "call-3",
      result: { ok: true },
    });
  });

  it("depois do TTL a mesma idempotencyKey executa de novo", async () => {
    vi.useFakeTimers();
    try {
      const key = "test-key-expiry";
      const firstExecution = deferred<{ result: { ok: boolean } }>();
      mocks.runStaffInboxTool.mockImplementationOnce(
        () => firstExecution.promise
      );
      const first = handleCall(app, "https://cloud.example", "tok", {
        args: {},
        callId: "expiry-1",
        idempotencyKey: key,
        tool: "procurar",
        userId: "u-owner",
      });
      firstExecution.resolve({ result: { ok: true } });
      await first;
      expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      const secondExecution = deferred<{ result: { ok: boolean } }>();
      mocks.runStaffInboxTool.mockImplementationOnce(
        () => secondExecution.promise
      );
      const second = handleCall(app, "https://cloud.example", "tok", {
        args: {},
        callId: "expiry-2",
        idempotencyKey: key,
        tool: "procurar",
        userId: "u-owner",
      });
      expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(2);
      secondExecution.resolve({ result: { ok: true } });
      await second;
    } finally {
      vi.useRealTimers();
    }
  });

  it("timeout do handleCall aborta o signal da execução", async () => {
    vi.useFakeTimers();
    try {
      let seenSignal: AbortSignal | undefined;
      mocks.runStaffInboxTool.mockImplementationOnce(
        (_prisma: unknown, _log: unknown, input: { signal?: AbortSignal }) => {
          seenSignal = input.signal;
          return new Promise(() => undefined);
        }
      );
      const pending = handleCall(app, "https://cloud.example", "tok", {
        args: {},
        callId: "timeout-1",
        tool: "enviar_rascunho",
        userId: "u-owner",
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      expect(seenSignal?.aborted).toBe(true);
      expect(responseBodies()[0]).toEqual({
        callId: "timeout-1",
        error: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resultado concluído repete-se sem re-executar enquanto a conta continua ativa", async () => {
    const frame = {
      args: { q: "ana" },
      idempotencyKey: "test-key-replay-ok",
      tool: "procurar",
      userId: "u-owner",
    };
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "replay-ok-1",
    });
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "replay-ok-2",
    });
    expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(1);
    expect(mocks.canReplayStaffInboxTool).toHaveBeenCalledWith(
      {},
      "procurar",
      "u-owner"
    );
    expect(responseBodies()).toEqual([
      { callId: "replay-ok-1", result: { ok: true } },
      { callId: "replay-ok-2", result: { ok: true } },
    ]);
  });

  it("conta desativada depois da 1.ª chamada não recebe o resultado em cache", async () => {
    const frame = {
      args: { q: "ana" },
      idempotencyKey: "test-key-replay-deactivated",
      tool: "procurar",
      userId: "u-gone",
    };
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "deact-1",
    });
    mocks.canReplayStaffInboxTool.mockResolvedValueOnce(false);
    mocks.runStaffInboxTool.mockResolvedValueOnce({
      error: "conta desativada",
    } as never);
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "deact-2",
    });
    expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(2);
    expect(responseBodies()[1]).toEqual({
      callId: "deact-2",
      error: "conta desativada",
    });
  });

  it("falha a revalidar a conta no replay mantém a cache e não re-executa", async () => {
    const frame = {
      args: { conversaId: "conv-1", texto: "olá" },
      idempotencyKey: "test-key-replay-db-error",
      tool: "rascunhar_resposta",
      userId: "u-owner",
    };
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "dberr-1",
    });
    mocks.canReplayStaffInboxTool.mockRejectedValueOnce(new Error("db down"));
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "dberr-2",
    });
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "dberr-3",
    });
    expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(1);
    expect(responseBodies()).toEqual([
      { callId: "dberr-1", result: { ok: true } },
      { callId: "dberr-2", error: "erro interno" },
      { callId: "dberr-3", result: { ok: true } },
    ]);
  });

  it("resultado cancelado não fica em cache — o retry volta a executar", async () => {
    const frame = {
      args: { rascunhoId: "draft-c" },
      idempotencyKey: "test-key-cancelled",
      tool: "enviar_rascunho",
      userId: "u-owner",
    };
    mocks.runStaffInboxTool.mockResolvedValueOnce({
      error: "cancelado",
    } as never);
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "cancel-1",
    });
    await handleCall(app, "https://cloud.example", "tok", {
      ...frame,
      callId: "cancel-2",
    });
    expect(mocks.runStaffInboxTool).toHaveBeenCalledTimes(2);
    expect(mocks.canReplayStaffInboxTool).not.toHaveBeenCalled();
    expect(responseBodies()).toEqual([
      { callId: "cancel-1", error: "cancelado" },
      { callId: "cancel-2", result: { ok: true } },
    ]);
  });
});
