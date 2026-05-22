"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
export type OpticPlanTier = "none" | "pilot" | "enterprise";

function parseBalance(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

export function useOpticCredits(agencyId: string | null | undefined) {
  const [balance, setBalance] = useState(0);
  const [plan, setPlan] = useState<OpticPlanTier>("none");
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [allowance, setAllowance] = useState(0);
  const [overageLeads, setOverageLeads] = useState(0);
  const [topUpBlocks, setTopUpBlocks] = useState(0);
  const [billingInterval, setBillingInterval] = useState<"month" | "year" | null>(null);
  const [loading, setLoading] = useState(Boolean(agencyId));

  useEffect(() => {
    if (!agencyId) {
      setBalance(0);
      setPlan("none");
      setSubscriptionStatus(null);
      setAllowance(0);
      setOverageLeads(0);
      setTopUpBlocks(0);
      setBillingInterval(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = doc(db, "agencies", agencyId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setBalance(0);
          setPlan("none");
          setLoading(false);
          return;
        }
        const d = snap.data();
        const status = typeof d.opticSubscriptionStatus === "string" ? d.opticSubscriptionStatus : null;
        setSubscriptionStatus(status);
        setBalance(parseBalance(d.opticCreditsBalance));
        setAllowance(parseBalance(d.opticMonthlyAllowance));
        setOverageLeads(parseBalance(d.opticOverageLeadsThisPeriod));
        setTopUpBlocks(parseBalance(d.opticTopUpBlocksThisPeriod));
        const tier = d.opticPlan as OpticPlanTier | undefined;
        const active = status === "active" || status === "trialing";
        setPlan(active && tier ? tier : "none");
        setBillingInterval(
          d.opticBillingInterval === "year" || d.opticBillingInterval === "month"
            ? d.opticBillingInterval
            : null
        );
        setLoading(false);
      },
      () => {
        setBalance(0);
        setPlan("none");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [agencyId]);

  const subscriptionActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";

  return {
    balance,
    plan,
    subscriptionStatus,
    subscriptionActive,
    allowance,
    overageLeads,
    topUpBlocks,
    billingInterval,
    loading,
    hasCredits: balance > 0,
    hasActiveSubscription: subscriptionActive && plan !== "none",
  };
}
