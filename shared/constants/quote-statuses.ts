export const QuoteStatus = {
  SENT: "SENT",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SUPERSEDED: "SUPERSEDED",
} as const;

export type QuoteStatusType = (typeof QuoteStatus)[keyof typeof QuoteStatus];
