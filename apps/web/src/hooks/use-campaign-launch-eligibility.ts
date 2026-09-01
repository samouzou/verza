"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useOpticCredits } from "@/hooks/use-optic-credits";

const ACTIVE = new Set(["open", "in-progress"]);
const PAID_OPTIC = new Set(["launch", "pilot", "enterprise", "flagship", "appsumo"]);

export function useCampaignLaunchEligibility(agencyId: string | null | undefined) {
  const billing = useOpticCredits(agencyId);
  const [activeCount, setActiveCount] = useState(0);
  const [countLoading, setCountLoading] = useState(Boolean(agencyId));

  useEffect(() => {
    if (!agencyId) {
      setActiveCount(0);
      setCountLoading(false);
      return;
    }
    setCountLoading(true);
    const q = query(collection(db, "gigs"), where("brandId", "==", agencyId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActiveCount(
          snap.docs.filter((d) => ACTIVE.has(String(d.data().status ?? ""))).length
        );
        setCountLoading(false);
      },
      () => {
        setActiveCount(0);
        setCountLoading(false);
      }
    );
    return () => unsub();
  }, [agencyId]);

  const hasPaidOptic = billing.hasActiveSubscription && PAID_OPTIC.has(billing.plan);
  return {
    loading: countLoading || billing.loading,
    activeCount,
    hasPaidOptic,
    canLaunch: activeCount < 1 || hasPaidOptic,
    plan: billing.plan,
  };
}
