import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import api from "@/lib/api";
import {
  BusinessHistory,
  SupplierCustomerLink,
} from "@/pages/business/history";

interface SupplierPart {
  category: string;
  defaultPrice: string;
  id: string;
  name: string;
  stockQuantity: number;
}

interface SupplierRma {
  createdAt: string;
  description: string;
  id: string;
  part: { id: string; name: string } | null;
  quantity: number;
  status: string;
}

interface SupplierDetail {
  address: string | null;
  email: string | null;
  id: string;
  isActive: boolean;
  name: string;
  notes: string | null;
  parts: SupplierPart[];
  phone: string | null;
  rmas: SupplierRma[];
  taxId: string | null;
}

export default function SupplierDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/suppliers/${id}`);
      setSupplier(res.data?.data ?? null);
    } catch {
      toast.error(t("suppliers.load_failed"));
      setSupplier(null);
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            className="h-24 animate-pulse rounded-2xl bg-surface-container-low"
            key={i}
          />
        ))}
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="font-bold font-headline text-lg text-on-surface">
          {t("suppliers.not_found")}
        </p>
        <Link
          className="mt-3 font-medium text-primary text-sm hover:underline"
          to="/suppliers"
        >
          {t("suppliers.back")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <SupplierCustomerLink supplierId={supplier.id} />
      <BusinessHistory entityId={supplier.id} entityType="SUPPLIER" />
      <div className="mb-6">
        <Link
          className="font-medium text-on-surface-variant text-sm hover:text-primary"
          to="/suppliers"
        >
          ← {t("suppliers.back")}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {supplier.name}
          </h2>
          {!supplier.isActive && (
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant text-xs">
              {t("suppliers.inactive")}
            </span>
          )}
        </div>
        <p className="mt-1 font-medium text-on-surface-variant text-sm">
          {[supplier.phone, supplier.email, supplier.taxId, supplier.address]
            .filter(Boolean)
            .join(" · ") || t("suppliers.no_contact")}
        </p>
      </div>

      {supplier.notes && (
        <div className="mb-6 rounded-xl bg-surface-container-lowest p-4 text-on-surface-variant text-sm">
          {supplier.notes}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 font-bold font-headline text-base text-on-surface">
            {t("suppliers.parts_section")}
          </h3>
          <div className="overflow-hidden rounded-2xl bg-surface-container-low">
            {supplier.parts.length === 0 ? (
              <p className="p-5 text-on-surface-variant text-sm">
                {t("suppliers.no_parts")}
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/30">
                {supplier.parts.map((p) => (
                  <li
                    className="flex items-center justify-between gap-3 px-5 py-3"
                    key={p.id}
                  >
                    <p className="truncate font-medium text-on-surface text-sm">
                      {p.name}
                    </p>
                    <span className="text-on-surface-variant text-xs">
                      {t("suppliers.part_stock", { count: p.stockQuantity })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-bold font-headline text-base text-on-surface">
            {t("suppliers.rmas_section")}
          </h3>
          <div className="overflow-hidden rounded-2xl bg-surface-container-low">
            {supplier.rmas.length === 0 ? (
              <p className="p-5 text-on-surface-variant text-sm">
                {t("suppliers.no_rmas")}
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/30">
                {supplier.rmas.map((r) => (
                  <li className="px-5 py-3" key={r.id}>
                    <p className="truncate font-medium text-on-surface text-sm">
                      {r.description}
                      <span className="ml-2 font-normal text-on-surface-variant">
                        ×{r.quantity}
                      </span>
                    </p>
                    <p className="text-on-surface-variant text-xs">
                      {[
                        r.part?.name,
                        t(`rmas.status_${r.status.toLowerCase()}`),
                        new Date(r.createdAt).toLocaleDateString(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
