"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { PrismPost } from "@/lib/prism/types";

/**
 * Live Prism posts for an agency: those scheduled within [fromIso, toIso], plus every unscheduled idea.
 */
export function usePrismPosts(agencyId: string | null, fromIso: string, toIso: string) {
  const [scheduled, setScheduled] = useState<PrismPost[]>([]);
  const [unscheduled, setUnscheduled] = useState<PrismPost[]>([]);
  const [loading, setLoading] = useState(!!agencyId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId) {
      setScheduled([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "prism_posts"),
      where("agencyId", "==", agencyId),
      where("scheduledAt", ">=", fromIso),
      where("scheduledAt", "<=", toIso)
    );
    return onSnapshot(
      q,
      (snap) => {
        setScheduled(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PrismPost, "id">) })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
  }, [agencyId, fromIso, toIso]);

  useEffect(() => {
    if (!agencyId) {
      setUnscheduled([]);
      return;
    }
    const q = query(
      collection(db, "prism_posts"),
      where("agencyId", "==", agencyId),
      where("scheduledAt", "==", null)
    );
    return onSnapshot(
      q,
      (snap) => setUnscheduled(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PrismPost, "id">) }))),
      (err) => setError(err.message)
    );
  }, [agencyId]);

  return { scheduled, unscheduled, loading, error };
}

/** Live calendar posts written by one Studio job, keyed by post id. */
export function useStudioJobPosts(agencyId: string | null, jobId: string | null) {
  const [posts, setPosts] = useState<Map<string, PrismPost>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPosts(new Map());
    setLoaded(false);
    if (!agencyId || !jobId) return;
    const q = query(
      collection(db, "prism_posts"),
      where("agencyId", "==", agencyId),
      where("studio.jobId", "==", jobId)
    );
    return onSnapshot(
      q,
      (snap) => {
        setPosts(new Map(snap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<PrismPost, "id">) }])));
        setLoaded(true);
      },
      () => setLoaded(true)
    );
  }, [agencyId, jobId]);

  return { posts, loaded };
}
