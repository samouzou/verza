import type {Firestore} from "firebase-admin/firestore";

export type OpticPlanTier = "none" | "launch" | "pilot" | "enterprise" | "flagship" | "appsumo";

export type AgencyOpticBilling = {
  plan: OpticPlanTier;
  subscriptionActive: boolean;
  balance: number;
};

function parseBalance(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

export async function loadAgencyOpticBilling(
  db: Firestore,
  agencyId: string
): Promise<AgencyOpticBilling> {
  const snap = await db.collection("agencies").doc(agencyId).get();
  if (!snap.exists) {
    return {plan: "none", subscriptionActive: false, balance: 0};
  }
  const d = snap.data()!;
  const status = String(d.opticSubscriptionStatus ?? "");
  const plan = (d.opticPlan as OpticPlanTier) || "none";
  const isAppSumo = d.opticBillingSource === "appsumo" || plan === "appsumo";
  const subscriptionActive =
    status === "active" || status === "trialing" || isAppSumo;
  return {
    plan: subscriptionActive ? (isAppSumo ? "appsumo" : plan) : "none",
    subscriptionActive,
    balance: parseBalance(d.opticCreditsBalance),
  };
}

export async function requestLowCreditCheck(agencyId: string): Promise<void> {
  const url = process.env.OPTIC_LOW_CREDIT_CHECK_URL?.trim();
  const secret = process.env.OPTIC_WORKER_SHARED_SECRET?.trim();
  if (!url || !secret) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-verza-optic-secret": secret,
      },
      body: JSON.stringify({agencyId}),
    });
  } catch {
    // Non-blocking: mission should not fail on email check.
  }
}

export async function requestPilotTopUp(
  agencyId: string
): Promise<{ok: boolean; creditsAdded?: number; reason?: string}> {
  const url = process.env.OPTIC_TOP_UP_URL?.trim();
  const secret = process.env.OPTIC_WORKER_SHARED_SECRET?.trim();
  if (!url || !secret) {
    return {ok: false, reason: "top_up_not_configured"};
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-verza-optic-secret": secret,
      },
      body: JSON.stringify({agencyId}),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      creditsAdded?: number;
      reason?: string;
    };
    if (!res.ok) {
      return {ok: false, reason: body.reason ?? `http_${res.status}`};
    }
    return {ok: true, creditsAdded: body.creditsAdded};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {ok: false, reason: msg};
  }
}
