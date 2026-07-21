import {HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {INFLOW_API_KEY, INFLOW_MARKETPLACE_USER_ID} from "../config/params";

const INFLOW_API_BASE = "https://api.inflowpay.xyz";

type InflowRequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: Record<string, unknown>;
  onBehalfOf?: string;
  query?: Record<string, string>;
};

export async function inflowRequest<T = Record<string, unknown>>(
  path: string,
  options: InflowRequestOptions = {}
): Promise<T> {
  let apiKey: string;
  try {
    apiKey = INFLOW_API_KEY.value();
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "Inflowpay is not configured on this platform."
    );
  }
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Inflowpay is not configured on this platform."
    );
  }

  const url = new URL(`${INFLOW_API_BASE}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    "X-Inflow-Api-Key": apiKey,
    "Content-Type": "application/json",
  };
  if (options.onBehalfOf) {
    headers["X-On-Behalf-Of"] = options.onBehalfOf;
  }

  const res = await fetch(url.toString(), {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: T & {message?: string; error?: string; errorCode?: string};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    logger.error("[inflow] Non-JSON response", {path, status: res.status, text: text.slice(0, 500)});
    throw new HttpsError("internal", "Unexpected response from Inflowpay.");
  }

  if (!res.ok) {
    const msg =
      data.message ||
      data.error ||
      data.errorCode ||
      `Inflowpay request failed (${res.status})`;
    logger.error("[inflow] API error", {path, status: res.status, data});
    throw new HttpsError("failed-precondition", String(msg));
  }

  return data as T;
}

export function getMarketplaceUserId(): string {
  const id = INFLOW_MARKETPLACE_USER_ID.value();
  if (!id) {
    throw new HttpsError(
      "failed-precondition",
      "Inflow marketplace account is not configured."
    );
  }
  return id;
}

/** Move USDC from Verza marketplace balance to a sub-merchant, then pay out to their bank. */
export async function inflowWalletWithdrawal(params: {
  subMerchantId: string;
  payoutAccountId: string;
  amountInCents: number;
  idempotencyKey: string;
  description?: string;
}): Promise<void> {
  const marketplaceId = getMarketplaceUserId();

  await inflowRequest("/api/connect/transfers", {
    method: "POST",
    body: {
      originId: marketplaceId,
      destinationId: params.subMerchantId,
      amountInCents: params.amountInCents,
      currency: "USDC",
      idempotencyKey: `${params.idempotencyKey}-transfer`,
      description: params.description || "Verza wallet withdrawal",
    },
  });

  await inflowRequest("/api/payout", {
    method: "POST",
    onBehalfOf: params.subMerchantId,
    body: {
      accountId: params.payoutAccountId,
      amountInCents: params.amountInCents,
      currency: "USDC",
    },
  });
}
