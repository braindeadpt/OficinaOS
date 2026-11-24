import { describe, expect, it, vi } from "vitest";

// Fila de validação do livro de ponto: uma linha já corrigida (a
// correção é outra entrada — aprovada ou ela própria pendente) não
// pode continuar na fila — validá-la já não muda o apuramento e
// escondia a correção que realmente precisa de decisão.

import type { DbClient } from "../../repositories/types.js";
import { listPending } from "../ponto-panel.service.js";

describe("listPending", () => {
  it("exclui linhas já corrigidas da fila de validação", async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const prisma = {
      timeEntry: { findMany },
    } as unknown as DbClient;

    const rows = await listPending(prisma);

    expect(rows).toEqual([]);
    const call = findMany.mock.calls[0] as unknown[] | undefined;
    const where = (call?.[0] as { where: object }).where;
    expect(where).toMatchObject({
      corrections: { none: {} },
      status: "POR_VALIDAR",
      validations: { none: {} },
    });
  });
});
