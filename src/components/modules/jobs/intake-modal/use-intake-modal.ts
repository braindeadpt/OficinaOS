import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CreatedCustomerData } from "@/components/modules/jobs/quick-add-customer";
import type { BrandSearchResult } from "@/hooks/use-brand-search";
import { useBrandSearch } from "@/hooks/use-brand-search";
import type { CustomerSearchResult } from "@/hooks/use-customer-search";
import { useCustomerSearch } from "@/hooks/use-customer-search";
import type { ModelSearchResult } from "@/hooks/use-model-search";
import { useModelSearch } from "@/hooks/use-model-search";
import { type CaptureSource, useNativeCamera } from "@/hooks/use-native-camera";
import {
  defaultDeliveryDatetime,
  INITIAL_FORM,
  type IntakeFormData,
  type IntakeModalProps,
  MAX_PHOTOS,
  type PhotoPreview,
  REQUIRED_FIELDS,
} from "./types";

let overflowLockCount = 0;

export function useIntakeModal({
  open,
  onClose,
  onSubmit,
  prefill,
}: IntakeModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<IntakeFormData>(INITIAL_FORM);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<keyof IntakeFormData, string>>
  >({});
  const [touched, setTouched] = useState<
    Partial<Record<keyof IntakeFormData, boolean>>
  >({});

  const {
    isSearching,
    query,
    results,
    searchError,
    setQuery,
    clear: clearSearch,
  } = useCustomerSearch();

  const {
    clear: clearBrandSearch,
    createBrand,
    createError: brandCreateError,
    isCreating: isCreatingBrand,
    isSearching: isSearchingBrand,
    query: brandQuery,
    results: brandResults,
    search: searchBrands,
    searchError: brandSearchError,
    setQuery: setBrandQuery,
  } = useBrandSearch();

  const {
    clear: clearModelSearch,
    createError: modelCreateError,
    createModel,
    isCreating: isCreatingModel,
    isSearching: isSearchingModel,
    query: modelQuery,
    results: modelResults,
    search: searchModels,
    searchError: modelSearchError,
    setQuery: setModelQuery,
  } = useModelSearch(form.brandId);

  const brandAddQuery = brandQuery.trim();
  const showBrandAddOption =
    !form.brandId &&
    brandAddQuery.length >= 1 &&
    !brandResults.some(
      (r) => r.name.toLowerCase() === brandAddQuery.toLowerCase()
    );

  const modelAddQuery = modelQuery.trim();
  const showModelAddOption =
    !!form.brandId &&
    !form.modelId &&
    modelAddQuery.length >= 1 &&
    !modelResults.some(
      (r) => r.model.toLowerCase() === modelAddQuery.toLowerCase()
    );

  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreview[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const submissionTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const initialSnapshotRef = useRef<IntakeFormData | null>(null);
  const isDirtyRef = useRef(false);

  /* ───── Validation ───── */
  const validateStep1 = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof IntakeFormData, string>> = {};
    if (!form.customerName.trim()) {
      newErrors.customerName = t("intake.error_required");
    }
    if (!form.customerPhone.trim()) {
      newErrors.customerPhone = t("intake.error_required");
    }
    if (!form.model.trim()) {
      newErrors.model = t("intake.error_required");
    }
    setErrors(newErrors);
    setTouched((prev) => ({
      ...prev,
      customerName: true,
      customerPhone: true,
      model: true,
    }));
    return Object.keys(newErrors).length === 0;
  }, [form, t]);

  const validateStep2 = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof IntakeFormData, string>> = {};
    if (!form.reportedProblem.trim()) {
      newErrors.reportedProblem = t("intake.error_required");
    }
    setErrors(newErrors);
    setTouched((prev) => ({ ...prev, reportedProblem: true }));
    return Object.keys(newErrors).length === 0;
  }, [form, t]);

  /* ───── Field updates ───── */
  const update = useCallback(
    <K extends keyof IntakeFormData>(key: K, value: IntakeFormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        if (!prev[key]) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  const handleBlur = useCallback(
    (field: keyof IntakeFormData) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      if (REQUIRED_FIELDS.includes(field) && !form[field]?.toString().trim()) {
        setErrors((prev) => ({ ...prev, [field]: t("intake.error_required") }));
      }
    },
    [form, t]
  );

  /* ───── Customer handling ───── */
  const selectCustomer = useCallback(
    (customer: CustomerSearchResult) => {
      setForm((prev) => ({
        ...prev,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email ?? "",
      }));
      setErrors((prev) => {
        const {
          customerName: _,
          customerPhone: __,
          customerEmail: ___,
          ...rest
        } = prev;
        return rest;
      });
      setTouched((prev) => ({
        ...prev,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
      }));
      clearSearch();
    },
    [clearSearch]
  );

  const clearCustomer = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      customerId: "",
      customerName: "",
      customerPhone: "",
      customerEmail: "",
    }));
    clearSearch();
  }, [clearSearch]);

  /* ───── Brand/Model handling ───── */
  const selectBrand = useCallback(
    (brand: BrandSearchResult) => {
      setForm((prev) => ({
        ...prev,
        brand: brand.name,
        brandId: brand.id,
        model: "",
        modelId: "",
      }));
      clearBrandSearch();
      setModelQuery("");
    },
    [clearBrandSearch, setModelQuery]
  );

  const selectModel = useCallback(
    (model: ModelSearchResult) => {
      setForm((prev) => ({
        ...prev,
        model: model.model,
        modelId: model.id,
      }));
      setErrors((prev) => {
        if (!prev.model) {
          return prev;
        }
        const { model: _, ...rest } = prev;
        return rest;
      });
      clearModelSearch();
    },
    [clearModelSearch]
  );

  const handleBrandAdd = useCallback(async () => {
    const brand = await createBrand(brandAddQuery);
    if (brand) {
      setForm((prev) => ({
        ...prev,
        brand: brand.name,
        brandId: brand.id,
        model: "",
        modelId: "",
      }));
      clearBrandSearch();
      setModelQuery("");
    }
  }, [createBrand, brandAddQuery, clearBrandSearch, setModelQuery]);

  const handleModelAdd = useCallback(async () => {
    const model = await createModel(modelAddQuery);
    if (model) {
      setForm((prev) => ({
        ...prev,
        model: model.model,
        modelId: model.id,
      }));
      clearModelSearch();
    }
  }, [createModel, modelAddQuery, clearModelSearch]);

  const handleQuickAdd = useCallback(
    (data: CreatedCustomerData) => {
      setForm((prev) => ({
        ...prev,
        customerId: data.id,
        customerName: data.name,
        customerPhone: data.phone,
        customerEmail: data.email ?? "",
      }));
      setErrors((prev) => {
        const {
          customerName: _,
          customerPhone: __,
          customerEmail: ___,
          ...rest
        } = prev;
        return rest;
      });
      setTouched((prev) => ({
        ...prev,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
      }));
      setQuery("");
      clearSearch();
      setShowQuickAdd(false);
    },
    [clearSearch, setQuery]
  );

  /* ───── Photos ───── */
  const handlePhotoSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const remaining = MAX_PHOTOS - form.photos.length;
      const toAdd = files.slice(0, remaining);
      if (toAdd.length === 0) {
        return;
      }
      const newPreviews: PhotoPreview[] = toAdd.map((f) => ({
        file: f,
        url: URL.createObjectURL(f),
      }));
      setPhotoPreviews((prev) => [...prev, ...newPreviews]);
      setForm((prev) => ({ ...prev, photos: [...prev.photos, ...toAdd] }));
      e.target.value = "";
    },
    [form.photos.length]
  );

  const handlePhotoRemove = useCallback(
    (index: number) => {
      URL.revokeObjectURL(photoPreviews[index].url);
      setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
      setForm((prev) => ({
        ...prev,
        photos: prev.photos.filter((_, i) => i !== index),
      }));
    },
    [photoPreviews]
  );

  const { capturePhoto, isCapturing, isNative } = useNativeCamera();

  const handleNativeCapture = useCallback(
    async (source: CaptureSource) => {
      if (!isNative) {
        return;
      }
      const remaining = MAX_PHOTOS - form.photos.length;
      if (remaining <= 0) {
        return;
      }
      setPhotoError(null);
      try {
        const result = await capturePhoto(source);
        if (result) {
          setPhotoPreviews((prev) => [
            ...prev,
            { file: result.file, url: result.previewUrl },
          ]);
          setForm((prev) => ({
            ...prev,
            photos: [...prev.photos, result.file],
          }));
        }
      } catch {
        setPhotoError(t("intake.error_photo_capture"));
      }
    },
    [capturePhoto, form.photos.length, isNative, t]
  );

  /* ───── Side effects ───── */
  useEffect(() => {
    if (!open) {
      return;
    }
    const initial: IntakeFormData = {
      ...INITIAL_FORM,
      estimatedDelivery: defaultDeliveryDatetime(),
      ...prefill,
    };
    setForm(initial);
    initialSnapshotRef.current = initial;
    setTouched({});
    setErrors({});
    setPhotoPreviews([]);
    setStep(1);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Mirror the X button: a dirty form asks before discarding.
        if (isDirtyRef.current) {
          setShowCloseConfirm(true);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    overflowLockCount++;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      overflowLockCount = Math.max(0, overflowLockCount - 1);
      if (overflowLockCount === 0) {
        document.body.style.overflow = "";
      }
    };
  }, [open, onClose, prefill]);

  useEffect(
    () => () => {
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current);
      }
    },
    []
  );

  /* ───── Submit ───── */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validateStep2()) {
        return;
      }
      setIsSubmitting(true);
      try {
        await onSubmit(form);
      } catch {
        setIsSubmitting(false);
        return;
      }
      setSubmissionSuccess(true);
      setTouched({});
      setIsSubmitting(false);
      for (const p of photoPreviews) {
        URL.revokeObjectURL(p.url);
      }
      setPhotoPreviews([]);
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current);
      }
      submissionTimeoutRef.current = setTimeout(() => {
        setForm(INITIAL_FORM);
        setSubmissionSuccess(false);
        onClose();
      }, 1500);
    },
    [form, onSubmit, onClose, validateStep2, photoPreviews]
  );

  /* ───── Derived + close guards ───── */
  // Compare the whole form (incl. signature, accessories, checklist, costs)
  // against the snapshot taken when the modal opened — a partial field list
  // would let Escape/X discard real data without asking.
  const isFormDirty =
    initialSnapshotRef.current !== null &&
    (form.photos.length !== initialSnapshotRef.current.photos.length ||
      JSON.stringify({ ...form, photos: undefined }) !==
        JSON.stringify({
          ...initialSnapshotRef.current,
          photos: undefined,
        }));
  isDirtyRef.current = isFormDirty;

  const handleBackdropClick = useCallback(() => {
    if (isFormDirty) {
      return;
    }
    onClose();
  }, [isFormDirty, onClose]);

  const handleCloseClick = useCallback(() => {
    if (isFormDirty) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [isFormDirty, onClose]);

  const handleNextStep = useCallback(() => {
    if (validateStep1()) {
      setStep(2);
    }
  }, [validateStep1]);

  return {
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
    handleBackdropClick,
    handleBrandAdd,
    handleBlur,
    handleCloseClick,
    handleModelAdd,
    handleNativeCapture,
    handleNextStep,
    handlePhotoRemove,
    handlePhotoSelect,
    handleQuickAdd,
    handleSubmit,
    isCapturing,
    isCreatingBrand,
    isCreatingModel,
    isSearching,
    isSearchingBrand,
    isSearchingModel,
    isSubmitting,
    isNative,
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
    setShowCloseConfirm,
    setShowQuickAdd,
    setStep,
    showBrandAddOption,
    showCloseConfirm,
    showModelAddOption,
    showQuickAdd,
    step,
    submissionSuccess,
    t,
    touched,
    update,
  };
}
