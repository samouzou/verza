
/**
 * Verza Contract Management Firebase Functions
 *
 * This file exports all the functions used in the Verza application:
 * - Payment processing functions
 * - Email notification functions
 * - Scheduled tasks
 * - Contract Sharing functions
 * - E-Signature functions
 * - Social Media integration functions
 */

// Import and export v2 functions using ES module syntax
import {
  createStripeConnectedAccount,
  createStripeAccountLink,
  createPaymentIntent,
  handlePaymentSuccess,
  handleStripeAccountWebhook,
  getStripeAccountBalance,
  createCreditCheckoutSession,
  stripeCreditWebhookHandler,
  createGigFundingCheckoutSession,
  createAgencyTopUpSession,
} from "./payments";

import {
  sendContractNotification,
  handleSendGridEmailWebhook,
} from "./notifications";

import {
  sendOverdueInvoiceReminders,
  sendUpcomingPaymentReminders,
  processRecurringContracts,
  sendDripCampaignEmails,
} from "./scheduler";

import {
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
} from "./subscriptions";

import {
  createShareableContractVersion,
  getPublicContractDetails,
} from "./sharing";

import {
  initiateHelloSignRequest,
  helloSignWebhookHandler,
} from "./esignatures";

import {
  generateFinicityConnectUrl,
  finicityWebhookHandler,
} from "./finicity";

import {
  createAgency,
  inviteTalentToAgency,
  acceptAgencyInvitation,
  declineAgencyInvitation,
  createInternalPayout,
  inviteTeamMemberToAgency,
  fundGigFromWallet,
} from "./agency";

import {payoutCreatorForGig} from "./gigs";
import {generateScene} from "./scenes";
import {generateImage} from "./images";
import {analyzeBrand} from "./brand-research";
import {syncInstagramStats, syncYouTubeStats, syncTikTokStats} from "./social";

// Export v2 functions
export {
  createStripeConnectedAccount,
  createStripeAccountLink,
  createPaymentIntent,
  handlePaymentSuccess,
  handleStripeAccountWebhook,
  getStripeAccountBalance,
  createCreditCheckoutSession,
  stripeCreditWebhookHandler,
  createGigFundingCheckoutSession,
  createAgencyTopUpSession,
  sendContractNotification,
  handleSendGridEmailWebhook,
  sendOverdueInvoiceReminders,
  sendUpcomingPaymentReminders,
  processRecurringContracts,
  sendDripCampaignEmails,
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
  createShareableContractVersion,
  getPublicContractDetails,
  initiateHelloSignRequest,
  helloSignWebhookHandler,
  generateFinicityConnectUrl,
  finicityWebhookHandler,
  createAgency,
  inviteTalentToAgency,
  acceptAgencyInvitation,
  declineAgencyInvitation,
  createInternalPayout,
  inviteTeamMemberToAgency,
  fundGigFromWallet,
  payoutCreatorForGig,
  generateScene,
  generateImage,
  analyzeBrand,
  syncInstagramStats,
  syncYouTubeStats,
  syncTikTokStats,
};

// Import and export v1 auth trigger using require/exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
exports.processNewUser = require("./users").processNewUser;
