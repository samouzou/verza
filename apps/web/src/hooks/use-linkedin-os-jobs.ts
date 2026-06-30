"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { LinkedInOsJobRow } from "@/lib/linkedin-os/types";

export function useLinkedInOsJobs(agencyId: string | null | undefined) {
  const [jobs, setJobs] = useState<LinkedInOsJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agencyId) {
      setJobs([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "linkedin_os_jobs"),
      where("agencyId", "==", agencyId),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setJobs(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<LinkedInOsJobRow, "id">),
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

  return { jobs, error, loading };
}
