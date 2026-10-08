"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PrismConnections, PrismUsageMonth } from "@/lib/prism/types";

/** Live connected social accounts for a brand. */
export function usePrismConnections(agencyId: string | null | undefined) {
  const [connections, setConnections] = useState<PrismConnections | null>(null);
  const [loading, setLoading] = useState(Boolean(agencyId));

  useEffect(() => {
    if (!agencyId) {
      setConnections(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, "prism_connections", agencyId),
      (snap) => {
        setConnections(snap.exists() ? (snap.data() as PrismConnections) : null);
        setLoading(false);
      },
      () => {
        setConnections(null);
        setLoading(false);
      }
    );
  }, [agencyId]);

  return { connections, accounts: connections?.accounts ?? {}, loading };
}

/** This month's third-party API usage for a brand (UTC month, like Prism's plan limits). */
export function usePrismUsageMonth(agencyId: string | null | undefined) {
  const [usage, setUsage] = useState<PrismUsageMonth | null>(null);

  useEffect(() => {
    if (!agencyId) {
      setUsage(null);
      return;
    }
    const periodKey = new Date().toISOString().slice(0, 7);
    return onSnapshot(
      doc(db, "prism_usage", agencyId, "months", periodKey),
      (snap) => setUsage(snap.exists() ? (snap.data() as PrismUsageMonth) : null),
      () => setUsage(null)
    );
  }, [agencyId]);

  return usage;
}
