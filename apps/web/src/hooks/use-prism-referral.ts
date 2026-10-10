"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";

export type PrismReferral =
  | { eligible: false; friendPercentOff: number }
  | {
      eligible: true;
      url: string;
      reward: "credit" | "video";
      monthCents: number | null;
      friendPercentOff: number;
      capPerYear: number;
      videoSeconds: number;
      joined: number;
      rewarded: number;
      rewardsThisYear: number;
    };

/** One request per brand per page load, shared by the sidebar and the pricing page. */
const cache = new Map<string, Promise<PrismReferral | null>>();

export function usePrismReferral(agencyId: string | null | undefined, tierKey?: string) {
  const [referral, setReferral] = useState<PrismReferral | null>(null);
  const [loading, setLoading] = useState(!!agencyId);

  useEffect(() => {
    if (!agencyId) {
      setReferral(null);
      setLoading(false);
      return;
    }
    const key = `${agencyId}:${tierKey ?? ""}`;
    let request = cache.get(key);
    if (!request) {
      request = httpsCallable(functions, "getPrismReferral")({})
        .then((res) => res.data as PrismReferral)
        .catch(() => null);
      cache.set(key, request);
    }
    let live = true;
    setLoading(true);
    void request.then((r) => {
      if (!live) return;
      setReferral(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [agencyId, tierKey]);

  return { referral, loading };
}
