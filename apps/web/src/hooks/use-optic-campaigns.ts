"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  OPTIC_CAMPAIGN_STORAGE_KEY,
  type OpticBrandStrip,
  type OpticCampaignOption,
} from "@/lib/optic/types";

function numOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function useOpticCampaigns(agencyId: string | null | undefined, userDisplayName: string | null) {
  const [campaigns, setCampaigns] = useState<OpticCampaignOption[]>([]);
  const [campaignId, setCampaignIdState] = useState("");
  const [brandStrip, setBrandStrip] = useState<OpticBrandStrip | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URLSearchParams(window.location.search).get("campaignId");
    if (fromUrl?.trim()) {
      setCampaignIdState(fromUrl.trim());
      sessionStorage.setItem(OPTIC_CAMPAIGN_STORAGE_KEY, fromUrl.trim());
      return;
    }
    const stored = sessionStorage.getItem(OPTIC_CAMPAIGN_STORAGE_KEY);
    if (stored) setCampaignIdState(stored);
  }, []);

  const setCampaignId = useCallback((id: string) => {
    setCampaignIdState(id);
    if (typeof window !== "undefined") {
      if (id) sessionStorage.setItem(OPTIC_CAMPAIGN_STORAGE_KEY, id);
      else sessionStorage.removeItem(OPTIC_CAMPAIGN_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!agencyId) {
      setCampaigns([]);
      setBrandStrip(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const agSnap = await getDoc(doc(db, "agencies", agencyId));
        const ag = agSnap.exists() ? agSnap.data() : null;
        const brandName =
          typeof ag?.name === "string" && ag.name.trim() ? ag.name.trim() : "Your brand";
        const brandGuide = ag?.brandGuide as { missionStatement?: string } | undefined;
        const mission =
          typeof brandGuide?.missionStatement === "string"
            ? brandGuide.missionStatement.trim()
            : "";
        const brandSummary = mission ? mission.slice(0, 220) : null;

        const gigQ = query(
          collection(db, "gigs"),
          where("brandId", "==", agencyId),
          orderBy("createdAt", "desc"),
          limit(40)
        );
        const gigSnap = await getDocs(gigQ);
        if (cancelled) return;

        const openish: OpticCampaignOption[] = [];
        for (const d of gigSnap.docs) {
          const g = d.data();
          const status = String(g.status ?? "");
          if (status !== "open" && status !== "in-progress") continue;
          openish.push({
            id: d.id,
            title: typeof g.title === "string" ? g.title : "Campaign",
            status,
            ratePerCreator: numOrZero(g.ratePerCreator),
            campaignType: typeof g.campaignType === "string" ? g.campaignType : "",
            platforms: Array.isArray(g.platforms) ? (g.platforms as string[]) : [],
            description: typeof g.description === "string" ? g.description : "",
          });
        }

        setCampaigns(openish);

        const selected = openish.find((c) => c.id === campaignId);
        setBrandStrip({
          brandName,
          brandSummary,
          userDisplayName,
          activeCampaignCount: openish.length,
          paySourceCampaignTitle: selected?.title ?? null,
        });
      } catch {
        if (!cancelled) {
          setCampaigns([]);
          setBrandStrip(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agencyId, campaignId, userDisplayName]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === campaignId) ?? null,
    [campaigns, campaignId]
  );

  const payScopeHint = useMemo(() => {
    if (!selectedCampaign) {
      if (campaigns.length > 0) {
        return `Pooled pay from ${campaigns.length} active campaign(s) will inform drafts. Pick one campaign to lock scope.`;
      }
      return "No open campaigns — drafts will use your brand context only.";
    }
    const rate =
      selectedCampaign.ratePerCreator > 0
        ? `$${selectedCampaign.ratePerCreator.toLocaleString("en-US")} USD per creator`
        : "Pay set in campaign on Verza";
    const plat = selectedCampaign.platforms.slice(0, 3).join(", ");
    return `Locked to "${selectedCampaign.title}" · ${rate}${plat ? ` · ${plat}` : ""}`;
  }, [selectedCampaign, campaigns.length]);

  return {
    campaigns,
    campaignId,
    setCampaignId,
    selectedCampaign,
    brandStrip,
    payScopeHint,
    loading,
  };
}
