import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {APP_URL, INFLOW_API_KEY} from "../config/params";
import type {UserProfileFirestoreData} from "../types";
import {isInflowPayoutCountry} from "./inflowCorridors";
import {inflowRequest} from "./inflowClient";

type KycStatusResponse = {
  kycReady?: boolean;
  kycStatus?: string;
  nextUrl?: string | null;
  nextSteps?: string[];
};

function splitDisplayName(name: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {firstName: "Creator", lastName: "Merchant"};
  if (parts.length === 1) return {firstName: parts[0], lastName: "Merchant"};
  return {firstName: parts[0], lastName: parts.slice(1).join(" ")};
}

async function fetchKycStatus(subMerchantId: string): Promise<KycStatusResponse> {
  return inflowRequest<KycStatusResponse>(
    `/api/connect/accounts/${encodeURIComponent(subMerchantId)}/kyc/status`
  );
}

async function applyKycToUser(
  userId: string,
  subMerchantId: string,
  status: KycStatusResponse
) {
  const updates: Partial<UserProfileFirestoreData> = {
    inflowSubMerchantId: subMerchantId,
    inflowKycStatus: status.kycStatus || "pending",
    inflowKycReady: !!status.kycReady,
    payoutMethod: "inflow",
  };
  await db.collection("users").doc(userId).update(updates);
}

/** Create (or resume) Inflow Connect sub-merchant onboarding for African creators. */
export const createInflowSubMerchant = onCall(
  {secrets: [INFLOW_API_KEY]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to connect payouts.");
    }
    const userId = request.auth.uid;
    const country =
      typeof request.data?.country === "string"
        ? request.data.country.trim().toUpperCase()
        : "";
    if (!isInflowPayoutCountry(country)) {
      throw new HttpsError(
        "invalid-argument",
        "Inflowpay payouts are not available for this country yet."
      );
    }

    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }
    const user = userSnap.data() as UserProfileFirestoreData;
    const email = user.email || request.auth.token.email;
    if (!email) {
      throw new HttpsError("failed-precondition", "Account email is required.");
    }

    const appUrl = APP_URL.value();
    const redirectUrlKyc = `${appUrl}/settings?inflow_kyc_return=true`;
    const {firstName, lastName} = splitDisplayName(user.displayName);

    if (user.inflowSubMerchantId) {
      const status = await fetchKycStatus(user.inflowSubMerchantId);
      await applyKycToUser(userId, user.inflowSubMerchantId, status);
      return {
        subMerchantId: user.inflowSubMerchantId,
        kycReady: !!status.kycReady,
        kycStatus: status.kycStatus || user.inflowKycStatus || "pending",
        nextUrl: status.nextUrl || null,
        nextSteps: status.nextSteps || [],
        country: user.inflowPayoutCountry || country,
      };
    }

    const created = await inflowRequest<{
      id: string;
      kycStatus?: string;
      nextUrl?: string | null;
      nextSteps?: string[];
    }>("/api/connect/accounts", {
      method: "POST",
      body: {
        email,
        merchantName: user.displayName || email.split("@")[0],
        customerType: "individual",
        firstName,
        lastName,
        marketplaceMetadata: {verzaUserId: userId},
        redirectUrlKyc,
      },
    });

    if (!created.id) {
      throw new HttpsError("internal", "Inflowpay did not return a sub-merchant id.");
    }

    await userRef.update({
      inflowSubMerchantId: created.id,
      inflowKycStatus: created.kycStatus || "pending",
      inflowKycReady: false,
      inflowPayoutCountry: country,
      payoutMethod: "inflow",
    });

    logger.info("[inflow] Created sub-merchant", {userId, subMerchantId: created.id, country});

    return {
      subMerchantId: created.id,
      kycReady: false,
      kycStatus: created.kycStatus || "pending",
      nextUrl: created.nextUrl || null,
      nextSteps: created.nextSteps || [],
      country,
    };
  }
);

/** Poll Inflow KYC status after the hosted verification flow. */
export const syncInflowKycStatus = onCall(
  {secrets: [INFLOW_API_KEY]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const userId = request.auth.uid;
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }
    const user = userSnap.data() as UserProfileFirestoreData;
    if (!user.inflowSubMerchantId) {
      throw new HttpsError("failed-precondition", "No Inflowpay account found.");
    }

    const status = await fetchKycStatus(user.inflowSubMerchantId);
    await applyKycToUser(userId, user.inflowSubMerchantId, status);

    return {
      kycReady: !!status.kycReady,
      kycStatus: status.kycStatus || "pending",
      nextUrl: status.nextUrl || null,
      nextSteps: status.nextSteps || [],
    };
  }
);

/** Dynamic bank / mobile-money form schema for the creator's corridor. */
export const getInflowBankForm = onCall(
  {secrets: [INFLOW_API_KEY]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const userSnap = await db.collection("users").doc(request.auth.uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }
    const user = userSnap.data() as UserProfileFirestoreData;
    if (!user.inflowSubMerchantId) {
      throw new HttpsError("failed-precondition", "Complete Inflowpay verification first.");
    }
    if (!user.inflowKycReady) {
      throw new HttpsError(
        "failed-precondition",
        "Identity verification must be approved before adding a bank account."
      );
    }

    const country = user.inflowPayoutCountry || "";
    const form = await inflowRequest<Record<string, unknown>>("/api/account/bank-form", {
      onBehalfOf: user.inflowSubMerchantId,
      query: country ? {country} : undefined,
    });

    return {form, country};
  }
);

/** Register payout destination (bank or mobile money) on the sub-merchant. */
export const registerInflowBankAccount = onCall(
  {secrets: [INFLOW_API_KEY]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const userId = request.auth.uid;
    const fields =
      request.data?.fields && typeof request.data.fields === "object"
        ? (request.data.fields as Record<string, unknown>)
        : null;
    if (!fields || !Object.keys(fields).length) {
      throw new HttpsError("invalid-argument", "Bank account fields are required.");
    }

    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }
    const user = userSnap.data() as UserProfileFirestoreData;
    if (!user.inflowSubMerchantId || !user.inflowKycReady) {
      throw new HttpsError(
        "failed-precondition",
        "Complete Inflowpay verification before adding a payout account."
      );
    }

    const country = user.inflowPayoutCountry || "";
    const registered = await inflowRequest<{id?: string; accountId?: string}>(
      "/api/account/bank",
      {
        method: "POST",
        onBehalfOf: user.inflowSubMerchantId,
        body: {
          ...fields,
          ...(country ? {country} : {}),
        },
      }
    );

    const accountId = registered.id || registered.accountId;
    if (!accountId) {
      throw new HttpsError("internal", "Inflowpay did not return an account id.");
    }

    await userRef.update({
      inflowPayoutAccountId: accountId,
      payoutMethod: "inflow",
    });

    logger.info("[inflow] Registered payout account", {userId, accountId});
    return {accountId};
  }
);
