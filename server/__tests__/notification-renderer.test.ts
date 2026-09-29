import { describe, expect, it } from "vitest";
import { renderTemplate } from "../services/notification-renderer.js";

describe("renderTemplate", () => {
  it("replaces {{key}} placeholders with values", () => {
    const result = renderTemplate(
      "Hello {{name}}, your job {{jobId}} is ready.",
      {
        name: "Ahmed",
        jobId: "JOB-001",
      }
    );
    expect(result).toBe("Hello Ahmed, your job JOB-001 is ready.");
  });

  it("replaces missing keys with empty string", () => {
    const result = renderTemplate("Hello {{name}}, status: {{status}}", {
      name: "Sara",
    });
    expect(result).toBe("Hello Sara, status: ");
  });

  it("handles template with no placeholders", () => {
    const result = renderTemplate("No variables here.", {});
    expect(result).toBe("No variables here.");
  });

  it("handles repeated placeholders", () => {
    const result = renderTemplate("{{name}} says hi to {{name}}", {
      name: "Karim",
    });
    expect(result).toBe("Karim says hi to Karim");
  });

  it("handles empty template body", () => {
    const result = renderTemplate("", { name: "test" });
    expect(result).toBe("");
  });

  it("renders warranty_return_created with exactly the dispatch context vars", () => {
    // Must mirror the notify context in POST /jobs (customerName, jobCode).
    const result = renderTemplate(
      "Hello {{customerName}}, we have registered a warranty return for your device {{jobCode}}. We will inspect it and keep you updated.{{if shopName}} — {{shopName}}{{endif}}",
      { customerName: "Ana", jobCode: "RPR-100" }
    );
    expect(result).toBe(
      "Hello Ana, we have registered a warranty return for your device RPR-100. We will inspect it and keep you updated."
    );
  });

  it("renders part_low_stock with exactly the dispatcher-provided vars", () => {
    // Must mirror the low-stock notify context (partName, partQuantity,
    // partReorderLevel).
    const result = renderTemplate(
      "Low stock alert: {{partName}} is down to {{partQuantity}} units (reorder level: {{partReorderLevel}}).{{if shopName}} — {{shopName}}{{endif}}",
      { partName: "iPhone 15 screen", partQuantity: "2", partReorderLevel: "5" }
    );
    expect(result).toBe(
      "Low stock alert: iPhone 15 screen is down to 2 units (reorder level: 5)."
    );
  });

  it("ignores placeholders not in vars", () => {
    const result = renderTemplate("Hi {{name}}, {{unknown}}", {
      name: "Lina",
    });
    expect(result).toBe("Hi Lina, ");
  });
});

describe("renderTemplate conditionals", () => {
  it("renders content inside {{if key}} when key is truthy", () => {
    const result = renderTemplate(
      "{{if warranty}}Warranty until {{warrantyDate}}{{endif}}",
      { warranty: "yes", warrantyDate: "2025-12-01" }
    );
    expect(result).toContain("Warranty until");
  });

  it("hides content inside {{if key}} when key is empty string", () => {
    const result = renderTemplate(
      "{{if warranty}}Warranty until {{warrantyDate}}{{endif}}",
      { warranty: "", warrantyDate: "2025-12-01" }
    );
    expect(result).not.toContain("Warranty");
  });

  it("hides content when key is undefined", () => {
    const result = renderTemplate("{{if notes}}Notes: {{notes}}{{endif}}", {});
    expect(result).not.toContain("Notes");
  });

  it("renders content when key is 0 (zero is a valid value)", () => {
    const result = renderTemplate("{{if cost}}Cost: {{cost}}{{endif}}", {
      cost: 0,
    });
    expect(result).toContain("Cost:");
  });
});

describe("renderTemplate locale formatting", () => {
  it("formats numbers with locale", () => {
    const result = renderTemplate("Cost: {{cost}}", { cost: 5000 }, "fr");
    expect(result).toContain("5");
  });

  it("formats ISO date strings with locale", () => {
    const result = renderTemplate(
      "Date: {{date}}",
      { date: "2025-01-15" },
      "fr"
    );
    expect(result).toContain("2025");
  });

  it("does not format regular strings as dates", () => {
    const result = renderTemplate("Code: {{code}}", { code: "REP-2025-001" });
    expect(result).toBe("Code: REP-2025-001");
  });
});
