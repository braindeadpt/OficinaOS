import api from "@/lib/api";

export type PartRequestStatus = "OPEN" | "FOUND" | "CLOSED";
export type PartType =
  | "SCREEN"
  | "BATTERY"
  | "BOARD"
  | "CAMERA"
  | "PORT"
  | "OTHER";
export type PartCondition = "ANY" | "NEW" | "OEM" | "USED";

export interface PartRequest {
  _count: { replies: number };
  condition: PartCondition;
  contact?: string | null;
  createdAt: string;
  deviceBrand: string | null;
  deviceModel: string | null;
  id: string;
  maxPriceCents: number | null;
  notes: string | null;
  partType: PartType;
  shop: { name: string };
  status?: PartRequestStatus;
  title: string;
}

export interface PartRequestReply {
  contact: string | null;
  createdAt: string;
  id: string;
  note: string | null;
  priceCents: number | null;
  shop: { name: string };
}

export interface CreatePartRequestInput {
  condition?: PartCondition;
  contact?: string;
  deviceBrand?: string;
  deviceModel?: string;
  maxPriceCents?: number;
  notes?: string;
  partType: PartType;
  title: string;
}

export async function fetchPartRequests(
  scope: "board" | "mine"
): Promise<PartRequest[]> {
  const res = await api.get<{ requests: PartRequest[] }>("/part-requests", {
    params: { scope },
  });
  return res.data.requests;
}

export async function createPartRequest(
  input: CreatePartRequestInput
): Promise<{ id: string }> {
  const res = await api.post<{ id: string }>("/part-requests", input);
  return res.data;
}

export async function closePartRequest(
  id: string,
  status: "FOUND" | "CLOSED"
): Promise<void> {
  await api.post(`/part-requests/${id}/close`, { status });
}

export async function replyToPartRequest(
  id: string,
  input: { note?: string; priceCents?: number; contact?: string }
): Promise<void> {
  await api.post(`/part-requests/${id}/replies`, input);
}

export async function fetchPartRequestReplies(
  id: string
): Promise<PartRequestReply[]> {
  const res = await api.get<{ replies: PartRequestReply[] }>(
    `/part-requests/${id}/replies`
  );
  return res.data.replies;
}
