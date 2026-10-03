import { COUNTRIES, CURRENCIES } from "@shared/constants";
import type { FormEvent } from "react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { getPhonePlaceholder } from "@/lib/phone-formats";
import { useSettingsStore } from "@/stores/settings";

interface RemoteBackupStatus {
  lastRemoteCopyAt: string | null;
  lastRestoreCheckAt: string | null;
  remoteCopyHoursAgo: number | null;
  remoteCopyStale: boolean;
  restoreCheckDaysAgo: number | null;
  restoreCheckStale: boolean;
}

interface BackupStatus {
  dumpCount: number;
  hoursAgo: number | null;
  lastBackupAt: string | null;
  remote: RemoteBackupStatus;
  remoteConfigured: boolean;
  stale: boolean;
}

function BackupStatusCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BackupStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get("/settings/backups/status");
      setStatus(res.data as BackupStatus);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[20px]"
        >
          settings_backup_restore
        </span>
        <h3 className="font-bold font-headline text-on-surface text-sm">
          {t("backups_title")}
        </h3>
        <span
          className={`ml-auto h-2.5 w-2.5 rounded-full ${
            status && !status.stale && status.lastBackupAt
              ? "bg-primary"
              : "bg-error"
          }`}
        />
      </div>
      <p className="mt-2 font-body text-on-surface-variant text-sm">
        {status?.lastBackupAt
          ? t("backups_last", {
              count: status.dumpCount,
              hours: status.hoursAgo ?? 0,
            })
          : t("backups_missing")}
      </p>
      {status?.stale && status.lastBackupAt && (
        <p className="mt-1 font-label text-error text-xs">
          {t("backups_stale")}
        </p>
      )}

      {status?.remoteConfigured && <RemoteBackupRows remote={status.remote} />}
    </div>
  );
}

function RemoteBackupRows({ remote }: { remote: RemoteBackupStatus }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-1 border-outline-variant border-t pt-2">
      <p className="flex items-center gap-1.5 font-label text-on-surface-variant text-xs">
        <span
          aria-hidden="true"
          className={`material-symbols-outlined text-[14px] ${
            remote.remoteCopyStale ? "text-error" : "text-primary"
          }`}
        >
          cloud_upload
        </span>
        {t("backups_remote_copy", {
          hours: remote.remoteCopyHoursAgo ?? 0,
        })}
        {remote.remoteCopyStale && (
          <span className="font-bold text-error">
            {t("backups_remote_stale")}
          </span>
        )}
      </p>
      <p className="flex items-center gap-1.5 font-label text-on-surface-variant text-xs">
        <span
          aria-hidden="true"
          className={`material-symbols-outlined text-[14px] ${
            remote.restoreCheckStale ? "text-error" : "text-primary"
          }`}
        >
          fact_check
        </span>
        {remote.lastRestoreCheckAt
          ? t("backups_restore_check", {
              count: remote.restoreCheckDaysAgo ?? 0,
            })
          : t("backups_restore_check_never")}
        {remote.restoreCheckStale && (
          <span className="font-bold text-error">
            {t("backups_restore_check_stale")}
          </span>
        )}
      </p>
    </div>
  );
}

export interface SettingsShopTabHandle {
  requestSubmit: () => void;
  reset: () => void;
}

interface SettingsShopTabProps {
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  onToast: (message: string, type: "success" | "error") => void;
  ref?: React.Ref<SettingsShopTabHandle>;
}

export default function SettingsShopTab({
  ref,
  onDirtyChange,
  onSavingChange,
  onToast,
}: SettingsShopTabProps) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);

  const { shopSettings, fetchShopSettings, saveShopSettings } =
    useSettingsStore();

  const [shopForm, setShopForm] = useState({
    shopName: "",
    address: "",
    phone: "",
    countryCode: "PT",
    currency: "EUR",
    receiptFooter: "",
    reviewUrl: "",
  });
  const [shopFormInitial, setShopFormInitial] = useState(shopForm);

  useImperativeHandle(ref, () => ({
    requestSubmit: () => formRef.current?.requestSubmit(),
    reset: () => setShopForm({ ...shopFormInitial }),
  }));

  useEffect(() => {
    if (shopSettings) {
      const form = {
        shopName: shopSettings.shopName ?? "",
        address: shopSettings.address ?? "",
        phone: shopSettings.phone ?? "",
        countryCode: shopSettings.countryCode ?? "PT",
        currency: shopSettings.currency ?? "EUR",
        receiptFooter: shopSettings.receiptFooter ?? "",
        reviewUrl: shopSettings.reviewUrl ?? "",
      };
      setShopForm(form);
      setShopFormInitial(form);
    }
  }, [shopSettings]);

  useEffect(() => {
    if (!shopSettings) {
      fetchShopSettings().catch((err) => {
        console.error("Failed to fetch shop settings:", err);
      });
    }
  }, [shopSettings, fetchShopSettings]);

  async function handleShopSubmit(e: FormEvent) {
    e.preventDefault();
    if (!shopForm.shopName.trim()) {
      onToast(t("settings_error_shop_name_required"), "error");
      return;
    }
    onSavingChange(true);
    try {
      await saveShopSettings(shopForm);
      setShopFormInitial({ ...shopForm });
      onDirtyChange(false);
      onToast(t("shop_config_saved"), "success");
    } catch {
      onToast(t("settings_save_error"), "error");
    } finally {
      onSavingChange(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleShopSubmit} ref={formRef}>
      <div className="rounded-2xl bg-surface-container-low p-5">
        <p className="mb-4 font-semibold text-on-surface text-sm">
          {t("shop_identity_label")}
        </p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <label
              className="block font-semibold text-on-surface text-sm"
              htmlFor="shop-name"
            >
              {t("shop_name")}
              <span aria-hidden="true" className="ms-0.5 text-error">
                *
              </span>
            </label>
            <input
              className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
              id="shop-name"
              onChange={(e) => {
                setShopForm((f) => ({ ...f, shopName: e.target.value }));
                onDirtyChange(true);
              }}
              placeholder="OficinaOS"
              required
              type="text"
              value={shopForm.shopName}
            />
          </div>
          <div className="space-y-2">
            <label
              className="block font-semibold text-on-surface text-sm"
              htmlFor="shop-phone"
            >
              {t("shop_phone")}
            </label>
            <input
              className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
              id="shop-phone"
              onChange={(e) => {
                setShopForm((f) => ({ ...f, phone: e.target.value }));
                onDirtyChange(true);
              }}
              placeholder={getPhonePlaceholder(shopForm.countryCode)}
              type="tel"
              value={shopForm.phone}
            />
          </div>
        </div>
        <div className="mt-6 space-y-2">
          <label
            className="block font-semibold text-on-surface text-sm"
            htmlFor="shop-address"
          >
            {t("shop_address")}
          </label>
          <textarea
            className="w-full resize-none rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
            id="shop-address"
            onChange={(e) => {
              setShopForm((f) => ({ ...f, address: e.target.value }));
              onDirtyChange(true);
            }}
            placeholder="Rua Augusta 123, Lisboa"
            rows={3}
            value={shopForm.address}
          />
        </div>
        <div className="mt-6">
          <Field
            hint={t(
              "shop_review_url_help",
              "Link where customers leave a review (e.g. your Google Business review link). Optional — shown on the tracking page after delivery and in the delivered message"
            )}
            label={t("shop_review_url")}
          >
            <Input
              onChange={(e) => {
                setShopForm((f) => ({ ...f, reviewUrl: e.target.value }));
                onDirtyChange(true);
              }}
              placeholder="https://"
              type="url"
              value={shopForm.reviewUrl}
            />
          </Field>
        </div>
      </div>
      <div className="rounded-2xl bg-surface-container-low p-5">
        <p className="mb-4 font-semibold text-on-surface text-sm">
          {t("regional_settings_label")}
        </p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <label
              className="block font-semibold text-on-surface text-sm"
              htmlFor="shop-country-code"
            >
              {t("country_code")}
            </label>
            <div className="relative">
              <select
                className="w-full cursor-pointer appearance-none rounded-xl border-none bg-surface-container-lowest px-4 py-3 pe-10 text-sm transition-all"
                id="shop-country-code"
                onChange={(e) => {
                  setShopForm((f) => ({
                    ...f,
                    countryCode: e.target.value,
                  }));
                  onDirtyChange(true);
                }}
                value={shopForm.countryCode}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
                <span className="material-symbols-outlined text-[20px]">
                  expand_more
                </span>
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <label
              className="block font-semibold text-on-surface text-sm"
              htmlFor="shop-currency"
            >
              {t("currency")}
            </label>
            <div className="relative">
              <select
                className="w-full cursor-pointer appearance-none rounded-xl border-none bg-surface-container-lowest px-4 py-3 pe-10 text-sm transition-all"
                id="shop-currency"
                onChange={(e) => {
                  setShopForm((f) => ({ ...f, currency: e.target.value }));
                  onDirtyChange(true);
                }}
                value={shopForm.currency}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
                <span className="material-symbols-outlined text-[20px]">
                  expand_more
                </span>
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <label
              className="block font-semibold text-on-surface text-sm"
              htmlFor="shop-receipt"
            >
              {t("receipt_footer")}
            </label>
            <input
              className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
              id="shop-receipt"
              onChange={(e) => {
                setShopForm((f) => ({ ...f, receiptFooter: e.target.value }));
                onDirtyChange(true);
              }}
              placeholder="Thanks for choosing OficinaOS!"
              type="text"
              value={shopForm.receiptFooter}
            />
          </div>
        </div>
      </div>

      <BackupStatusCard />
    </form>
  );
}
