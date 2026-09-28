import { COUNTRIES, CURRENCIES } from "@shared/constants";
import type { FormEvent } from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPhonePlaceholder } from "@/lib/phone-formats";
import { useSettingsStore } from "@/stores/settings";

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
    countryCode: "DZ",
    currency: "DZD",
    receiptFooter: "",
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
        countryCode: shopSettings.countryCode ?? "DZ",
        currency: shopSettings.currency ?? "DZD",
        receiptFooter: shopSettings.receiptFooter ?? "",
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
              className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
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
              className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
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
            className="w-full resize-none rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
            id="shop-address"
            onChange={(e) => {
              setShopForm((f) => ({ ...f, address: e.target.value }));
              onDirtyChange(true);
            }}
            placeholder="123 Rue Didouche Mourad, Algiers"
            rows={3}
            value={shopForm.address}
          />
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
                className="w-full cursor-pointer appearance-none rounded-xl border-none bg-surface-container-lowest px-4 py-3 pe-10 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
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
                className="w-full cursor-pointer appearance-none rounded-xl border-none bg-surface-container-lowest px-4 py-3 pe-10 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
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
              className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
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
    </form>
  );
}
