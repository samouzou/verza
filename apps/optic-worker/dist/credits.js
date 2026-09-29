"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSUFFICIENT_OPTIC_CREDITS = void 0;
exports.opticCreditChargeDocId = opticCreditChargeDocId;
exports.saveLeadWithOpticCreditCharge = saveLeadWithOpticCreditCharge;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
exports.INSUFFICIENT_OPTIC_CREDITS = "Insufficient Optic Credits";
/**
 * Deterministic idempotency key so job retries do not double-charge.
 */
function opticCreditChargeDocId(jobId, profileUrl) {
    const hash = (0, node_crypto_1.createHash)("sha256").update(`${jobId}|${profileUrl}`).digest("hex").slice(0, 32);
    return `${jobId}_${hash}`;
}
/**
 * Saves a vault lead and applies Optic billing (included credit, enterprise overage, or top-up needed).
 */
async function saveLeadWithOpticCreditCharge(params) {
    const { db, jobId, agencyId, profileUrl, leadData, billing } = params;
    const chargeId = opticCreditChargeDocId(jobId, profileUrl);
    const chargeRef = db.collection("optic_credit_charges").doc(chargeId);
    const agencyRef = db.collection("agencies").doc(agencyId);
    const leadRef = db.collection("optic_outreach_leads").doc();
    try {
        const result = await db.runTransaction(async (tx) => {
            const existingCharge = await tx.get(chargeRef);
            if (existingCharge.exists) {
                const existingLeadId = existingCharge.data()?.leadId;
                if (typeof existingLeadId === "string" && existingLeadId) {
                    return { leadId: existingLeadId, charged: false, overage: false };
                }
            }
            const agencySnap = await tx.get(agencyRef);
            if (!agencySnap.exists) {
                throw new Error("Agency not found");
            }
            const raw = agencySnap.data()?.opticCreditsBalance;
            const balance = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
            if (balance >= 1) {
                tx.set(leadRef, leadData);
                tx.update(agencyRef, {
                    opticCreditsBalance: firestore_1.FieldValue.increment(-1),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                tx.set(chargeRef, {
                    agencyId,
                    jobId,
                    profileUrl,
                    leadId: leadRef.id,
                    billingType: "included",
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
                });
                return { leadId: leadRef.id, charged: true, overage: false };
            }
            if (billing.subscriptionActive && (billing.plan === "enterprise" || billing.plan === "flagship")) {
                tx.set(leadRef, leadData);
                tx.update(agencyRef, {
                    opticOverageLeadsThisPeriod: firestore_1.FieldValue.increment(1),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                tx.set(chargeRef, {
                    agencyId,
                    jobId,
                    profileUrl,
                    leadId: leadRef.id,
                    billingType: "overage",
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
                });
                return { leadId: leadRef.id, charged: false, overage: true };
            }
            if (billing.subscriptionActive && billing.plan === "pilot") {
                return null;
            }
            return undefined;
        });
        if (result === null) {
            return { ok: false, reason: "needs_top_up" };
        }
        if (result === undefined) {
            return { ok: false, reason: "insufficient_credits" };
        }
        return {
            ok: true,
            leadId: result.leadId,
            charged: result.charged,
            overage: result.overage,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes(exports.INSUFFICIENT_OPTIC_CREDITS)) {
            return { ok: false, reason: "insufficient_credits" };
        }
        throw e;
    }
}
