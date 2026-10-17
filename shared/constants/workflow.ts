import type { PermissionCheck } from "@shared/permissions";

export const WORKFLOW_TYPES = [
  "GENERAL",
  "JOB",
  "RMA",
  "REQUEST",
  "RETURN",
  "ORDER",
  "TRADE_IN",
  "SUPPLIER",
  "CUSTOMER",
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];
export const WORKFLOW_PERMISSIONS: Record<
  WorkflowType,
  { view: PermissionCheck; edit: PermissionCheck }
> = {
  GENERAL: { view: { jobs: ["view"] }, edit: { jobs: ["edit"] } },
  JOB: { view: { jobs: ["view"] }, edit: { jobs: ["edit"] } },
  REQUEST: { view: { jobs: ["view"] }, edit: { jobs: ["edit"] } },
  RMA: { view: { parts: ["viewCatalog"] }, edit: { parts: ["manageCatalog"] } },
  ORDER: {
    view: { parts: ["viewCatalog"] },
    edit: { parts: ["manageCatalog"] },
  },
  SUPPLIER: {
    view: { parts: ["viewCatalog"] },
    edit: { parts: ["manageCatalog"] },
  },
  RETURN: { view: { returns: ["viewSelf"] }, edit: { returns: ["edit"] } },
  TRADE_IN: { view: { tradeins: ["view"] }, edit: { tradeins: ["edit"] } },
  CUSTOMER: { view: { customers: ["view"] }, edit: { customers: ["edit"] } },
};
