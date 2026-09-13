"use client";

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { OpticLeadRow } from "@/lib/optic/types";

/** Page size for the vault list (realtime window per page). */
export const OPTIC_VAULT_PAGE_SIZE = 50;

export type OpticLeadsPagination = {
  pageIndex: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  goNextPage: () => void;
  goPrevPage: () => void;
};

export type OpticLeadsCampaignScope =
  | "__all__"
  | "__pooled__"
  | (string & {});

/**
 * Vault leads for a brand. When `campaignScope` is a campaign id (or pooled),
 * we query that scope in Firestore — not a client filter on the latest 50
 * agency-wide leads (which hid older campaign creators).
 */
export function useOpticLeads(
  agencyId: string | null | undefined,
  campaignScope: OpticLeadsCampaignScope = "__all__"
) {
  const [leads, setLeads] = useState<OpticLeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  /** Cursor used as startAfter for each page; page 0 is always null. */
  const [pageStartCursors, setPageStartCursors] = useState<
    Array<QueryDocumentSnapshot<DocumentData> | null>
  >([null]);
  const [pageEndCursor, setPageEndCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);

  // Reset paging when brand or campaign scope changes.
  useEffect(() => {
    setPageIndex(0);
    setPageStartCursors([null]);
    setPageEndCursor(null);
    setHasNextPage(false);
    setLeads([]);
  }, [agencyId, campaignScope]);

  const startCursor = pageStartCursors[pageIndex] ?? null;

  useEffect(() => {
    if (!agencyId) {
      setLeads([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const constraints: QueryConstraint[] = [
      where("agencyId", "==", agencyId),
    ];

    if (campaignScope === "__pooled__") {
      constraints.push(where("campaignId", "==", null));
    } else if (campaignScope !== "__all__") {
      constraints.push(where("campaignId", "==", campaignScope));
    }

    constraints.push(orderBy("createdAt", "desc"));

    const q = startCursor
      ? query(
          collection(db, "optic_outreach_leads"),
          ...constraints,
          startAfter(startCursor),
          limit(OPTIC_VAULT_PAGE_SIZE)
        )
      : query(
          collection(db, "optic_outreach_leads"),
          ...constraints,
          limit(OPTIC_VAULT_PAGE_SIZE)
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
        const last = snap.docs[snap.docs.length - 1] ?? null;
        setPageEndCursor(last);
        setHasNextPage(snap.docs.length === OPTIC_VAULT_PAGE_SIZE);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [agencyId, campaignScope, startCursor]);

  const goNextPage = useCallback(() => {
    if (!hasNextPage || !pageEndCursor) return;
    setPageStartCursors((prev) => {
      const next = [...prev];
      next[pageIndex + 1] = pageEndCursor;
      return next;
    });
    setPageIndex((i) => i + 1);
  }, [hasNextPage, pageEndCursor, pageIndex]);

  const goPrevPage = useCallback(() => {
    if (pageIndex <= 0) return;
    setPageIndex((i) => i - 1);
  }, [pageIndex]);

  return {
    leads,
    error,
    loading,
    pagination: {
      pageIndex,
      pageSize: OPTIC_VAULT_PAGE_SIZE,
      hasNextPage,
      hasPrevPage: pageIndex > 0,
      goNextPage,
      goPrevPage,
    } satisfies OpticLeadsPagination,
  };
}
