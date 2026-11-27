import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import api, { getErrorMessage } from "@/lib/api";

interface DuplicateCustomer {
  createdAt: string;
  email: string | null;
  id: string;
  jobCount: number;
  name: string;
  phone: string;
  saleCount: number;
  taxId: string | null;
  whatsappConsent: boolean;
}

interface DuplicateGroup {
  customers: DuplicateCustomer[];
  normalizedPhone: string;
}

interface MergePreview {
  email: string | null;
  jobCount: number;
  saleCount: number;
  taxId: string | null;
  whatsappConsent: boolean;
}

/**
 * Possíveis duplicados por número normalizado (issue #77): relatório
 * informativo com junção manual par a par. A pré-visualização mostra o
 * que fica antes de confirmar; a junção é auditada no servidor.
 */
export default function SettingsDuplicatesSection() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [preview, setPreview] = useState<{
    data: MergePreview;
    groupKey: string;
    keepId: string;
    mergedId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get("/customers/duplicates");
      setGroups(res.data.groups ?? []);
    } catch {
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function openPreview(
    groupKey: string,
    keepId: string,
    mergedId: string
  ) {
    setBusy(true);
    try {
      const res = await api.post("/customers/merge/preview", {
        keepId,
        mergedId,
      });
      setPreview({ data: res.data, groupKey, keepId, mergedId });
    } catch (err) {
      toast.error(getErrorMessage(err, "Erro"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMerge() {
    if (!preview) {
      return;
    }
    setBusy(true);
    try {
      await api.post("/customers/merge", {
        keepId: preview.keepId,
        mergedId: preview.mergedId,
      });
      toast.success(t("duplicates.merged"));
      setPreview(null);
      await refresh();
    } catch (err) {
      toast.error(getErrorMessage(err, "Erro"));
    } finally {
      setBusy(false);
    }
  }

  if (groups === null) {
    return null;
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface p-4">
      <p className="font-medium text-on-surface text-sm">
        {t("duplicates.title")}
      </p>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("duplicates.hint")}
      </p>
      {groups.length === 0 ? (
        <p className="mt-3 text-on-surface-variant text-sm">
          {t("duplicates.none")}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((group) => (
            <div
              className="rounded-lg border border-outline-variant p-3"
              key={group.normalizedPhone}
            >
              <p className="mb-2 text-on-surface-variant text-xs">
                {t("duplicates.same_number", {
                  number: group.normalizedPhone,
                })}
              </p>
              <div className="flex flex-col gap-2">
                {group.customers.map((customer) => {
                  const others = group.customers.filter(
                    (c) => c.id !== customer.id
                  );
                  return (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2"
                      key={customer.id}
                    >
                      <div className="text-sm">
                        <span className="font-medium text-on-surface">
                          {customer.name}
                        </span>{" "}
                        <span className="text-on-surface-variant">
                          {customer.phone} ·{" "}
                          {t("duplicates.counts", {
                            jobs: customer.jobCount,
                            sales: customer.saleCount,
                          })}
                          {customer.email ? ` · ${customer.email}` : ""}
                          {customer.taxId ? ` · ${customer.taxId}` : ""}
                        </span>
                      </div>
                      {others.length === 1 && others[0] ? (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            openPreview(
                              group.normalizedPhone,
                              customer.id,
                              others[0].id
                            )
                          }
                          size="sm"
                          variant="secondary"
                        >
                          {t("duplicates.keep_this")}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {preview?.groupKey === group.normalizedPhone ? (
                <div className="mt-3 rounded-lg bg-surface-container p-3 text-sm">
                  <p className="font-medium text-on-surface">
                    {t("duplicates.preview_title")}
                  </p>
                  <ul className="mt-1 text-on-surface-variant">
                    <li>
                      {t("duplicates.preview_counts", {
                        jobs: preview.data.jobCount,
                        sales: preview.data.saleCount,
                      })}
                    </li>
                    <li>
                      {t("duplicates.preview_email", {
                        value: preview.data.email ?? "—",
                      })}
                    </li>
                    <li>
                      {t("duplicates.preview_taxid", {
                        value: preview.data.taxId ?? "—",
                      })}
                    </li>
                    <li>
                      {preview.data.whatsappConsent
                        ? t("duplicates.preview_consent_yes")
                        : t("duplicates.preview_consent_no")}
                    </li>
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <Button disabled={busy} onClick={confirmMerge} size="sm">
                      {t("duplicates.confirm_merge")}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => setPreview(null)}
                      size="sm"
                      variant="secondary"
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
