export interface ActivityItem {
  action: string;
  createdAt: string;
  fromValue: string | null;
  id: string;
  metadata?: { jobId?: string } | null;
  toValue: string | null;
}

export interface SessionItem {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  isCurrent: boolean;
  userAgent: string | null;
}

export const LABEL_CLS =
  "block font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-2";

export const LANGUAGE_OPTIONS = [
  { value: "pt", label: "Português" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];
