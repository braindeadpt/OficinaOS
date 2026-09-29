import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSearchable, searchGlobal } from "@/lib/global-search";

const mockGet = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

function jobsResponse(jobs: unknown[]) {
  return { data: { jobs } };
}

const JOB = {
  id: "job-1",
  jobCode: "OS-2026-0001",
  status: "IN_REPAIR",
  customer: { name: "Ana Silva" },
  device: { brand: { name: "Apple" }, model: "iPhone 14" },
};

const CUSTOMER = { id: "cus-1", name: "Ana Silva", phone: "+351912345678" };

const PART = {
  id: "part-1",
  name: "Ecrã iPhone 14",
  category: "SCREEN",
  defaultPrice: "89.90",
  reorderLevel: 2,
  stockQuantity: 0,
  supplier: "TechParts",
};

const REPAIR = {
  id: "rep-1",
  name: "Troca de ecrã",
  category: "HARDWARE",
  defaultPrice: "45.00",
};

/** Fulfils every catalogue leg with an empty payload unless told otherwise. */
function emptyLeg(url: string) {
  if (url === "/jobs") {
    return Promise.resolve(jobsResponse([]));
  }
  if (url === "/parts" || url === "/repairs") {
    return Promise.resolve({ data: { parts: [], repairs: [] } });
  }
  return Promise.resolve({ data: [] });
}

beforeEach(() => {
  mockGet.mockReset();
});

describe("isSearchable", () => {
  it("needs at least two characters", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable(" a ")).toBe(false);
    expect(isSearchable("ab")).toBe(true);
  });
});

describe("searchGlobal", () => {
  it("does not call the API for a query that is too short", async () => {
    expect(await searchGlobal("a")).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("queries both endpoints with the trimmed term", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/jobs"
        ? Promise.resolve(jobsResponse([]))
        : Promise.resolve({ data: [] })
    );

    await searchGlobal("  ana  ");

    expect(mockGet).toHaveBeenCalledWith(
      "/jobs",
      expect.objectContaining({
        params: expect.objectContaining({ search: "ana" }),
      })
    );
    expect(mockGet).toHaveBeenCalledWith(
      "/customers/search",
      expect.objectContaining({ params: expect.objectContaining({ q: "ana" }) })
    );
  });

  it("lists repairs before customers", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/jobs"
        ? Promise.resolve(jobsResponse([JOB]))
        : Promise.resolve({ data: [CUSTOMER] })
    );

    const results = await searchGlobal("ana");

    expect(results.map((r) => r.kind)).toEqual(["job", "customer"]);
  });

  it("maps a job to a link, a title and a subtitle", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/jobs"
        ? Promise.resolve(jobsResponse([JOB]))
        : Promise.resolve({ data: [] })
    );

    const [result] = await searchGlobal("OS-2026");

    expect(result).toMatchObject({
      group: "jobs",
      href: "/jobs/job-1",
      jobCode: "OS-2026-0001",
      status: "IN_REPAIR",
      subtitle: "Ana Silva · Apple iPhone 14",
      title: "OS-2026-0001",
    });
  });

  it("maps a customer to a link and their phone", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/jobs"
        ? Promise.resolve(jobsResponse([]))
        : Promise.resolve({ data: [CUSTOMER] })
    );

    const [result] = await searchGlobal("912");

    expect(result).toMatchObject({
      group: "customers",
      href: "/customers/cus-1",
      subtitle: "+351912345678",
      title: "Ana Silva",
    });
  });

  it("tolerates a failing endpoint without losing the other results", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/jobs"
        ? Promise.reject(new Error("jobs down"))
        : Promise.resolve({ data: [CUSTOMER] })
    );

    const results = await searchGlobal("ana");

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("customer");
  });

  it("ignores an unexpected payload shape instead of throwing", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/jobs"
        ? Promise.resolve({ data: { jobs: "not-an-array" } })
        : Promise.resolve({ data: { nope: true } })
    );

    expect(await searchGlobal("ana")).toEqual([]);
  });

  it("copes with missing optional relations on a job", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/jobs"
        ? Promise.resolve(
            jobsResponse([
              {
                id: "j",
                jobCode: "OS-1",
                status: "INTAKE",
                customer: null,
                device: null,
              },
            ])
          )
        : Promise.resolve({ data: [] })
    );

    const [result] = await searchGlobal("OS");

    expect(result).toMatchObject({ subtitle: "" });
  });

  it("queries the two catalogues alongside jobs and customers", async () => {
    mockGet.mockImplementation((url: string) => emptyLeg(url));
    await searchGlobal("tela");
    const urls = mockGet.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(
      expect.arrayContaining([
        "/jobs",
        "/customers/search",
        "/parts",
        "/repairs",
      ])
    );
  });

  it("skips a catalogue the reader may not see, without requesting it", async () => {
    mockGet.mockImplementation((url: string) => emptyLeg(url));
    await searchGlobal("tela", {
      sources: { parts: false, repairs: true },
    });
    const urls = mockGet.mock.calls.map((c) => c[0]);
    expect(urls).not.toContain("/parts");
    expect(urls).toContain("/repairs");
  });

  it("maps a part to its name, stock, supplier and unit price", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/parts"
        ? Promise.resolve({ data: { parts: [PART] } })
        : emptyLeg(url)
    );

    const [result] = await searchGlobal("ecra");

    expect(result).toMatchObject({
      category: "SCREEN",
      href: "/parts?search=Ecr%C3%A3%20iPhone%2014",
      kind: "part",
      lowStock: true,
      stockQuantity: 0,
      supplier: "TechParts",
      title: "Ecrã iPhone 14",
      unitPrice: 89.9,
    });
    // Wording belongs to the caller, so no translated string is baked in.
    expect("subtitle" in (result as object)).toBe(false);
  });

  it("flags a part with stock at or below its reorder level", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/parts"
        ? Promise.resolve({
            data: {
              parts: [{ ...PART, stockQuantity: 2, reorderLevel: 2 }],
            },
          })
        : emptyLeg(url)
    );

    const [result] = await searchGlobal("ecra");
    expect(result).toMatchObject({ lowStock: true, stockQuantity: 2 });
  });

  it("does not flag a part that is comfortably in stock", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/parts"
        ? Promise.resolve({
            data: {
              parts: [{ ...PART, stockQuantity: 9, reorderLevel: 2 }],
            },
          })
        : emptyLeg(url)
    );

    const [result] = await searchGlobal("ecra");
    expect(result).toMatchObject({ lowStock: false, stockQuantity: 9 });
  });

  it("treats a reorder level of zero as no threshold at all", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/parts"
        ? Promise.resolve({
            data: {
              parts: [{ ...PART, reorderLevel: 0, stockQuantity: 1 }],
            },
          })
        : emptyLeg(url)
    );

    const [result] = await searchGlobal("ecra");
    expect(result).toMatchObject({ lowStock: false });
  });

  it("maps a repair service to its name, category and price", async () => {
    mockGet.mockImplementation((url: string) =>
      url === "/repairs"
        ? Promise.resolve({ data: { repairs: [REPAIR] } })
        : emptyLeg(url)
    );

    const [result] = await searchGlobal("ecra");

    expect(result).toMatchObject({
      category: "HARDWARE",
      href: "/repairs?search=Troca%20de%20ecr%C3%A3",
      kind: "repair",
      title: "Troca de ecrã",
      unitPrice: 45,
    });
  });

  it("keeps the other legs when one catalogue is rejected", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/repairs") {
        return Promise.reject(new Error("403"));
      }
      return url === "/parts"
        ? Promise.resolve({ data: { parts: [PART] } })
        : emptyLeg(url);
    });

    const results = await searchGlobal("tela");

    expect(results.map((r) => r.kind)).toEqual(["part"]);
  });

  it("groups results so jobs still come before catalogues", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/jobs") {
        return Promise.resolve(jobsResponse([JOB]));
      }
      if (url === "/parts") {
        return Promise.resolve({ data: { parts: [PART] } });
      }
      if (url === "/repairs") {
        return Promise.resolve({ data: { repairs: [REPAIR] } });
      }
      return Promise.resolve({ data: [CUSTOMER] });
    });

    const results = await searchGlobal("ana");

    expect(results.map((r) => r.kind)).toEqual([
      "job",
      "customer",
      "part",
      "repair",
    ]);
  });
});
