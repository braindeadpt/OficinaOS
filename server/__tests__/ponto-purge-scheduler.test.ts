import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPontoPurgeScheduler } from "../jobs/ponto-purge-scheduler.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeApp(queryRaw: ReturnType<typeof vi.fn>) {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  return {
    app: {
      log,
      prisma: { $queryRaw: queryRaw },
    } as never,
    log,
  };
}

describe("startPontoPurgeScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("chama a função SECURITY DEFINER no arranque e depois 1×/dia", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const { app } = makeApp(queryRaw);

    const stop = startPontoPurgeScheduler(app);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    expect([...sql]).toEqual(["SELECT ponto_purge_expired()"]);

    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);

    stop();
  });

  it("não sobrepõe ticks enquanto a purga anterior ainda corre", async () => {
    let finishFirst!: (value: unknown[]) => void;
    const queryRaw = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockResolvedValue([]);
    const { app } = makeApp(queryRaw);

    const stop = startPontoPurgeScheduler(app);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    finishFirst([]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(queryRaw).toHaveBeenCalledTimes(2);

    stop();
  });

  it("falha de permissões/grants fica registada e não derruba o scheduler", async () => {
    const err = new Error("permission denied for function ponto_purge_expired");
    const queryRaw = vi.fn().mockRejectedValueOnce(err).mockResolvedValue([]);
    const { app, log } = makeApp(queryRaw);

    const stop = startPontoPurgeScheduler(app);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.warn).toHaveBeenCalledWith(
      { err },
      "ponto purge scheduler tick failed"
    );

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(queryRaw).toHaveBeenCalledTimes(2);

    stop();
  });
});
