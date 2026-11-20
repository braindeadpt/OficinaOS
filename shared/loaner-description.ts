/**
 * Printable description of a fleet loaner unit — label + spec + IMEI. Shared
 * between the server (checkout fallback, job reassignment) and the intake
 * picker so both always produce the same text. Keep generated length within
 * the job schema's loanerNote limit (360).
 */
export function describeLoanerDevice(device: {
  brand?: string | null;
  imei?: string | null;
  label: string;
  model?: string | null;
}): string {
  const spec = [device.brand, device.model].filter(Boolean).join(" ");
  const suffix = device.imei ? ` · IMEI ${device.imei}` : "";
  return spec
    ? `${device.label} (${spec})${suffix}`
    : `${device.label}${suffix}`;
}
