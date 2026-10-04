import { toast } from "sonner";
import i18n from "@/i18n";
import api from "@/lib/api";
import { useSettingsStore } from "@/stores/settings";

// When the shop has a network thermal printer configured (ESC/POS over TCP),
// receipts are printed server-side with no OS dialog. Anything else falls
// back to the browser print dialog, which works with any installed printer.
export function usesThermalPrinter(): boolean {
  const s = useSettingsStore.getState().shopSettings;
  // A4 paper means the shop wants full-page documents — always the dialog.
  return (
    s?.printerMode === "escpos" && !!s.printerHost && s.receiptPaper !== "a4"
  );
}

export async function printJobReceipt(jobId: string): Promise<void> {
  if (!usesThermalPrinter()) {
    window.open(`/api/receipts/${jobId}/receipt`, "_blank");
    return;
  }
  try {
    await api.post(`/receipts/${jobId}/print`);
    toast.success(i18n.t("print_sent"));
  } catch {
    toast.error(i18n.t("print_send_failed"));
  }
}

export async function printSaleReceipt(saleId: string): Promise<void> {
  if (!usesThermalPrinter()) {
    window.open(`/api/sales/${saleId}/receipt`, "_blank");
    return;
  }
  try {
    await api.post(`/sales/${saleId}/print-receipt`);
    toast.success(i18n.t("print_sent"));
  } catch {
    toast.error(i18n.t("print_send_failed"));
  }
}
