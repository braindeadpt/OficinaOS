import type { WorkflowType } from "@shared/constants/workflow";
export function businessRecordPath(
  type: WorkflowType,
  id: string
): string | null {
  const encoded = encodeURIComponent(id);
  switch (type) {
    case "JOB":
      return `/jobs/${encoded}`;
    case "CUSTOMER":
      return `/customers/${encoded}`;
    case "SUPPLIER":
      return `/suppliers/${encoded}`;
    case "ORDER":
      return `/purchase-orders?recordId=${encoded}`;
    case "TICKET":
      return `/tickets?recordId=${encoded}`;
    case "MESSAGE":
      return `/messages?recordId=${encoded}`;
    case "AGREEMENT":
      return `/agreements?recordId=${encoded}`;
    default:
      return null;
  }
}
