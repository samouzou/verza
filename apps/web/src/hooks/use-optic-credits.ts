"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type OpticPlanTier = "none" | "launch" | "pilot" | "enterprise" | "flagship" | "appsumo";

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
  const [billingSource, setBillingSource] = useState<"stripe" | "appsumo" | null>(null);
  const [appsumoCodeCount, setAppsumoCodeCount] = useState(0);
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
      setBillingSource(null);
      setAppsumoCodeCount(0);
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
          setBillingSource(null);
          setAppsumoCodeCount(0);
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
        setAppsumoCodeCount(parseBalance(d.appsumoOpticCodeCount));
        const source =
          d.opticBillingSource === "appsumo" || d.opticPlan === "appsumo"
            ? "appsumo"
            : d.opticBillingSource === "stripe"
              ? "stripe"
              : null;
        setBillingSource(source);
        const tier = d.opticPlan as OpticPlanTier | undefined;
        const active =
          status === "active" || status === "trialing" || source === "appsumo";
        if (active && source === "appsumo") {
          setPlan("appsumo");
        } else {
          setPlan(active && tier ? tier : "none");
        }
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
        setBillingSource(null);
        setAppsumoCodeCount(0);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [agencyId]);

  const subscriptionActive =
    subscriptionStatus === "active" ||
    subscriptionStatus === "trialing" ||
    billingSource === "appsumo";

  return {
    balance,
    plan,
    subscriptionStatus,
    subscriptionActive,
    allowance,
    overageLeads,
    topUpBlocks,
    billingInterval,
    billingSource,
    appsumoCodeCount,
    loading,
    hasCredits: balance > 0,
    hasActiveSubscription: subscriptionActive && plan !== "none",
    isAppSumo: billingSource === "appsumo" || plan === "appsumo",
  };
}
