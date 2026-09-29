import type { JobStatusType } from "@shared/constants";
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

export type SearchResult = SearchCustomerResult | SearchJobResult;

export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
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

/**
 * Global search across repairs and customers.
 *
 * Composed from the two endpoints that already exist rather than a new
 * aggregated route: `/jobs?search=` matches job code, customer name, device
 * and IMEI, while `/customers/search?q=` matches customer name and phone
 * prefix. Each leg settles independently, so one failing does not blank out
 * the other.
 */
export async function searchGlobal(
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!isSearchable(q)) {
    return [];
  }

  const [jobs, customers] = await Promise.allSettled([
    api.get<{ jobs: JobSearchRow[] }>("/jobs", {
      params: { limit: RESULT_LIMIT, search: q },
      signal,
    }),
    api.get<CustomerSearchRow[]>("/customers/search", {
      params: { limit: RESULT_LIMIT, q },
      signal,
    }),
  ]);

  const results: SearchResult[] = [];

  // Repairs first: typing a job code is the most common intent. The shape
  // guards matter: this runs on every keystroke, and an unexpected payload
  // must degrade to "no results" rather than throw inside the header.
  if (jobs.status === "fulfilled" && Array.isArray(jobs.value.data?.jobs)) {
    for (const job of jobs.value.data.jobs) {
      results.push(toJobResult(job));
    }
  }
  if (customers.status === "fulfilled" && Array.isArray(customers.value.data)) {
    for (const customer of customers.value.data) {
      results.push(toCustomerResult(customer));
    }
  }

  return results;
}
