import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import ClaimHeader from "@/components/modules/returns/claim-header";
import ClaimPhotosSection from "@/components/modules/returns/claim-photos-section";
import ResolutionSection from "@/components/modules/returns/resolution-section";
import TriageSection from "@/components/modules/returns/triage-section";
import { fetchReturnClaim } from "@/lib/api-return-claims";
import type { ReturnClaimDetail } from "@/types/return-claim";

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [claim, setClaim] = useState<ReturnClaimDetail | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchReturnClaim(id)
      .then((data) => {
        if (!cancelled) {
          setClaim(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClaim(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const refreshClaim = () => {
    if (id) {
      fetchReturnClaim(id)
        .then(setClaim)
        .catch(() => {
          /* keep showing the stale snapshot */
        });
    }
  };

  if (isLoading || !claim) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const claimedLine =
    claim.claimedJobRepair?.repairName ??
    claim.claimedJobPart?.partName ??
    t("returns_detail_no_line");

  const getClaimedLineLabel = () => {
    if (claim.claimedJobRepair) {
      return t("returns_detail_claimed_repair");
    }
    if (claim.claimedJobPart) {
      return t("returns_detail_claimed_part");
    }
    return t("returns_detail_no_line");
  };

  return (
    <>
      <ClaimHeader claim={claim} />

      <section className="rounded-2xl bg-surface-container-low p-5">
        <h2 className="font-bold text-on-surface">{getClaimedLineLabel()}</h2>
        <p className="mt-1 text-on-surface">{claimedLine}</p>
        <h3 className="mt-3 font-medium text-on-surface-variant text-sm">
          {t("returns_detail_customer_complaint")}
        </h3>
        <p className="mt-1 whitespace-pre-wrap text-on-surface">
          {claim.returnReason}
        </p>
      </section>

      <TriageSection claim={claim} />
      <ResolutionSection claim={claim} />
      <ClaimPhotosSection claim={claim} onChanged={refreshClaim} />
    </>
  );
}
