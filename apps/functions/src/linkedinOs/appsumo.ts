import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {prismBillingAdmin} from "./billing";

export const APPSUMO_PRISM_CODES_COLLECTION = "appsumo_prism_codes";

/**
 * Normalizes an AppSumo Prism code for lookup.
 * @param {unknown} raw Raw code from the client.
 * @return {string} Uppercase code without spaces.
 */
export function normalizeAppSumoPrismCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";
}

/**
 * Redeems one AppSumo code onto the caller's brand: Prism Lifetime, one code per brand.
 * @return {!Promise<{tier: string}>} Result.
 */
export const redeemAppSumoPrismCode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to redeem your AppSumo code.");
  const uid = request.auth.uid;
  const code = normalizeAppSumoPrismCode(request.data?.code);
  if (code.length < 6 || code.length > 64) throw new HttpsError("invalid-argument", "Enter a valid AppSumo code.");
  const {agencyId} = await prismBillingAdmin(uid);

  const codeRef = db.collection(APPSUMO_PRISM_CODES_COLLECTION).doc(code);
  const agencyRef = db.collection("agencies").doc(agencyId);
  await db.runTransaction(async (tx) => {
    const [codeSnap, agencySnap] = await Promise.all([tx.get(codeRef), tx.get(agencyRef)]);
    if (!codeSnap.exists) throw new HttpsError("not-found", "That code wasn't found. Check it and try again.");
    const c = codeSnap.data() ?? {};
    if (c.status !== "unused") {
      if (c.agencyId === agencyId && c.status === "redeemed") {
        throw new HttpsError("already-exists", "This code is already redeemed on your brand.");
      }
      throw new HttpsError("failed-precondition", "This code has already been used.");
    }
    if (!agencySnap.exists) throw new HttpsError("failed-precondition", "Brand workspace not found.");
    if (agencySnap.data()?.prismLifetime === true) {
      throw new HttpsError("already-exists", "This brand already has Prism Lifetime. Use the code on another brand.");
    }
    tx.update(codeRef, {
      status: "redeemed",
      agencyId,
      redeemedBy: uid,
      redeemedAt: FieldValue.serverTimestamp(),
    });
    tx.update(agencyRef, {
      prismLifetime: true,
      prismLifetimeSource: "appsumo",
      prismLifetimeCode: code,
      prismLifetimeSince: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("[AppSumo Prism] Code redeemed", {agencyId, uid});
  return {tier: "lifetime"};
});
