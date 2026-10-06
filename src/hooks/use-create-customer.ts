import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import api, { type ApiError } from "@/lib/api";

interface CreatedCustomer {
  email: string | null;
  id: string;
  name: string;
  phone: string;
}

interface CreateCustomerInput {
  email?: string;
  name: string;
  phone: string;
  taxId?: string;
  useExisting?: boolean;
  whatsappConsent?: boolean;
}

/** A customer with the same (normalized) phone already exists. */
export interface DuplicateCustomer {
  id: string;
  name: string;
}

function asApiError(err: unknown): ApiError | null {
  if (err && typeof err === "object" && "code" in err) {
    return err as ApiError;
  }
  return null;
}

function duplicateFrom(err: ApiError | null): DuplicateCustomer | null {
  if (err?.code !== "DUPLICATE_CUSTOMER_PHONE") {
    return null;
  }
  const details = (err.details ?? {}) as {
    existingCustomerId?: unknown;
    existingCustomerName?: unknown;
  };
  if (typeof details.existingCustomerId !== "string") {
    return null;
  }
  return {
    id: details.existingCustomerId,
    name:
      typeof details.existingCustomerName === "string"
        ? details.existingCustomerName
        : "",
  };
}

export function useCreateCustomer() {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateCustomer | null>(null);
  const lastInput = useRef<CreateCustomerInput | null>(null);

  const create = useCallback(
    async (input: CreateCustomerInput): Promise<CreatedCustomer> => {
      setIsCreating(true);
      setError(null);
      setDuplicate(null);
      lastInput.current = input;
      try {
        const res = await api.post("/customers", input);
        return res.data as CreatedCustomer;
      } catch (err: unknown) {
        const apiErr = asApiError(err);
        const dup = duplicateFrom(apiErr);
        let message = t("intake.error_create_customer");
        if (dup) {
          setDuplicate(dup);
          message = t("add_customer_modal.duplicate_phone", { name: dup.name });
        } else if (apiErr?.message) {
          message = apiErr.message;
        }
        setError(message);
        throw new Error(message);
      } finally {
        setIsCreating(false);
      }
    },
    [t]
  );

  /** Retry the last submission, reusing the existing customer it clashed with. */
  const reuseExisting = useCallback(async (): Promise<CreatedCustomer> => {
    if (!lastInput.current) {
      throw new Error(t("intake.error_create_customer"));
    }
    return await create({ ...lastInput.current, useExisting: true });
  }, [create, t]);

  const clearError = useCallback(() => {
    setError(null);
    setDuplicate(null);
  }, []);

  return {
    clearError,
    create,
    duplicate,
    error,
    isCreating,
    reuseExisting,
  };
}
