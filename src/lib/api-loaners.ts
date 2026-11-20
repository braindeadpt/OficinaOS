import api from "@/lib/api";

export type LoanerStatus = "available" | "out" | "retired";

export interface LoanerCurrentLoan {
  createdAt: string;
  customer: { name: string; phone: string };
  estimatedDate: string | null;
  id: string;
  jobCode: string;
  status: string;
}

export interface LoanerDevice {
  active: boolean;
  brand: string | null;
  createdAt: string;
  currentLoan: LoanerCurrentLoan | null;
  id: string;
  imei: string | null;
  label: string;
  model: string | null;
  notes: string | null;
  status: LoanerStatus;
  updatedAt: string;
}

export interface LoanerDeviceInput {
  active?: boolean;
  brand?: string;
  imei?: string;
  label: string;
  model?: string;
  notes?: string;
}

export async function fetchLoanerDevices(): Promise<LoanerDevice[]> {
  const res = await api.get("/loaners");
  return res.data as LoanerDevice[];
}

export async function createLoanerDevice(
  input: LoanerDeviceInput
): Promise<LoanerDevice> {
  const res = await api.post("/loaners", input);
  return res.data as LoanerDevice;
}

export async function updateLoanerDevice(
  id: string,
  input: Partial<LoanerDeviceInput>
): Promise<LoanerDevice> {
  const res = await api.patch(`/loaners/${id}`, input);
  return res.data as LoanerDevice;
}

/** Stamps the open loan as physically returned — returns the job it closed. */
export async function markLoanerReturned(
  id: string
): Promise<{ jobCode: string; jobId: string }> {
  const res = await api.post(`/loaners/${id}/return`);
  return res.data as { jobCode: string; jobId: string };
}
