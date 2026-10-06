import { useState } from "react";
import type { CreatedCustomerData } from "@/components/modules/jobs/quick-add-customer";
import QuickAddCustomer from "@/components/modules/jobs/quick-add-customer";
import type { BrandSearchResult } from "@/hooks/use-brand-search";
import { useClickOutside } from "@/hooks/use-click-outside";
import type { CustomerSearchResult } from "@/hooks/use-customer-search";
import type { ModelSearchResult } from "@/hooks/use-model-search";
import type { CaptureSource } from "@/hooks/use-native-camera";
import BrandSearchDropdown from "./brand-search-dropdown";
import CustomerSearchDropdown from "./customer-search-dropdown";
import ModelSearchDropdown from "./model-search-dropdown";
import PhotoUploadZone from "./photo-upload-zone";
import {
  errorCls,
  type IntakeFormData,
  inputCls,
  inputErrorCls,
  labelCls,
  requiredMarkCls,
} from "./types";

interface Step1Props {
  brandAddQuery: string;
  brandCreateError: string | null;
  brandQuery: string;
  brandResults: BrandSearchResult[];
  brandSearchError: boolean;
  clearBrandSearch: () => void;
  clearCustomer: () => void;
  clearModelSearch: () => void;
  errors: Partial<Record<keyof IntakeFormData, string>>;
  form: IntakeFormData;
  handleBlur: (field: keyof IntakeFormData) => void;
  handleBrandAdd: () => void;
  handleModelAdd: () => void;
  handleNativeCapture: (source: CaptureSource) => Promise<void>;
  handlePhotoRemove: (index: number) => void;
  handlePhotoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleQuickAdd: (data: CreatedCustomerData) => void;
  isCapturing: boolean;
  isCreatingBrand: boolean;
  isCreatingModel: boolean;
  isNative: boolean;
  isSearching: boolean;
  isSearchingBrand: boolean;
  isSearchingModel: boolean;
  modelAddQuery: string;
  modelCreateError: string | null;
  modelQuery: string;
  modelResults: ModelSearchResult[];
  modelSearchError: boolean;
  photoError: string | null;
  photoPreviews: { file: File; url: string }[];
  query: string;
  results: CustomerSearchResult[];
  searchBrands: (q: string) => Promise<void>;
  searchError: boolean;
  searchModels: (q: string) => Promise<void>;
  selectBrand: (brand: BrandSearchResult) => void;
  selectCustomer: (customer: CustomerSearchResult) => void;
  selectModel: (model: ModelSearchResult) => void;
  setBrandQuery: (q: string) => void;
  setModelQuery: (q: string) => void;
  setQuery: (q: string) => void;
  setShowQuickAdd: (v: boolean) => void;
  showBrandAddOption: boolean;
  showModelAddOption: boolean;
  showQuickAdd: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  touched: Partial<Record<keyof IntakeFormData, boolean>>;
  update: <K extends keyof IntakeFormData>(
    key: K,
    value: IntakeFormData[K]
  ) => void;
}

function CustomerSearchField({
  clearCustomer,
  errors,
  form,
  handleBlur,
  isSearching,
  query,
  results,
  searchError,
  selectCustomer,
  setQuery,
  setShowQuickAdd,
  t,
  touched,
  update,
}: Pick<
  Step1Props,
  | "clearCustomer"
  | "errors"
  | "form"
  | "handleBlur"
  | "isSearching"
  | "query"
  | "results"
  | "searchError"
  | "selectCustomer"
  | "setQuery"
  | "setShowQuickAdd"
  | "t"
  | "touched"
  | "update"
>) {
  const searchOutsideRef = useClickOutside(() => setSearchFocused(false));
  const [searchFocused, setSearchFocused] = useState(false);
  const showDropdown = searchFocused && query.length >= 1 && !form.customerId;
  const nameError = errors.customerName && touched.customerName;

  return (
    <div className="relative" ref={searchOutsideRef}>
      <label className={labelCls} htmlFor="customer-search">
        {t("intake.customer_search")}
        <span className={requiredMarkCls}>*</span>
      </label>
      <div className="relative">
        <span className="material-symbols-outlined absolute end-4 top-1/2 -translate-y-1/2 text-outline">
          {form.customerId ? "check_circle" : "search"}
        </span>
        <input
          aria-describedby={nameError ? "error-customer-name" : undefined}
          aria-invalid={!!nameError}
          className={nameError ? inputErrorCls : inputCls}
          id="customer-search"
          maxLength={120}
          onBlur={() => handleBlur("customerName")}
          onChange={(e) => {
            const val = e.target.value;
            update("customerId", "");
            update("customerName", val);
            setQuery(val);
          }}
          onFocus={() => setSearchFocused(true)}
          placeholder={t("intake.customer_search_placeholder")}
          required
          type="text"
          value={form.customerName}
        />
        {form.customerId && (
          <button
            aria-label={t("intake.clear_customer")}
            className="absolute end-12 top-1/2 -translate-y-1/2 text-outline transition-colors hover:text-on-surface"
            onClick={() => {
              clearCustomer();
              setSearchFocused(false);
            }}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>

      <CustomerSearchDropdown
        isSearching={isSearching}
        onCreateNew={() => {
          setShowQuickAdd(true);
          setSearchFocused(false);
        }}
        onSelect={(c) => {
          selectCustomer(c);
          setSearchFocused(false);
        }}
        query={query}
        results={results}
        searchError={searchError}
        t={t}
        visible={showDropdown}
      />

      {form.customerId && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary-container px-3 py-1.5">
          <span className="material-symbols-outlined text-on-primary-container text-sm">
            verified
          </span>
          <span className="font-label font-medium text-on-primary-container text-xs">
            {t("intake.customer_linked")}
          </span>
        </div>
      )}

      {nameError && (
        <p className={errorCls} id="error-customer-name">
          {errors.customerName}
        </p>
      )}
    </div>
  );
}

function BrandField({
  brandAddQuery,
  brandCreateError,
  brandQuery,
  brandResults,
  brandSearchError,
  clearBrandSearch,
  clearModelSearch,
  form,
  handleBrandAdd,
  handleBlur,
  isCreatingBrand,
  isSearchingBrand,
  searchBrands,
  selectBrand,
  setBrandQuery,
  showBrandAddOption,
  t,
  update,
}: Pick<
  Step1Props,
  | "brandAddQuery"
  | "brandCreateError"
  | "brandQuery"
  | "brandResults"
  | "brandSearchError"
  | "clearBrandSearch"
  | "clearModelSearch"
  | "form"
  | "handleBrandAdd"
  | "handleBlur"
  | "isCreatingBrand"
  | "isSearchingBrand"
  | "searchBrands"
  | "selectBrand"
  | "setBrandQuery"
  | "showBrandAddOption"
  | "t"
  | "update"
>) {
  const brandOutsideRef = useClickOutside(() => setBrandFocused(false));
  const [brandFocused, setBrandFocused] = useState(false);
  const showBrandDropdown = brandFocused && !form.brandId;

  return (
    <div className="relative" ref={brandOutsideRef}>
      <label className={labelCls} htmlFor="device-brand">
        {t("intake.brand")}
      </label>
      <div className="relative">
        <span className="material-symbols-outlined absolute end-4 top-1/2 -translate-y-1/2 text-outline">
          {form.brandId ? "check_circle" : "search"}
        </span>
        <input
          className={inputCls}
          id="device-brand"
          maxLength={60}
          onBlur={() => handleBlur("brand")}
          onChange={(e) => {
            const val = e.target.value;
            update("brandId", "");
            update("brand", val);
            setBrandQuery(val);
          }}
          onFocus={() => {
            setBrandFocused(true);
            searchBrands(brandQuery);
          }}
          placeholder={t("intake.brand_search_placeholder")}
          type="text"
          value={form.brand}
        />
        {form.brandId && (
          <button
            aria-label={t("intake.clear_brand")}
            className="absolute end-12 top-1/2 -translate-y-1/2 text-outline transition-colors hover:text-on-surface"
            onClick={() => {
              update("brandId", "");
              update("brand", "");
              update("modelId", "");
              update("model", "");
              clearBrandSearch();
              clearModelSearch();
            }}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
      <BrandSearchDropdown
        isCreating={isCreatingBrand}
        isSearching={isSearchingBrand}
        onAdd={handleBrandAdd}
        onSelect={(b) => {
          selectBrand(b);
          setBrandFocused(false);
        }}
        query={brandAddQuery}
        results={brandResults}
        searchError={brandSearchError}
        showAddOption={showBrandAddOption}
        t={t}
        visible={showBrandDropdown}
      />
      {brandCreateError && <p className={errorCls}>{brandCreateError}</p>}
    </div>
  );
}

function ModelField({
  clearModelSearch,
  errors,
  form,
  handleBlur,
  handleModelAdd,
  isCreatingModel,
  isSearchingModel,
  modelAddQuery,
  modelCreateError,
  modelQuery,
  modelResults,
  modelSearchError,
  searchModels,
  selectModel,
  setModelQuery,
  showModelAddOption,
  t,
  touched,
  update,
}: Pick<
  Step1Props,
  | "clearModelSearch"
  | "errors"
  | "form"
  | "handleBlur"
  | "handleModelAdd"
  | "isCreatingModel"
  | "isSearchingModel"
  | "modelAddQuery"
  | "modelCreateError"
  | "modelQuery"
  | "modelResults"
  | "modelSearchError"
  | "searchModels"
  | "selectModel"
  | "setModelQuery"
  | "showModelAddOption"
  | "t"
  | "touched"
  | "update"
>) {
  const modelOutsideRef = useClickOutside(() => setModelFocused(false));
  const [modelFocused, setModelFocused] = useState(false);
  const showModelDropdown = modelFocused && !!form.brandId && !form.modelId;

  return (
    <div className="relative" ref={modelOutsideRef}>
      <label className={labelCls} htmlFor="device-model">
        {t("intake.model")}
        <span className={requiredMarkCls}>*</span>
      </label>
      <div className="relative">
        <span className="material-symbols-outlined absolute end-4 top-1/2 -translate-y-1/2 text-outline">
          {form.modelId ? "check_circle" : "search"}
        </span>
        <input
          aria-describedby={
            errors.model && touched.model ? "error-model" : undefined
          }
          aria-invalid={!!(errors.model && touched.model)}
          className={errors.model && touched.model ? inputErrorCls : inputCls}
          id="device-model"
          maxLength={120}
          onBlur={() => handleBlur("model")}
          onChange={(e) => {
            const val = e.target.value;
            update("modelId", "");
            update("model", val);
            setModelQuery(val);
          }}
          onFocus={() => {
            setModelFocused(true);
            searchModels(modelQuery);
          }}
          placeholder={
            form.brandId
              ? t("intake.model_search_placeholder")
              : t("intake.select_brand_first")
          }
          required
          type="text"
          value={form.model}
        />
        {form.modelId && (
          <button
            aria-label={t("intake.clear_model")}
            className="absolute end-12 top-1/2 -translate-y-1/2 text-outline transition-colors hover:text-on-surface"
            onClick={() => {
              update("modelId", "");
              update("model", "");
              clearModelSearch();
            }}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
      <ModelSearchDropdown
        disabled={!form.brandId}
        isCreating={isCreatingModel}
        isSearching={isSearchingModel}
        onAdd={handleModelAdd}
        onSelect={(m) => {
          selectModel(m);
          setModelFocused(false);
        }}
        query={modelAddQuery}
        results={modelResults}
        searchError={modelSearchError}
        showAddOption={showModelAddOption}
        t={t}
        visible={showModelDropdown}
      />
      {modelCreateError && <p className={errorCls}>{modelCreateError}</p>}
      {errors.model && touched.model && (
        <p className={errorCls} id="error-model">
          {errors.model}
        </p>
      )}
    </div>
  );
}

export default function Step1Content(props: Step1Props) {
  const {
    brandAddQuery,
    brandCreateError,
    brandQuery,
    brandResults,
    brandSearchError,
    clearBrandSearch,
    clearCustomer,
    clearModelSearch,
    errors,
    form,
    handleBrandAdd,
    handleBlur,
    handleModelAdd,
    handleNativeCapture,
    handlePhotoRemove,
    handlePhotoSelect,
    handleQuickAdd,
    isCapturing,
    isCreatingBrand,
    isCreatingModel,
    isNative,
    isSearching,
    isSearchingBrand,
    isSearchingModel,
    modelAddQuery,
    modelCreateError,
    modelQuery,
    modelResults,
    modelSearchError,
    photoError,
    photoPreviews,
    query,
    results,
    searchBrands,
    searchError,
    searchModels,
    selectBrand,
    selectCustomer,
    selectModel,
    setBrandQuery,
    setModelQuery,
    setQuery,
    setShowQuickAdd,
    showBrandAddOption,
    showModelAddOption,
    showQuickAdd,
    t,
    touched,
    update,
  } = props;

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-4 md:p-8">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold font-headline text-lg text-on-surface">
              <span className="material-symbols-outlined text-primary">
                person
              </span>
              {t("intake.customer_section")}
            </h2>
            <button
              className="flex items-center gap-1.5 rounded-full bg-secondary-container px-3 py-1.5 font-bold font-label text-on-secondary-container text-xs transition-colors hover:bg-surface-container-high"
              onClick={() => setShowQuickAdd(!showQuickAdd)}
              type="button"
            >
              <span className="material-symbols-outlined text-sm">
                person_add
              </span>
              {t("intake.add_customer")}
            </button>
          </div>

          {showQuickAdd && (
            <>
              <div className="fixed inset-0 z-10 bg-overlay backdrop-blur-sm" />
              <div className="relative z-20">
                <QuickAddCustomer
                  onAdd={(data) => {
                    handleQuickAdd(data);
                  }}
                  onClose={() => setShowQuickAdd(false)}
                />
              </div>
            </>
          )}

          <div className="space-y-4">
            <CustomerSearchField
              clearCustomer={clearCustomer}
              errors={errors}
              form={form}
              handleBlur={handleBlur}
              isSearching={isSearching}
              query={query}
              results={results}
              searchError={searchError}
              selectCustomer={selectCustomer}
              setQuery={setQuery}
              setShowQuickAdd={setShowQuickAdd}
              t={t}
              touched={touched}
              update={update}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="customer-phone">
                  {t("intake.phone")}
                  <span className={requiredMarkCls}>*</span>
                </label>
                <input
                  aria-describedby={
                    errors.customerPhone && touched.customerPhone
                      ? "error-customer-phone"
                      : undefined
                  }
                  aria-invalid={
                    !!(errors.customerPhone && touched.customerPhone)
                  }
                  className={
                    errors.customerPhone && touched.customerPhone
                      ? inputErrorCls
                      : inputCls
                  }
                  id="customer-phone"
                  maxLength={32}
                  onBlur={() => handleBlur("customerPhone")}
                  onChange={(e) => update("customerPhone", e.target.value)}
                  placeholder="+351..."
                  required
                  type="tel"
                  value={form.customerPhone}
                />
                {errors.customerPhone && touched.customerPhone && (
                  <p className={errorCls} id="error-customer-phone">
                    {errors.customerPhone}
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls} htmlFor="customer-email">
                  {t("intake.email")}
                </label>
                <input
                  aria-describedby={
                    errors.customerEmail && touched.customerEmail
                      ? "error-customer-email"
                      : undefined
                  }
                  aria-invalid={
                    !!(errors.customerEmail && touched.customerEmail)
                  }
                  className={
                    errors.customerEmail && touched.customerEmail
                      ? inputErrorCls
                      : inputCls
                  }
                  id="customer-email"
                  maxLength={254}
                  onChange={(e) => update("customerEmail", e.target.value)}
                  placeholder={t("intake.email_placeholder")}
                  type="email"
                  value={form.customerEmail}
                />
                {errors.customerEmail && touched.customerEmail && (
                  <p className={errorCls} id="error-customer-email">
                    {errors.customerEmail}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="flex items-center gap-2 font-bold font-headline text-lg text-on-surface">
            <span className="material-symbols-outlined text-primary">
              smartphone
            </span>
            {t("intake.device_section")}
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BrandField
              brandAddQuery={brandAddQuery}
              brandCreateError={brandCreateError}
              brandQuery={brandQuery}
              brandResults={brandResults}
              brandSearchError={brandSearchError}
              clearBrandSearch={clearBrandSearch}
              clearModelSearch={clearModelSearch}
              form={form}
              handleBlur={handleBlur}
              handleBrandAdd={handleBrandAdd}
              isCreatingBrand={isCreatingBrand}
              isSearchingBrand={isSearchingBrand}
              searchBrands={searchBrands}
              selectBrand={selectBrand}
              setBrandQuery={setBrandQuery}
              showBrandAddOption={showBrandAddOption}
              t={t}
              update={update}
            />
            <ModelField
              clearModelSearch={clearModelSearch}
              errors={errors}
              form={form}
              handleBlur={handleBlur}
              handleModelAdd={handleModelAdd}
              isCreatingModel={isCreatingModel}
              isSearchingModel={isSearchingModel}
              modelAddQuery={modelAddQuery}
              modelCreateError={modelCreateError}
              modelQuery={modelQuery}
              modelResults={modelResults}
              modelSearchError={modelSearchError}
              searchModels={searchModels}
              selectModel={selectModel}
              setModelQuery={setModelQuery}
              showModelAddOption={showModelAddOption}
              t={t}
              touched={touched}
              update={update}
            />
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="device-color">
                {t("intake.device_color")}
              </label>
              <input
                className={inputCls}
                id="device-color"
                maxLength={40}
                onChange={(e) => update("color", e.target.value)}
                placeholder={t("intake.color_placeholder")}
                type="text"
                value={form.color}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="device-imei">
                {t("intake.imei")}
              </label>
              <input
                aria-describedby={
                  errors.imei && touched.imei ? "error-device-imei" : undefined
                }
                aria-invalid={!!(errors.imei && touched.imei)}
                className={
                  errors.imei && touched.imei ? inputErrorCls : inputCls
                }
                id="device-imei"
                inputMode="numeric"
                onChange={(e) => update("imei", e.target.value)}
                placeholder={t("intake.imei_placeholder")}
                type="text"
                value={form.imei}
              />
              {errors.imei && touched.imei && (
                <p className={errorCls} id="error-device-imei">
                  {errors.imei}
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="device-unlock">
                {t("intake.unlock_code")}
              </label>
              <input
                className={inputCls}
                id="device-unlock"
                maxLength={64}
                onChange={(e) => update("deviceUnlockCode", e.target.value)}
                placeholder={t("intake.unlock_code_placeholder")}
                type="text"
                value={form.deviceUnlockCode}
              />
            </div>
            <div className="sm:col-span-2">
              <PhotoUploadZone
                isCapturing={isCapturing}
                isNative={isNative}
                onNativeCapture={handleNativeCapture}
                onPhotoRemove={handlePhotoRemove}
                onPhotoSelect={handlePhotoSelect}
                photoCount={form.photos.length}
                photoError={photoError}
                photoPreviews={photoPreviews}
                t={t}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
