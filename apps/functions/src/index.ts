
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
  createGigFundingCheckoutSession,
  createAgencyTopUpSession,
  initiateCreatorPayout,
} from "./payments";

import {
  sendContractNotification,
  handleSendGridEmailWebhook,
  submitFeedback,
  notifyBrandCreatorJoined,
  notifyBrandVideoSubmitted,
  notifyBrandCampaignApplicant,
} from "./notifications";

import {
  sendOverdueInvoiceReminders,
  sendUpcomingPaymentReminders,
  processRecurringContracts,
  sendDripCampaignEmails,
  sendAgencyDripCampaignEmails,
  sendDeploymentDripCampaignEmails,
  processAffiliatePayouts,
} from "./scheduler";

import {
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
} from "./subscriptions";

import {getPublicContractDetails} from "./sharing";

import {
  initiateBoldSignRequest,
  boldSignWebhookHandler,
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
  initiateAgencyPayout,
  initiateInternalTalentPayment,
} from "./agency";

import {
  payoutCreatorForGig,
  onGigCreated,
  onGigStatusOpened,
  extendCreatorDeadline,
} from "./gigs";
import {generateCampaignCopy} from "./gigs/generateCampaignCopy";
import {generateScene} from "./scenes";
import {generateImage} from "./images";
import {analyzeBrand} from "./brand-research";
import {
  syncInstagramStats,
  syncYouTubeStats,
  syncTikTokStats,
  fetchYouTubeVideoStats,
} from "./social";
import {conversionWebhook} from "./webhooks";
import {onAffiliateLinkClick} from "./tracking";
import {
  enqueueOpticDiscoveryJob,
  cancelOpticDiscoveryJob,
  setOpticLeadOutreachStatus,
  setOpticLeadEmail,
  setOpticSmsSettings,
  continueOpticDiscoveryJob,
} from "./optic/jobs";
import {
  createOpticSubscriptionCheckoutSession,
  createOpticBillingPortalSession,
  opticInternalTopUp,
  opticInternalLowCreditCheck,
} from "./optic/billing";
import {dispatchOpticJobToWorker} from "./optic/onJobCreated";
import {opticJobSmsOnComplete} from "./optic/onJobUpdated";
import {opticTwilioSmsWebhook} from "./optic/smsWebhook";
import {enqueueLinkedInOsDraftJob} from "./linkedinOs/jobs";
import {dispatchLinkedInOsJobToWorker} from "./linkedinOs/onJobCreated";
import {generateLinkedInOsBeehiivNewsletter} from "./linkedinOs/beehiivNewsletter";
import {generateLinkedInOsVideoScript} from "./linkedinOs/videoScript";
import {
  beginGmailConnect,
  completeGmailConnect,
  disconnectGmail,
  createOpticGmailDraft,
} from "./gmail";
import {upsertStoreProduct, createStoreCheckoutSession} from "./store";

// Export v2 functions
export {
  createStripeConnectedAccount,
  createStripeAccountLink,
  createPaymentIntent,
  handlePaymentSuccess,
  handleStripeAccountWebhook,
  getStripeAccountBalance,
  createCreditCheckoutSession,
  createGigFundingCheckoutSession,
  createAgencyTopUpSession,
  initiateCreatorPayout,
  sendContractNotification,
  handleSendGridEmailWebhook,
  submitFeedback,
  notifyBrandCreatorJoined,
  notifyBrandVideoSubmitted,
  notifyBrandCampaignApplicant,
  sendOverdueInvoiceReminders,
  sendUpcomingPaymentReminders,
  processRecurringContracts,
  sendDripCampaignEmails,
  sendAgencyDripCampaignEmails,
  sendDeploymentDripCampaignEmails,
  processAffiliatePayouts,
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
  getPublicContractDetails,
  initiateBoldSignRequest,
  boldSignWebhookHandler,
  generateFinicityConnectUrl,
  finicityWebhookHandler,
  createAgency,
  inviteTalentToAgency,
  acceptAgencyInvitation,
  declineAgencyInvitation,
  createInternalPayout,
  inviteTeamMemberToAgency,
  fundGigFromWallet,
  initiateAgencyPayout,
  initiateInternalTalentPayment,
  payoutCreatorForGig,
  onGigCreated,
  onGigStatusOpened,
  extendCreatorDeadline,
  generateCampaignCopy,
  generateScene,
  generateImage,
  analyzeBrand,
  syncInstagramStats,
  syncYouTubeStats,
  syncTikTokStats,
  fetchYouTubeVideoStats,
  conversionWebhook,
  onAffiliateLinkClick,
  enqueueOpticDiscoveryJob,
  cancelOpticDiscoveryJob,
  setOpticLeadOutreachStatus,
  setOpticLeadEmail,
  setOpticSmsSettings,
  continueOpticDiscoveryJob,
  createOpticSubscriptionCheckoutSession,
  createOpticBillingPortalSession,
  opticInternalTopUp,
  opticInternalLowCreditCheck,
  opticJobSmsOnComplete,
  opticTwilioSmsWebhook,
  dispatchOpticJobToWorker,
  enqueueLinkedInOsDraftJob,
  dispatchLinkedInOsJobToWorker,
  generateLinkedInOsVideoScript,
  generateLinkedInOsBeehiivNewsletter,
  beginGmailConnect,
  completeGmailConnect,
  disconnectGmail,
  createOpticGmailDraft,
  upsertStoreProduct,
  createStoreCheckoutSession,
};

// Import and export v1 auth trigger using require/exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
exports.processNewUser = require("./users").processNewUser;
