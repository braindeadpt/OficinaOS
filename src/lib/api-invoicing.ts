import api from "@/lib/api";

export interface IssuedInvoice {
  docId: string;
  docType: "FS" | "FR";
  number: string | null;
  permalink: string | null;
}

export async function fetchInvoicingStatus(): Promise<{
  enabled: boolean;
  module: boolean;
}> {
  const res = await api.get("/invoicing/status");
  return res.data as { enabled: boolean; module: boolean };
}

export async function issueSaleInvoice(saleId: string): Promise<IssuedInvoice> {
  const res = await api.post(`/sales/${saleId}/invoice`);
  return res.data as IssuedInvoice;
}

export async function issueJobInvoice(jobId: string): Promise<IssuedInvoice> {
  const res = await api.post(`/jobs/${jobId}/invoice`);
  return res.data as IssuedInvoice;
}
