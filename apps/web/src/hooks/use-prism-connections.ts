"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PrismConnections } from "@/lib/prism/types";

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
