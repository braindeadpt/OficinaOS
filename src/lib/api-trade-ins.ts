import api from "@/lib/api";

export type TradeInStatus = "OFFERED" | "PURCHASED" | "CANCELLED" | "SOLD";

export interface TradeIn {
  code: string;
  condition: string;
  createdAt: string;
  createdBy: { id: string; name: string; username: string } | null;
  customer: { id: string; name: string; phone: string };
  customerId: string;
  deviceBrand: string;
  deviceModel: string;
  functionalChecklist: Record<string, string> | null;
  id: string;
  imei: string | null;
  notes: string | null;
  paymentMethod: string;
  purchasePrice: string;
  sellerIdNumber: string;
  sellerIdType: string;
  signatureDataUrl: string | null;
  status: TradeInStatus;
  storage: string | null;
  updatedAt: string;
}

export interface TradeInListResponse {
  items: TradeIn[];
  limit: number;
  page: number;
  total: number;
}

export interface CreateTradeInInput {
  condition: string;
  customerId: string;
  deviceBrand: string;
  deviceModel: string;
  functionalChecklist?: Record<string, "ok" | "fail">;
  imei?: string;
  notes?: string;
  paymentMethod: string;
  purchasePrice: number;
  sellerIdNumber: string;
  sellerIdType: string;
  signatureDataUrl?: string;
  storage?: string;
}

export async function fetchTradeIns(params: {
  limit?: number;
  page?: number;
  status?: TradeInStatus | "";
}): Promise<TradeInListResponse> {
  const res = await api.get<TradeInListResponse>("/trade-ins", { params });
  return res.data;
}

export async function fetchTradeIn(id: string): Promise<TradeIn> {
  const res = await api.get<TradeIn>(`/trade-ins/${id}`);
  return res.data;
}

export async function createTradeIn(
  input: CreateTradeInInput
): Promise<TradeIn> {
  const res = await api.post<TradeIn>("/trade-ins", input);
  return res.data;
}

export async function updateTradeIn(
  id: string,
  input: Partial<CreateTradeInInput>
): Promise<TradeIn> {
  const res = await api.patch<TradeIn>(`/trade-ins/${id}`, input);
  return res.data;
}

export async function transitionTradeIn(
  id: string,
  status: TradeInStatus
): Promise<TradeIn> {
  const res = await api.post<TradeIn>(`/trade-ins/${id}/transition`, {
    status,
  });
  return res.data;
}
