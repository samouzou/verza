"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { OpticLeadRow } from "@/lib/optic/types";

export function useOpticLeads(agencyId: string | null | undefined) {
  const [leads, setLeads] = useState<OpticLeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agencyId) {
      setLeads([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "optic_outreach_leads"),
      where("agencyId", "==", agencyId),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLeads(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<OpticLeadRow, "id">),
          }))
        );
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [agencyId]);

  return { leads, error, loading };
}
