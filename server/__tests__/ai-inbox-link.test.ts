import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(
    async (
      _apiUrl: string,
      _path: string,
      _init: { body?: unknown; method?: string; token?: string }
    ) => ({ body: {}, ok: true, status: 200 })
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
});
