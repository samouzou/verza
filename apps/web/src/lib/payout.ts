import type { UserProfile } from "@/hooks/use-auth";

/** True when the creator can withdraw wallet earnings to their bank. */
export function isPayoutReady(
  user: Pick<
    UserProfile,
    | "payoutMethod"
    | "stripeAccountId"
    | "stripePayoutsEnabled"
    | "inflowSubMerchantId"
    | "inflowKycReady"
    | "inflowPayoutAccountId"
  > | null | undefined
): boolean {
  if (!user) return false;
  if (user.payoutMethod === "inflow") {
    return !!(
      user.inflowSubMerchantId &&
      user.inflowKycReady &&
      user.inflowPayoutAccountId
    );
  }
  return !!(user.stripeAccountId && user.stripePayoutsEnabled);
}

export function payoutProviderLabel(user: UserProfile | null | undefined): string {
  if (user?.payoutMethod === "inflow") return "Inflowpay";
  return "Stripe";
}
