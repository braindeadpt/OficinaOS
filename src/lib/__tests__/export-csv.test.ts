import { describe, expect, it } from "vitest";
import { toCsv } from "../export-csv";

describe("toCsv", () => {
  it("joins headers and rows with commas and CRLF", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ["1", "2"],
        ["3", "4"],
      ]
    );
    expect(csv).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("quotes cells containing commas, quotes or newlines", () => {
    const csv = toCsv(["note"], [['say "hi", ok'], ["line\nbreak"]]);
    expect(csv).toContain('"say ""hi"", ok"');
    expect(csv).toContain('"line\nbreak"');
  });

  it("neutralizes spreadsheet formula prefixes", () => {
    const csv = toCsv(["ref"], [["=SUM(A1)"], ["+1"], ["-2"], ["@cmd"]]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@cmd");
  });

  it("renders null and undefined as empty cells", () => {
    const csv = toCsv(["x", "y"], [[null, undefined]]);
    expect(csv).toBe("x,y\r\n,\r\n");
  });

  it("keeps numbers as-is", () => {
    const csv = toCsv(["qty", "cost"], [[5, 12.5]]);
    expect(csv).toBe("qty,cost\r\n5,12.5\r\n");
  });
});
