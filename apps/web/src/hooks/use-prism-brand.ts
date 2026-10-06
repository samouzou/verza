"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { normalizePrismStrategy, type PrismBrandStrategy } from "@/lib/prism/types";

/**
 * Live subscription to the agency's Prism brand setup (prism_brands/{agencyId}).
 * `strategy` is null until the brand has saved a setup.
 */
export function usePrismBrand(agencyId: string | null) {
  const [strategy, setStrategy] = useState<PrismBrandStrategy | null>(null);
  const [loading, setLoading] = useState(!!agencyId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId) {
      setStrategy(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, "prism_brands", agencyId),
      (snap) => {
        setStrategy(snap.exists() ? normalizePrismStrategy(snap.data() as Partial<PrismBrandStrategy>) : null);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
  }, [agencyId]);

  return { strategy, loading, error };
}
