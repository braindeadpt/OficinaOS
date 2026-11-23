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
    // Sem relação peça↔modelo no catálogo, o nome do item é o sinal: a
    // bateria "iPhone 15" ganha à "Samsung A54" mesmo com menos stock, e
    // ganha à "Bateria" genérica porque menciona o modelo.
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
