import type {
  JobStatusType,
  PartCategoryType,
  RepairCategoryType,
} from "@shared/constants";
import api from "@/lib/api";

/** Below this length a query matches too much to be useful in a palette. */
export const MIN_QUERY_LENGTH = 2;

const RESULT_LIMIT = 5;

export interface SearchJobResult {
  group: "jobs";
  href: string;
  id: string;
  jobCode: string;
  kind: "job";
  status: JobStatusType;
  subtitle: string;
  title: string;
}

export interface SearchCustomerResult {
  group: "customers";
  href: string;
  id: string;
  kind: "customer";
  subtitle: string;
  title: string;
}

/**
 * Catalogue rows carry facts rather than finished sentences: the caller writes
 * the wording, so switching language re-renders them in the new one instead of
 * leaving the previous language's text under an open search.
 */
export interface SearchPartResult {
  category: PartCategoryType;
  group: "parts";
  href: string;
  id: string;
  kind: "part";
  /** At or below the reorder level: worth flagging before quoting it. */
  lowStock: boolean;
  /** Drives the out-of-stock flag on the row. */
  stockQuantity: number;
  /** null when the supplier is not set; the row then shows only the stock. */
  supplier: string | null;
  title: string;
  unitPrice: number;
}

export interface SearchRepairResult {
  category: RepairCategoryType;
  group: "repairs";
  href: string;
  id: string;
  kind: "repair";
  title: string;
  unitPrice: number;
}

export type SearchResult =
  | SearchCustomerResult
  | SearchJobResult
  | SearchPartResult
  | SearchRepairResult;

export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

export interface SearchOptions {
  signal?: AbortSignal;
  /**
   * Which catalogue legs to query. A caller without parts or repairs
   * permission must not have those requests made at all: a 403 is noise in the
   * network log and, worse, tells the reader that rows they may not see exist.
   */
  sources?: { parts: boolean; repairs: boolean };
}

interface JobSearchRow {
  customer: { name: string } | null;
  device: { brand: { name: string } | null; model: string } | null;
  id: string;
  jobCode: string;
  status: JobStatusType;
}

interface CustomerSearchRow {
  id: string;
  name: string;
  phone: string;
}

interface PartSearchRow {
  category: PartCategoryType;
  defaultPrice: number | string;
  id: string;
  name: string;
  reorderLevel: number;
  stockQuantity: number;
  supplier: string | null;
}

interface RepairSearchRow {
  category: RepairCategoryType;
  defaultPrice: number | string;
  id: string;
  name: string;
}

function toJobResult(job: JobSearchRow): SearchJobResult {
  const device = job.device;
  const label = [device?.brand?.name, device?.model].filter(Boolean).join(" ");
  return {
    group: "jobs",
    href: `/jobs/${job.id}`,
    id: job.id,
    jobCode: job.jobCode,
    kind: "job",
    status: job.status,
    subtitle: [job.customer?.name, label].filter(Boolean).join(" · "),
    title: job.jobCode,
  };
}

function toCustomerResult(customer: CustomerSearchRow): SearchCustomerResult {
  return {
    group: "customers",
    href: `/customers/${customer.id}`,
    id: customer.id,
    kind: "customer",
    subtitle: customer.phone,
    title: customer.name,
  };
}

function toPartResult(part: PartSearchRow): SearchPartResult {
  return {
    category: part.category,
    group: "parts",
    // Neither catalogue has a detail route, so the result deep-links to the
    // catalogue pre-filtered rather than to a page that does not exist.
    href: `/parts?search=${encodeURIComponent(part.name)}`,
    id: part.id,
    kind: "part",
    lowStock: part.reorderLevel > 0 && part.stockQuantity <= part.reorderLevel,
    stockQuantity: part.stockQuantity,
    supplier: part.supplier,
    title: part.name,
    unitPrice: Number(part.defaultPrice),
  };
}

function toRepairResult(repair: RepairSearchRow): SearchRepairResult {
  return {
    category: repair.category,
    group: "repairs",
    href: `/repairs?search=${encodeURIComponent(repair.name)}`,
    id: repair.id,
    kind: "repair",
    title: repair.name,
    unitPrice: Number(repair.defaultPrice),
  };
}

/**
 * Global search across jobs, customers, parts and repair services.
 *
 * Composed from the four list endpoints that already exist rather than a new
 * aggregated route: `/jobs?search=` matches job code, customer name, device and
 * IMEI; `/customers/search?q=` matches name and phone; `/parts?search=` and
 * `/repairs?search=` both match name. Each leg settles independently, so one
 * failing or forbidden does not blank out the others.
 *
 * Returns raw rows only; translating them is the caller's job.
 */
export async function searchGlobal(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { signal } = options;
  const sources = options.sources ?? { parts: true, repairs: true };
  const q = query.trim();
  if (!isSearchable(q)) {
    return [];
  }

  // Each leg maps its own payload to results, so the shape guard sits next to
  // the parsing it protects and allSettled stays homogeneous. A leg that
  // rejects, whether from a failure or a 403, contributes nothing and the
  // others still land.
  const legs: Promise<SearchResult[]>[] = [
    api
      .get<{ jobs: JobSearchRow[] }>("/jobs", {
        params: { limit: RESULT_LIMIT, search: q },
        signal,
      })
      .then((r) =>
        Array.isArray(r.data?.jobs) ? r.data.jobs.map(toJobResult) : []
      ),
    api
      .get<CustomerSearchRow[]>("/customers/search", {
        params: { limit: RESULT_LIMIT, q },
        signal,
      })
      .then((r) => (Array.isArray(r.data) ? r.data.map(toCustomerResult) : [])),
  ];

  if (sources.parts) {
    legs.push(
      api
        .get<{ parts: PartSearchRow[] }>("/parts", {
          params: { limit: RESULT_LIMIT, search: q },
          signal,
        })
        .then((r) =>
          Array.isArray(r.data?.parts) ? r.data.parts.map(toPartResult) : []
        )
    );
  }

  if (sources.repairs) {
    legs.push(
      api
        .get<{ repairs: RepairSearchRow[] }>("/repairs", {
          params: { limit: RESULT_LIMIT, search: q },
          signal,
        })
        .then((r) =>
          Array.isArray(r.data?.repairs)
            ? r.data.repairs.map(toRepairResult)
            : []
        )
    );
  }

  // Jobs first: typing a job code is the most common intent.
  const settled = await Promise.allSettled(legs);
  return settled.flatMap((outcome) =>
    outcome.status === "fulfilled" ? outcome.value : []
  );
}
