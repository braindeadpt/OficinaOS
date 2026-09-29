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

    expect(result.subtitle).toBe("");
  });
});
