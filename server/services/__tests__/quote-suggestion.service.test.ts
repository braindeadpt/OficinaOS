import { describe, expect, it } from "vitest";
import {
  buildQuoteSuggestion,
  type QuoteDeviceInput,
  type QuoteDiagnosticInput,
  type QuotePartInput,
  type QuoteRepairInput,
} from "../quote-suggestion.service";

const DEVICES: QuoteDeviceInput[] = [
  { brandName: "Apple", id: "dev-iphone15", model: "iPhone 15" },
  { brandName: "Apple", id: "dev-iphone15pro", model: "iPhone 15 Pro" },
  { brandName: "Samsung", id: "dev-s24", model: "Galaxy S24" },
];

const PARTS: QuotePartInput[] = [
  {
    category: "BATTERY",
    defaultPrice: 29.9,
    id: "part-battery",
    name: "Bateria iPhone 15",
    stockQuantity: 4,
  },
  {
    category: "SCREEN",
    defaultPrice: 89,
    id: "part-screen",
    name: "Ecrã iPhone 15",
    stockQuantity: 0,
  },
  {
    category: "CHARGING_PORT",
    defaultPrice: 15.5,
    id: "part-charge",
    name: "Conector de carga USB-C",
    stockQuantity: 2,
  },
  {
    category: "CAMERA",
    defaultPrice: 45,
    id: "part-camera",
    name: "Câmara traseira",
    stockQuantity: 1,
  },
];

const REPAIRS: QuoteRepairInput[] = [
  {
    category: "HARDWARE",
    defaultPrice: 25,
    id: "rep-battery",
    name: "Troca de bateria",
  },
  {
    category: "HARDWARE",
    defaultPrice: 40,
    id: "rep-screen",
    name: "Troca de ecrã",
  },
  {
    category: "HARDWARE",
    defaultPrice: 30,
    id: "rep-charge",
    name: "Troca de conector de carga",
  },
  {
    category: "SOFTWARE",
    defaultPrice: 20,
    id: "rep-format",
    name: "Formatação / software",
  },
  {
    category: "DIAGNOSTIC",
    defaultPrice: 10,
    id: "rep-diag",
    name: "Diagnóstico",
  },
];

function diag(
  results: Record<string, unknown>,
  overrides: Partial<QuoteDiagnosticInput> = {}
): QuoteDiagnosticInput {
  return {
    device: { brand: "Apple", model: "iPhone 15" },
    ...overrides,
    results,
  };
}

function build(
  diagnostic: QuoteDiagnosticInput,
  overrides: {
    devices?: QuoteDeviceInput[];
    parts?: QuotePartInput[];
    repairs?: QuoteRepairInput[];
  } = {}
) {
  return buildQuoteSuggestion({
    devices: overrides.devices ?? DEVICES,
    diagnostic,
    parts: overrides.parts ?? PARTS,
    repairs: overrides.repairs ?? REPAIRS,
  });
}

describe("buildQuoteSuggestion — gates", () => {
  it("returns empty for purpose=sale", () => {
    const s = build(
      diag({ "battery.health": { Status: "fail" } }, { purpose: "sale" })
    );
    expect(s.skippedReason).toBe("purpose-sale");
    expect(s.lines).toEqual([]);
    expect(s.unmatchedChecks).toEqual([]);
    expect(s.deviceMatch).toBeNull();
  });

  it("returns empty when no check is fail/warn (pass/info/skipped only)", () => {
    const s = build(
      diag({
        "battery.health": { Status: "pass" },
        "service.template": { Status: "info", Value: "battery" },
        "suggest.parts": { Status: "info", Value: "bateria" },
        "test.touch": { Status: "skipped" },
      })
    );
    expect(s.skippedReason).toBe("no-fail-warn-checks");
    expect(s.lines).toEqual([]);
  });
});

describe("buildQuoteSuggestion — hardware checks", () => {
  it("maps a battery check to the BATTERY part and a HARDWARE repair", () => {
    const s = build(
      diag({ "battery.health": { Status: "fail", Value: "85%" } })
    );

    expect(s.deviceMatch).toMatchObject({
      confidence: "high",
      model: "iPhone 15",
    });

    const part = s.lines.find((l) => l.kind === "part");
    expect(part).toMatchObject({
      catalogId: "part-battery",
      inStock: true,
      kind: "part",
      name: "Bateria iPhone 15",
      priceCents: 2990,
      reasonCheck: "battery.health",
      reasonStatus: "fail",
    });

    const repair = s.lines.find((l) => l.kind === "repair");
    expect(repair).toMatchObject({
      catalogId: "rep-battery",
      inStock: true,
      kind: "repair",
      name: "Troca de bateria",
      priceCents: 2500,
      reasonCheck: "battery.health",
    });

    expect(s.unmatchedChecks).toEqual([]);
  });

  it("maps a touch check to SCREEN and flags out-of-stock parts", () => {
    const s = build(diag({ "test.touch": { Status: "warn" } }));

    const part = s.lines.find((l) => l.kind === "part");
    expect(part).toMatchObject({
      catalogId: "part-screen",
      inStock: false, // stockQuantity 0 → "sob encomenda"
      reasonCheck: "test.touch",
      reasonStatus: "warn",
    });

    const repair = s.lines.find((l) => l.kind === "repair");
    expect(repair?.catalogId).toBe("rep-screen");
  });

  it("maps charging checks to CHARGING_PORT and tpl.battery.* to BATTERY", () => {
    const s = build(
      diag({
        "checklist.charge_port": { Status: "fail" },
        "tpl.battery.function": { Status: "fail" },
      })
    );

    const charge = s.lines.find((l) => l.catalogId === "part-charge");
    expect(charge).toMatchObject({
      inStock: true,
      reasonCheck: "checklist.charge_port",
    });

    // tpl.battery.function feeds the same BATTERY candidates as battery.* —
    // the part line merges both reasons.
    const battery = s.lines.find((l) => l.catalogId === "part-battery");
    expect(battery?.reasonCheck).toContain("tpl.battery.function");
    expect(s.unmatchedChecks).toEqual([]);
  });
});

describe("buildQuoteSuggestion — matching confidence", () => {
  it("marks contains-matches as low confidence", () => {
    // Device "iPhone 15 Pro" não aparece nos nomes das peças — os matches
    // por hint continuam contains → low (sem boost de modelo).
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone 15 Pro" } }
      )
    );
    expect(s.lines.every((l) => l.confidence === "low")).toBe(true);
  });

  it("marks equals-matches as high confidence", () => {
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-exact",
        name: "Bateria",
        stockQuantity: 1,
      },
    ];
    const s = build(diag({ "battery.health": { Status: "fail" } }), { parts });
    expect(s.lines.find((l) => l.kind === "part")?.confidence).toBe("high");
  });

  it("matches the device by marketingName when model is a hardware code", () => {
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        {
          device: {
            brand: "apple", // case-insensitive brand
            marketingName: "iPhone 15 Pro",
            model: "MLX12345",
          },
        }
      )
    );
    expect(s.deviceMatch).toMatchObject({
      confidence: "high",
      deviceId: "dev-iphone15pro",
      model: "iPhone 15 Pro",
    });
  });

  it("returns low-confidence deviceMatch with candidates on contains", () => {
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone" } }
      )
    );
    expect(s.deviceMatch?.confidence).toBe("low");
    expect(s.candidates?.length).toBeGreaterThan(0);
    expect(s.candidates?.length).toBeLessThanOrEqual(5);
    // Low confidence still allows hardware lines — staff picks the model.
    expect(s.lines.length).toBeGreaterThan(0);
  });

  it("lets a marketingName match win over a later exact model code", () => {
    // marketingName "iPhone" só corresponde de forma aproximada, mas tem
    // prioridade sobre o model "iPhone 15" (que seria exact) — o catálogo
    // da loja usa nomes comerciais, não códigos internos.
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        {
          device: {
            brand: "Apple",
            marketingName: "iPhone",
            model: "iPhone 15",
          },
        }
      )
    );
    expect(s.deviceMatch?.confidence).toBe("low");
    expect(s.candidates?.length).toBeGreaterThan(0);
  });
});

describe("buildQuoteSuggestion — device-aware part priority", () => {
  it("prefers parts named after the matched device over other models", () => {
    // Sem relação peça↔modelo no catálogo, o nome do item é o sinal: entre
    // matches contains (não-exatos), a peça "iPhone 15" ganha à "Samsung
    // A54" mesmo com menos stock — stock não vence compatibilidade de nome.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 21,
        id: "part-universal",
        name: "Bateria universal",
        stockQuantity: 5,
      },
      {
        category: "BATTERY",
        defaultPrice: 25,
        id: "part-iphone",
        name: "Bateria iPhone 15",
        stockQuantity: 1,
      },
      {
        category: "BATTERY",
        defaultPrice: 22,
        id: "part-samsung",
        name: "Bateria Samsung A54",
        stockQuantity: 9,
      },
    ];
    const s = build(diag({ "battery.health": { Status: "fail" } }), { parts });
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-iphone");
    expect(part?.confidence).toBe("high");
  });

  it("lets an exact hint match beat a device-name contains match", () => {
    // Reparações: equals exato > deviceHit > stock > contains — o
    // template battery dá o hint exato "troca de bateria" e a linha é a
    // genérica exata. Peças: deviceHit primeiro (decisão do dono — a
    // peça do modelo certo ganha à genérica exata), depois stock e rank.
    const repairs: QuoteRepairInput[] = [
      {
        category: "HARDWARE",
        defaultPrice: 25,
        id: "rep-generic",
        name: "Troca de bateria",
      },
      {
        category: "HARDWARE",
        defaultPrice: 35,
        id: "rep-iphone",
        name: "Troca de bateria iPhone 15",
      },
    ];
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic",
        name: "Bateria",
        stockQuantity: 3,
      },
      {
        category: "BATTERY",
        defaultPrice: 28,
        id: "part-iphone",
        name: "Bateria iPhone 15",
        stockQuantity: 3,
      },
    ];
    const s = build(
      diag({
        "battery.health": { Status: "fail" },
        "service.template": { Status: "info", Value: "battery" },
      }),
      { parts, repairs }
    );
    expect(s.lines.find((l) => l.kind === "repair")?.catalogId).toBe(
      "rep-generic"
    );
    expect(s.lines.find((l) => l.kind === "part")?.catalogId).toBe(
      "part-iphone"
    );
  });

  it("still emits a generic part when no catalog item mentions the device", () => {
    // O boost por nome não é penalização: sem peças com o modelo no nome,
    // o match normal por hint decide como antes.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic",
        name: "Bateria",
        stockQuantity: 5,
      },
    ];
    const s = build(diag({ "battery.health": { Status: "fail" } }), { parts });
    expect(s.lines.find((l) => l.kind === "part")?.catalogId).toBe(
      "part-generic"
    );
  });

  it("prefers an in-stock part over an exact-name out-of-stock one", () => {
    // BUG #166 r3: com equals>contains primeiro, "Bateria" (hint exato,
    // sem stock) ganhava a "Bateria iPhone 15" (contains+deviceHit, em
    // stock). Para peças a disponibilidade vem primeiro — a peça certa
    // em stock ganha à genérica exata mas esgotada.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic-oos",
        name: "Bateria",
        stockQuantity: 0,
      },
      {
        category: "BATTERY",
        defaultPrice: 28,
        id: "part-iphone",
        name: "Bateria iPhone 15",
        stockQuantity: 4,
      },
    ];
    const s = build(diag({ "battery.health": { Status: "fail" } }), { parts });
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-iphone");
    expect(part?.inStock).toBe(true);
  });

  it("does not treat a longer variant as the same model (BUG r7)", () => {
    // «iPhone 15 Pro» é outra variante: a bateria Pro esgotada não pode
    // ganhar à genérica em stock num iPhone 15 — deviceHit rejeitado.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic",
        name: "Bateria",
        stockQuantity: 5,
      },
      {
        category: "BATTERY",
        defaultPrice: 24,
        id: "part-15pro",
        name: "Bateria iPhone 15 Pro",
        stockQuantity: 0,
      },
    ];
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone 15" } }
      ),
      { parts }
    );
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-generic");
    expect(part?.inStock).toBe(true);
  });

  it("keeps model priority when a commercial description follows the model", () => {
    // BUG #166 r9: «– Max Capacity» é descrição comercial, não a
    // variante Max — a peça específica em stock ganha à genérica.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic",
        name: "Bateria",
        stockQuantity: 5,
      },
      {
        category: "BATTERY",
        defaultPrice: 35,
        id: "part-maxcap",
        name: "Bateria iPhone 15 – Max Capacity",
        stockQuantity: 2,
      },
    ];
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone 15" } }
      ),
      { parts }
    );
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-maxcap");
  });

  it("keeps model priority when a capacity spec follows the model", () => {
    // BUG #166 r11: «– Max 4000 mAh» é especificação comercial, não a
    // variante Max — ambas em stock, a peça do modelo ganha à genérica.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic",
        name: "Bateria",
        stockQuantity: 5,
      },
      {
        category: "BATTERY",
        defaultPrice: 35,
        id: "part-maxmah",
        name: "Bateria iPhone 15 – Max 4000 mAh",
        stockQuantity: 2,
      },
    ];
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone 15" } }
      ),
      { parts }
    );
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-maxmah");
  });

  it("keeps model priority with a decimal capacity spec (15,4 Wh)", () => {
    // BUG #166 r13: a normalização separa o decimal («15,4 wh» →
    // «15 4 wh») — a unidade tem de ser lida até ao fim do spec.
    for (const name of [
      "Bateria iPhone 15 – Max 15,4 Wh",
      "Bateria iPhone 15 – Max 15.4Wh",
    ]) {
      const parts: QuotePartInput[] = [
        {
          category: "BATTERY",
          defaultPrice: 20,
          id: "part-generic",
          name: "Bateria",
          stockQuantity: 5,
        },
        {
          category: "BATTERY",
          defaultPrice: 35,
          id: "part-decimal",
          name,
          stockQuantity: 2,
        },
      ];
      const s = build(
        diag(
          { "battery.health": { Status: "fail" } },
          { device: { brand: "Apple", model: "iPhone 15" } }
        ),
        { parts }
      );
      const part = s.lines.find((l) => l.kind === "part");
      expect(part?.catalogId).toBe("part-decimal");
    }
  });

  it("rejects a Max variant with a storage spec for a Pro device", () => {
    // BUG #166 r12: «Pro Max 256GB» é variante a sério — a excepção de
    // capacidade (mAh/Wh) não pode aceitá-la; a bateria Pro ganha à
    // Pro Max mesmo esgotada (deviceHit > stock).
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 30,
        id: "part-pro",
        name: "Bateria iPhone 15 Pro",
        stockQuantity: 0,
      },
      {
        category: "BATTERY",
        defaultPrice: 45,
        id: "part-promax",
        name: "Bateria iPhone 15 Pro Max 256GB",
        stockQuantity: 2,
      },
    ];
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone 15 Pro" } }
      ),
      { parts }
    );
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-pro");
  });

  it("rejects a variant followed by a generic descriptor (Pro OEM)", () => {
    // BUG #166 r10: «iPhone 15 Pro OEM» é a variante Pro — a peça do
    // modelo certo esgotada ganha à Pro em stock.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 30,
        id: "part-base",
        name: "Bateria iPhone 15",
        stockQuantity: 0,
      },
      {
        category: "BATTERY",
        defaultPrice: 38,
        id: "part-pro-oem",
        name: "Bateria iPhone 15 Pro OEM",
        stockQuantity: 4,
      },
    ];
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone 15" } }
      ),
      { parts }
    );
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-base");
  });

  it("still prefers the exact-model out-of-stock part over a variant in stock", () => {
    // Controlo da decisão do dono com variantes: «Bateria iPhone 15»
    // esgotada continua a ganhar — à Pro em stock E à genérica em stock.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic",
        name: "Bateria",
        stockQuantity: 5,
      },
      {
        category: "BATTERY",
        defaultPrice: 24,
        id: "part-15",
        name: "Bateria iPhone 15",
        stockQuantity: 0,
      },
      {
        category: "BATTERY",
        defaultPrice: 26,
        id: "part-15pro",
        name: "Bateria iPhone 15 Pro",
        stockQuantity: 4,
      },
    ];
    const s = build(
      diag(
        { "battery.health": { Status: "fail" } },
        { device: { brand: "Apple", model: "iPhone 15" } }
      ),
      { parts }
    );
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-15");
    expect(part?.inStock).toBe(false);
  });

  it("prefers the right-model out-of-stock part over another model in stock", () => {
    // BUG #166 r6 (decisão do dono): uma peça de outro modelo nunca ganha
    // à do modelo certo, mesmo esgotada — «Bateria Samsung A54» em stock
    // não pode suplantar «Bateria iPhone 15» num iPhone 15.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 22,
        id: "part-samsung",
        name: "Bateria Samsung A54",
        stockQuantity: 4,
      },
      {
        category: "BATTERY",
        defaultPrice: 28,
        id: "part-iphone15",
        name: "Bateria iPhone 15",
        stockQuantity: 0,
      },
    ];
    const s = build(diag({ "battery.health": { Status: "fail" } }), { parts });
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-iphone15");
    expect(part?.inStock).toBe(false);
  });

  it("keeps exact-match priority between equally stocked parts", () => {
    // stock>0 empata quando ambas têm stock: o equals continua a ganhar
    // ao contains sem deviceHit — prioridade da r2 preservada.
    const parts: QuotePartInput[] = [
      {
        category: "BATTERY",
        defaultPrice: 20,
        id: "part-generic",
        name: "Bateria",
        stockQuantity: 3,
      },
      {
        category: "BATTERY",
        defaultPrice: 24,
        id: "part-universal",
        name: "Bateria universal",
        stockQuantity: 3,
      },
    ];
    const s = build(diag({ "battery.health": { Status: "fail" } }), { parts });
    expect(s.lines.find((l) => l.kind === "part")?.catalogId).toBe(
      "part-generic"
    );
  });
});

describe("buildQuoteSuggestion — device gating", () => {
  it("emits no hardware lines without a device match, but keeps SOFTWARE/DIAGNOSTIC", () => {
    const s = build(
      diag(
        {
          "battery.health": { Status: "fail" },
          "security.root": { Status: "fail" },
        },
        { device: { brand: "Nokia", model: "3310" } }
      )
    );

    expect(s.deviceMatch).toBeNull();
    // security.root → SOFTWARE/DIAGNOSTIC repair still emitted (no device needed)
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({
      kind: "repair",
      name: "Formatação / software",
    });
    // battery.health suppressed → visible to staff
    expect(s.unmatchedChecks).toEqual(["battery.health"]);
  });

  it("suppresses everything hardware when the diagnostic has no device at all", () => {
    const s = build(
      diag({ "test.touch": { Status: "fail" } }, { device: undefined })
    );
    expect(s.deviceMatch).toBeNull();
    expect(s.lines).toEqual([]);
    expect(s.unmatchedChecks).toEqual(["test.touch"]);
  });
});

describe("buildQuoteSuggestion — unmatched and meta checks", () => {
  it("sends checks without catalog candidates to unmatchedChecks", () => {
    const s = build(
      diag({
        "checklist.frame": { Status: "warn" },
        "test.gpu": { Status: "fail" },
      })
    );
    expect(s.lines).toEqual([]);
    expect(s.unmatchedChecks).toEqual(["checklist.frame", "test.gpu"]);
  });

  it("uses suggest.parts labels as secondary name hints for parts", () => {
    const parts: QuotePartInput[] = [
      {
        category: "CAMERA",
        defaultPrice: 60,
        id: "part-cam-back",
        name: "Câmara traseira principal",
        stockQuantity: 3,
      },
    ];
    const s = build(
      diag({
        "checklist.cameras": { Status: "fail" },
        "suggest.parts": { Status: "info", Value: "câmara traseira" },
      }),
      { parts }
    );
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-cam-back");
    // "câmara traseira" label vs "Câmara traseira principal" → contains → low
    expect(part?.confidence).toBe("low");
  });
});

describe("buildQuoteSuggestion — check → category rules", () => {
  it("matches the PT speaker synonym 'coluna' to SPEAKER parts", () => {
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 35,
        id: "part-coluna",
        name: "Coluna Bluetooth",
        stockQuantity: 2,
      },
    ];
    const s = build(diag({ "checklist.speaker": { Status: "fail" } }), {
      parts,
    });
    expect(s.lines.find((l) => l.kind === "part")?.catalogId).toBe(
      "part-coluna"
    );
    expect(s.unmatchedChecks).toEqual([]);
  });

  it("maps checklist.earpiece to SPEAKER, not MICROPHONE", () => {
    // O earpiece do checklist é o altifalante de chamadas (ouvir), não o
    // microfone — a peça SPEAKER ganha mesmo existindo uma MICROPHONE.
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 20,
        id: "part-ear",
        name: "Altifalante auricular",
        stockQuantity: 1,
      },
      {
        category: "MICROPHONE",
        defaultPrice: 20,
        id: "part-mic",
        name: "Microfone",
        stockQuantity: 1,
      },
    ];
    const s = build(diag({ "checklist.earpiece": { Status: "fail" } }), {
      parts,
    });
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-ear");
    expect(s.unmatchedChecks).toEqual([]);
  });

  it("emits separate lines when speaker and earpiece are both faulty", () => {
    // Coluna e auricular de chamadas são componentes físicos distintos —
    // regras diferentes → caches diferentes → duas linhas de peça.
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 15,
        id: "part-coluna",
        name: "Coluna Bluetooth",
        stockQuantity: 2,
      },
      {
        category: "SPEAKER",
        defaultPrice: 12,
        id: "part-auricular",
        name: "Auricular chamadas",
        stockQuantity: 1,
      },
    ];
    const s = build(
      diag({
        "checklist.earpiece": { Status: "fail" },
        "checklist.speaker": { Status: "fail" },
      }),
      { parts }
    );
    const partLines = s.lines.filter((l) => l.kind === "part");
    expect(partLines).toHaveLength(2);
    expect(partLines.map((l) => l.catalogId).sort()).toEqual([
      "part-auricular",
      "part-coluna",
    ]);
    expect(s.unmatchedChecks).toEqual([]);
  });

  it("still merges checks of the SAME component into one line", () => {
    // checklist.speaker e sensor.speaker são a mesma avaria (a coluna) —
    // a dedupe por regra continua: uma linha com as duas razões.
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 15,
        id: "part-coluna",
        name: "Coluna Bluetooth",
        stockQuantity: 2,
      },
    ];
    const s = build(
      diag({
        "checklist.speaker": { Status: "fail" },
        "sensor.speaker": { Status: "warn" },
      }),
      { parts }
    );
    const partLines = s.lines.filter((l) => l.kind === "part");
    expect(partLines).toHaveLength(1);
    expect(partLines[0].catalogId).toBe("part-coluna");
    expect(partLines[0].reasonCheck).toContain("checklist.speaker");
    expect(partLines[0].reasonCheck).toContain("sensor.speaker");
    expect(partLines[0].reasonStatus).toBe("fail");
  });
});

describe("buildQuoteSuggestion — service.template", () => {
  it("merges service.template and same-rule check reasons into one line", () => {
    // Sem a escolha em cache por regra, o template escolhia "Troca de
    // bateria" (hint exato do template) e o check escolhia "Bateria
    // substituída" (ambos contains "bateria", desempate por nome) — duas
    // linhas de reparação para a mesma substituição.
    const repairs: QuoteRepairInput[] = [
      {
        category: "HARDWARE",
        defaultPrice: 25,
        id: "rep-troca",
        name: "Troca de bateria",
      },
      {
        category: "HARDWARE",
        defaultPrice: 30,
        id: "rep-bat-new",
        name: "Bateria substituída",
      },
    ];
    const s = build(
      diag({
        "battery.health": { Status: "fail" },
        "service.template": { Status: "info", Value: "battery" },
      }),
      { repairs }
    );

    const repairLines = s.lines.filter((l) => l.kind === "repair");
    expect(repairLines).toHaveLength(1);
    expect(repairLines[0]).toMatchObject({
      catalogId: "rep-troca",
      // pior estado entre info (template) e fail (check)
      reasonStatus: "fail",
    });
    expect(repairLines[0].reasonCheck).toContain("service.template");
    expect(repairLines[0].reasonCheck).toContain("battery.health");

    const partLines = s.lines.filter((l) => l.kind === "part");
    expect(partLines).toHaveLength(1);
    expect(partLines[0].catalogId).toBe("part-battery");
    expect(partLines[0].reasonCheck).toContain("service.template");
    expect(partLines[0].reasonCheck).toContain("battery.health");
  });

  it("battery template emits battery lines prioritising ~bateria repairs", () => {
    const s = build(
      diag({
        "checklist.liquid": { Status: "fail" }, // unrelated failing check
        "service.template": { Status: "info", Value: "battery" },
      })
    );

    const batteryRepair = s.lines.find((l) => l.catalogId === "rep-battery");
    expect(batteryRepair).toMatchObject({
      // "Troca de bateria" equals the template hint → high confidence
      confidence: "high",
      kind: "repair",
      reasonCheck: "service.template",
      reasonStatus: "info",
    });

    const batteryPart = s.lines.find((l) => l.catalogId === "part-battery");
    expect(batteryPart?.reasonCheck).toBe("service.template");
  });

  it("ignores used/maintenance/whatsapp templates", () => {
    const s = build(
      diag({
        "battery.health": { Status: "fail" },
        "service.template": { Status: "info", Value: "whatsapp" },
      })
    );
    // whatsapp adds no template lines — only the real check's lines exist
    expect(s.lines.every((l) => l.reasonCheck === "battery.health")).toBe(true);
  });
});

describe("buildQuoteSuggestion — speaker vs earpiece disambiguation", () => {
  it("does not suggest the loudspeaker for a failed earpiece check", () => {
    // «Speaker» é a coluna — está contido em «speaker de chamadas» mas não
    // É um auricular: expressões multi-palavra só contam num sentido
    // (o nome da peça tem de conter a expressão, não o inverso).
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 15,
        id: "part-coluna",
        name: "Coluna",
        stockQuantity: 2,
      },
      {
        category: "SPEAKER",
        defaultPrice: 12,
        id: "part-speaker",
        name: "Speaker",
        stockQuantity: 2,
      },
    ];
    const s = build(
      diag({
        "checklist.earpiece": { Status: "fail" },
        "checklist.speaker": { Status: "fail" },
      }),
      { parts }
    );
    const partLines = s.lines.filter((l) => l.kind === "part");
    expect(partLines).toHaveLength(1);
    expect(partLines[0].catalogId).toBe("part-coluna");
    expect(s.unmatchedChecks).toEqual(["checklist.earpiece"]);
  });

  it("suggests speaker and earpiece as separate lines when both fail", () => {
    // BUG #166 r3: com as duas avarias em falha e as duas peças em stock,
    // a regra da coluna exclui nomes de earpiece — cada avaria fica com a
    // sua linha em vez de fundir numa só.
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 20,
        id: "part-alt-superior",
        name: "Altifalante superior iPhone 15",
        stockQuantity: 1,
      },
      {
        category: "SPEAKER",
        defaultPrice: 15,
        id: "part-coluna",
        name: "Coluna iPhone 15",
        stockQuantity: 2,
      },
    ];
    const s = build(
      diag({
        "checklist.earpiece": { Status: "fail" },
        "checklist.speaker": { Status: "fail" },
      }),
      { parts }
    );
    const partLines = s.lines.filter((l) => l.kind === "part");
    expect(partLines.map((l) => l.catalogId).sort()).toEqual([
      "part-alt-superior",
      "part-coluna",
    ]);
    expect(s.unmatchedChecks).toEqual([]);
  });

  it("recognises 'Altifalante superior' as the earpiece", () => {
    // Posição do auricular sem a palavra «chamadas» — sem o hint próprio a
    // avaria ficava sem sugestão mesmo com a peça certa em stock.
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 20,
        id: "part-alt-superior",
        name: "Altifalante superior iPhone 15",
        stockQuantity: 1,
      },
    ];
    const s = build(diag({ "checklist.earpiece": { Status: "fail" } }), {
      parts,
    });
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-alt-superior");
    expect(s.unmatchedChecks).toEqual([]);
  });
});

describe("excludeHints — nome que é só a expressão do outro componente", () => {
  it("does not suggest the earpiece-only part for a failed speaker", () => {
    // BUG #166 r5: «Altifalante superior» é só earpiece; sem a rejeição do
    // stripped vazio, a cadeia vazia casava com qualquer hint e a peça do
    // auricular saía como sugestão da coluna.
    const parts: QuotePartInput[] = [
      {
        category: "SPEAKER",
        defaultPrice: 20,
        id: "part-alt-superior-only",
        name: "Altifalante superior",
        stockQuantity: 2,
      },
    ];
    const s = build(
      diag({
        "checklist.earpiece": { Status: "pass" },
        "checklist.speaker": { Status: "fail" },
      }),
      { parts, repairs: [] }
    );
    expect(s.lines).toHaveLength(0);
    expect(s.unmatchedChecks).toEqual(["checklist.speaker"]);
  });
});

describe("excludeHints — serviços combinados de som", () => {
  it("keeps a combined repair matched to both speaker and earpiece", () => {
    // BUG #166 r4: «Troca de coluna e altifalante superior» serve as duas
    // avarias — a exclusão cega deixava a coluna sem correspondência.
    const repairs: QuoteRepairInput[] = [
      {
        category: "HARDWARE",
        defaultPrice: 45,
        id: "rep-som-combinado",
        name: "Troca de coluna e altifalante superior",
      },
    ];
    const s = build(
      diag({
        "checklist.earpiece": { Status: "fail" },
        "checklist.speaker": { Status: "fail" },
      }),
      { parts: [], repairs }
    );
    const repairLines = s.lines.filter((l) => l.kind === "repair");
    expect(repairLines).toHaveLength(1);
    expect(repairLines[0].catalogId).toBe("rep-som-combinado");
    expect(repairLines[0].reasonCheck).toContain("checklist.speaker");
    expect(repairLines[0].reasonCheck).toContain("checklist.earpiece");
    expect(s.unmatchedChecks).toEqual([]);
  });
});

describe("hint matching — abreviaturas fora do catálogo de som", () => {
  it("still matches an abbreviated charging part name («Conector»)", () => {
    // ANALYSIS #166 r3: a direcção estrita é só do earpiece; as restantes
    // regras mantêm os dois sentidos, por isso «Conector» continua a
    // corresponder a «conector de carga» na categoria Porta de carga.
    const parts: QuotePartInput[] = [
      {
        category: "CHARGING_PORT",
        defaultPrice: 12,
        id: "part-conector-abrev",
        name: "Conector",
        stockQuantity: 3,
      },
    ];
    const s = build(diag({ "checklist.charge_port": { Status: "fail" } }), {
      parts,
    });
    const part = s.lines.find((l) => l.kind === "part");
    expect(part?.catalogId).toBe("part-conector-abrev");
    expect(s.unmatchedChecks).toEqual([]);
  });
});
