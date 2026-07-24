import {createHash} from "node:crypto";
import {FieldValue} from "firebase-admin/firestore";
import type {Firestore} from "firebase-admin/firestore";
import type {AgencyOpticBilling} from "./billing";

export type SaveLeadWithCreditParams = {
  db: Firestore;
  jobId: string;
  agencyId: string;
  profileUrl: string;
  leadData: Record<string, unknown>;
  billing: AgencyOpticBilling;
};

export type SaveLeadWithCreditResult =
  | {ok: true; leadId: string; charged: boolean; overage?: boolean}
  | {ok: false; reason: "insufficient_credits" | "needs_top_up"};

export function opticCreditChargeDocId(jobId: string, profileUrl: string): string {
  const hash = createHash("sha256").update(`${jobId}|${profileUrl}`).digest("hex").slice(0, 32);
  return `${jobId}_${hash}`;
}

/** Saves a vault lead and applies Optic billing (included credit, enterprise overage, or top-up needed). */
export async function saveLeadWithOpticCreditCharge(
  params: SaveLeadWithCreditParams
): Promise<SaveLeadWithCreditResult> {
  const {db, jobId, agencyId, profileUrl, leadData, billing} = params;
  const chargeId = opticCreditChargeDocId(jobId, profileUrl);
  const chargeRef = db.collection("optic_credit_charges").doc(chargeId);
  const agencyRef = db.collection("agencies").doc(agencyId);
  const leadRef = db.collection("optic_outreach_leads").doc();

  const result = await db.runTransaction(async (tx) => {
    const existingCharge = await tx.get(chargeRef);
    if (existingCharge.exists) {
      const existingLeadId = existingCharge.data()?.leadId;
      if (typeof existingLeadId === "string" && existingLeadId) {
        return {leadId: existingLeadId, charged: false as const, overage: false as const};
      }
    }

    const agencySnap = await tx.get(agencyRef);
    if (!agencySnap.exists) {
      throw new Error("Agency not found");
    }
    const raw = agencySnap.data()?.opticCreditsBalance;
    const balance =
      typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

    if (balance >= 1) {
      tx.set(leadRef, leadData);
      tx.update(agencyRef, {
        opticCreditsBalance: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(chargeRef, {
        agencyId,
        jobId,
        profileUrl,
        leadId: leadRef.id,
        billingType: "included",
        createdAt: FieldValue.serverTimestamp(),
      });
      return {leadId: leadRef.id, charged: true as const, overage: false as const};
    }

    if (billing.subscriptionActive && billing.plan === "enterprise") {
      tx.set(leadRef, leadData);
      tx.update(agencyRef, {
        opticOverageLeadsThisPeriod: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(chargeRef, {
        agencyId,
        jobId,
        profileUrl,
        leadId: leadRef.id,
        billingType: "overage",
        createdAt: FieldValue.serverTimestamp(),
      });
      return {leadId: leadRef.id, charged: false as const, overage: true as const};
    }

    if (billing.subscriptionActive && billing.plan === "pilot") {
      return null;
    }

    return undefined;
  });

  if (result === null) {
    return {ok: false, reason: "needs_top_up"};
  }
  if (result === undefined) {
    return {ok: false, reason: "insufficient_credits"};
  }
  return {
    ok: true,
    leadId: result.leadId,
    charged: result.charged,
    overage: result.overage,
  };
}
