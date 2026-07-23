import * as logger from "firebase-functions/logger";
import Stripe from "stripe";

/** Verza's Stripe Connect platform country. */
export const PLATFORM_COUNTRY = "US";

/**
 * Cross-border connected accounts (non-US) need the recipient service agreement
 * so the US platform can transfer wallet payouts to them.
 * US domestic accounts use the default full agreement with card_payments + transfers.
 */
export function needsRecipientServiceAgreement(country: string): boolean {
  return country.toUpperCase() !== PLATFORM_COUNTRY;
}

export function buildExpressAccountParams(options: {
  email: string;
  country: string;
  defaultCurrency: string;
}): Stripe.AccountCreateParams {
  const country = options.country.toUpperCase();
  const base: Stripe.AccountCreateParams = {
    type: "express",
    email: options.email,
    country,
    default_currency: options.defaultCurrency,
  };

  if (needsRecipientServiceAgreement(country)) {
    return {
      ...base,
      capabilities: {
        transfers: {requested: true},
      },
      tos_acceptance: {
        service_agreement: "recipient",
      },
    };
  }

  return {
    ...base,
    capabilities: {
      card_payments: {requested: true},
      transfers: {requested: true},
    },
  };
}

export function connectTransferMetadata(
  destinationAccountId: string,
  transferAmountCents: number
): Record<string, string> {
  return {
    connectTransferDestination: destinationAccountId,
    connectTransferAmount: String(transferAmountCents),
  };
}

/**
 * Recipient Connect accounts cannot use destination charges; transfer after platform charge.
 * US full-agreement accounts also work with this path.
 */
export async function transferToConnectAccountIfNeeded(
  stripe: Stripe,
  metadata: Stripe.Metadata | Record<string, string>,
  latestChargeId: string | undefined
): Promise<void> {
  const destination = metadata.connectTransferDestination;
  const amountStr = metadata.connectTransferAmount;
  if (!destination || !amountStr) return;

  const amount = parseInt(amountStr, 10);
  if (!Number.isFinite(amount) || amount <= 0) return;

  if (!latestChargeId) {
    logger.error(
      "Connect transfer skipped: missing latest_charge on payment",
      {destination, amount}
    );
    return;
  }

  await stripe.transfers.create({
    amount,
    currency: "usd",
    destination,
    source_transaction: latestChargeId,
  });
  logger.info(`Transferred ${amount} cents to Connect account ${destination}`);
}

/** Resolve Stripe charge id for post-checkout Connect transfers. */
export async function resolveLatestChargeId(
  stripe: Stripe,
  paymentIntentId: string,
  latestChargeId?: string
): Promise<string | undefined> {
  if (latestChargeId) return latestChargeId;
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const charge = paymentIntent.latest_charge;
    if (!charge) return undefined;
    return typeof charge === "string" ? charge : charge.id;
  } catch (error) {
    logger.error("Failed to resolve latest_charge for payment intent", {
      paymentIntentId,
      error,
    });
    return undefined;
  }
}
