import { beforeEach, describe, expect, it, vi } from "vitest";
import { findPontoStaff } from "../staff.js";

// Resolver telefone→User ponto — espelha findCustomersByPhone: dígitos,
// prefixo "00" fora, PT-like (9 dígitos ou 351+12) com fallback de
// sufixo de 9 dígitos só entre candidatos PT. Só pontoEnabled=true.

const STAFF = {
  externalWork: false,
  id: "user-1",
  name: "Rui Silva",
  phoneE164: "+351912345678",
  pontoSmsAllowed: false,
  username: "rui",
};

function makePrisma(users: unknown[]) {
  return {
    user: {
      findMany: vi.fn(async () => users),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("findPontoStaff — correspondência de telefone", () => {
  it("E.164 exato casa independentemente do formato do remetente", async () => {
    const prisma = makePrisma([STAFF]);
    const m = await findPontoStaff(prisma as never, "+351 912 345 678");
    expect(m?.user.id).toBe("user-1");
    expect(m?.phoneDigits).toBe("351912345678");
  });

  it("remetente sem indicativo casa por sufixo de 9 dígitos (PT)", async () => {
    const prisma = makePrisma([STAFF]);
    const m = await findPontoStaff(prisma as never, "912345678");
    expect(m?.user.id).toBe("user-1");
  });

  it("prefixo internacional 00 é removido antes de comparar", async () => {
    const prisma = makePrisma([STAFF]);
    const m = await findPontoStaff(prisma as never, "00351912345678");
    expect(m?.user.id).toBe("user-1");
  });

  it("filtro DB pede pontoEnabled=true e sufixo de 4 dígitos", async () => {
    const prisma = makePrisma([]);
    await findPontoStaff(prisma as never, "351912345678");
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phoneE164: { endsWith: "5678" },
          pontoEnabled: true,
        },
      })
    );
  });

  it("sufixo de 9 dígitos só casa entre candidatos PT", async () => {
    // foreign tem os MESMOS últimos 9 dígitos que o staff PT mas não é
    // PT-like (55… não começa por 351): nunca pode ser o staff certo.
    const foreign = {
      ...STAFF,
      id: "user-foreign",
      phoneE164: "+5511912345678", // últimos 9 = "912345678"
    };
    const prisma = makePrisma([foreign]);
    expect(await findPontoStaff(prisma as never, "912345678")).toBeNull();

    // Com os dois na lista, só o PT casa.
    const both = makePrisma([foreign, STAFF]);
    const m = await findPontoStaff(both as never, "912345678");
    expect(m?.user.id).toBe("user-1");
  });

  it("número demasiado curto não chega à BD", async () => {
    const prisma = makePrisma([STAFF]);
    const m = await findPontoStaff(prisma as never, "123");
    expect(m).toBeNull();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("sem candidatos → null", async () => {
    const prisma = makePrisma([]);
    expect(await findPontoStaff(prisma as never, "351999999999")).toBeNull();
  });

  it("candidato com phoneE164 null é ignorado", async () => {
    const prisma = makePrisma([{ ...STAFF, phoneE164: null }]);
    expect(await findPontoStaff(prisma as never, "351912345678")).toBeNull();
  });
});
