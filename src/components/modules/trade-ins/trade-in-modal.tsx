import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CustomerSearchDropdown from "@/components/modules/jobs/intake-modal/customer-search-dropdown";
import FunctionalChecklist from "@/components/modules/jobs/intake-modal/functional-checklist";
import type { IntakeChecklist } from "@/components/modules/jobs/intake-modal/types";
import QuickAddCustomer from "@/components/modules/jobs/quick-add-customer";
import SignaturePad from "@/components/reports/signature-pad";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCustomerSearch } from "@/hooks/use-customer-search";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { getErrorMessage } from "@/lib/api";
import { createTradeIn, type TradeIn } from "@/lib/api-trade-ins";

const labelCls = "mb-1.5 block font-medium text-on-surface text-sm";

const chevron = (
  <Icon
    className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
    name="expand_more"
    size="sm"
  />
);

const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
const PAYMENT_METHODS = ["CASH", "TRANSFER", "STORE_CREDIT"] as const;
const ID_TYPES = ["CC", "PASSPORT", "NIF", "OTHER"] as const;

interface Props {
  onClose: () => void;
  onCreated: (tradeIn: TradeIn) => void;
}

export default function TradeInModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [customerId, setCustomerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [sellerIdType, setSellerIdType] = useState<string>("CC");
  const [sellerIdNumber, setSellerIdNumber] = useState("");
  const [deviceBrand, setDeviceBrand] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [imei, setImei] = useState("");
  const [storage, setStorage] = useState("");
  const [condition, setCondition] = useState<string>("GOOD");
  const [checklist, setChecklist] = useState<IntakeChecklist>({});
  const [notes, setNotes] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { query, setQuery, results, isSearching, searchError } =
    useCustomerSearch();
  const [searchFocused, setSearchFocused] = useState(false);
  const showDropdown = searchFocused && query.length >= 1 && !customerId;

  useModalEffects(true, onClose, dialogRef);

  const price = Number(purchasePrice.replace(",", "."));
  const valid =
    customerId &&
    sellerIdNumber.trim().length >= 4 &&
    deviceBrand.trim() &&
    deviceModel.trim() &&
    Number.isFinite(price) &&
    price >= 0;

  const submit = async () => {
    if (!(valid && signature)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const tradeIn = await createTradeIn({
        condition,
        customerId,
        deviceBrand: deviceBrand.trim(),
        deviceModel: deviceModel.trim(),
        functionalChecklist:
          Object.keys(checklist).length > 0
            ? (Object.fromEntries(
                Object.entries(checklist).filter(([, v]) => v != null)
              ) as Record<string, "ok" | "fail">)
            : undefined,
        imei: imei.trim() || undefined,
        notes: notes.trim() || undefined,
        paymentMethod,
        purchasePrice: price,
        sellerIdNumber: sellerIdNumber.trim(),
        sellerIdType,
        signatureDataUrl: signature ?? undefined,
        storage: storage.trim() || undefined,
      });
      onCreated(tradeIn);
    } catch (err) {
      setError(getErrorMessage(err, t("tradeins.create_failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      aria-labelledby="ti-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      ref={dialogRef}
      role="dialog"
    >
      <button
        aria-label={t("close")}
        className="absolute inset-0 bg-on-surface/40"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 bg-surface-container-low px-6 py-4">
          <span className="material-symbols-outlined text-2xl text-primary">
            currency_exchange
          </span>
          <div className="flex-1">
            <h2
              className="font-bold font-headline text-lg text-on-surface"
              id="ti-title"
            >
              {t("tradeins.new")}
            </h2>
            <p className="font-label text-on-surface-variant text-xs">
              {t("tradeins.new_subtitle")}
            </p>
          </div>
          <button
            aria-label={t("close")}
            className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="relative" id="ti-customer-wrap">
            <Field label={t("tradeins.seller")}>
              <Input
                autoComplete="off"
                iconStart={customerId ? "check_circle" : "search"}
                id="ti-customer"
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCustomerId("");
                  setCustomerLabel("");
                }}
                onFocus={() => setSearchFocused(true)}
                placeholder={t("intake.customer_search_placeholder")}
                type="text"
                value={customerId ? customerLabel : query}
              />
            </Field>
            <CustomerSearchDropdown
              isSearching={isSearching}
              onCreateNew={() => setShowCreateCustomer(true)}
              onSelect={(c) => {
                setCustomerId(c.id);
                setCustomerLabel(`${c.name} · ${c.phone}`);
                setSearchFocused(false);
              }}
              query={query}
              results={results}
              searchError={searchError}
              t={t}
              visible={showDropdown}
            />
          </div>

          {showCreateCustomer && (
            <div className="rounded-xl bg-surface-container-low p-4">
              <QuickAddCustomer
                onAdd={(c) => {
                  setCustomerId(c.id);
                  setCustomerLabel(`${c.name} · ${c.phone}`);
                  setShowCreateCustomer(false);
                }}
                onClose={() => setShowCreateCustomer(false)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field endAdornment={chevron} label={t("tradeins.id_type")}>
              <Select
                id="ti-idtype"
                onChange={(e) => setSellerIdType(e.target.value)}
                value={sellerIdType}
              >
                {ID_TYPES.map((idt) => (
                  <option key={idt} value={idt}>
                    {t(`tradeins.id_type_${idt.toLowerCase()}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("tradeins.id_number")}>
              <Input
                id="ti-idnum"
                onChange={(e) => setSellerIdNumber(e.target.value)}
                placeholder="12345678"
                type="text"
                value={sellerIdNumber}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tradeins.brand")}>
              <Input
                id="ti-brand"
                onChange={(e) => setDeviceBrand(e.target.value)}
                placeholder="Apple"
                type="text"
                value={deviceBrand}
              />
            </Field>
            <Field label={t("tradeins.model")}>
              <Input
                id="ti-model"
                onChange={(e) => setDeviceModel(e.target.value)}
                placeholder="iPhone 12"
                type="text"
                value={deviceModel}
              />
            </Field>
            <Field label={t("tradeins.imei")}>
              <Input
                id="ti-imei"
                onChange={(e) => setImei(e.target.value)}
                type="text"
                value={imei}
              />
            </Field>
            <Field label={t("tradeins.storage")}>
              <Input
                id="ti-storage"
                onChange={(e) => setStorage(e.target.value)}
                placeholder="128GB"
                type="text"
                value={storage}
              />
            </Field>
          </div>

          <Field endAdornment={chevron} label={t("tradeins.condition")}>
            <Select
              id="ti-condition"
              onChange={(e) => setCondition(e.target.value)}
              value={condition}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`tradeins.condition_${c.toLowerCase()}`)}
                </option>
              ))}
            </Select>
          </Field>

          <FunctionalChecklist
            onChange={setChecklist}
            t={t}
            value={checklist}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tradeins.price")}>
              <Input
                id="ti-price"
                inputMode="decimal"
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="150.00"
                type="text"
                value={purchasePrice}
              />
            </Field>
            <Field endAdornment={chevron} label={t("tradeins.payment")}>
              <Select
                id="ti-pay"
                onChange={(e) => setPaymentMethod(e.target.value)}
                value={paymentMethod}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`tradeins.pay_${m.toLowerCase()}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label={t("tradeins.notes")}>
            <Textarea
              className="min-h-20 resize-y"
              id="ti-notes"
              onChange={(e) => setNotes(e.target.value)}
              value={notes}
            />
          </Field>

          <div>
            <p className={labelCls}>{t("tradeins.signature")}</p>
            <p className="mb-2 font-label text-on-surface-variant text-xs">
              {t("tradeins.signature_help")}
            </p>
            <SignaturePad onChange={setSignature} />
          </div>

          {error && <p className="text-error text-sm">{error}</p>}
        </div>

        <footer className="flex shrink-0 gap-3 border-outline-variant border-t bg-surface-container-low px-6 py-4">
          <button
            className="flex-1 rounded-xl bg-surface-container-high px-4 py-3 font-bold font-headline text-on-surface text-sm"
            onClick={onClose}
            type="button"
          >
            {t("cancel")}
          </button>
          <button
            className="flex-1 rounded-xl bg-primary px-4 py-3 font-bold font-headline text-on-primary text-sm disabled:opacity-50"
            disabled={!(valid && signature) || saving}
            onClick={submit}
            type="button"
          >
            {saving ? t("saving") : t("tradeins.create")}
          </button>
        </footer>
      </div>
    </div>
  );
}
