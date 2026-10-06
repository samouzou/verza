
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
  createCampaignBudgetTopUpCheckout,
  createAgencyTopUpSession,
  initiateCreatorPayout,
} from "./payments";

import {
  createInflowSubMerchant,
  syncInflowKycStatus,
  getInflowBankForm,
  registerInflowBankAccount,
} from "./payments/inflowConnect";

import {
  sendContractNotification,
  handleSendGridEmailWebhook,
  submitFeedback,
  notifyBrandCreatorJoined,
  notifyBrandVideoSubmitted,
  notifyBrandCampaignApplicant,
  sendOnboardingWelcomeEmail,
} from "./notifications";
import {sendVerificationEmail} from "./notifications/verificationEmail";

import {
  sendOverdueInvoiceReminders,
  sendUpcomingPaymentReminders,
  processRecurringContracts,
  sendDripCampaignEmails,
  sendAgencyDripCampaignEmails,
  sendStoreDripCampaignEmails,
  sendCareerPathDripCampaignEmails,
  sendDeploymentDripCampaignEmails,
  processAffiliatePayouts,
} from "./scheduler";

import {
  startStoreEmailSequence,
  startCareerPathEmailSequence,
} from "./notifications/careerPathEmails";

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
  switchPrimaryAgency,
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
  addCampaignBudgetFromWallet,
  releaseUnspentCampaignBudget,
} from "./gigs";
import {generateCampaignCopy} from "./gigs/generateCampaignCopy";
import {syncPublicCampaign, reconcilePublicCampaigns} from "./gigs/publicCampaigns";
import {
  syncBrandKitAccess,
  migrateAgencyBrandKit,
  onBrandKitWritten,
  reconcileBrandKits,
} from "./agency/brandKit";
import {launchFreeCampaign} from "./gigs/campaignLaunch";
import {generateScene, editScene} from "./scenes";
import {generateImage} from "./images";
import {analyzeBrand, suggestBrandGuideFromUrl} from "./brand-research";
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
  setOpticLeadCrm,
  setOpticLeadEmail,
  setOpticLeadOutreachDraft,
  regenerateOpticLeadDraft,
  updateOpticLeadProfile,
  setOpticSmsSettings,
  continueOpticDiscoveryJob,
} from "./optic/jobs";
import {addOpticManualLead} from "./optic/manualLead";
import {createMcpApiKey, listMcpApiKeys, revokeMcpApiKey} from "./mcp/apiKeys";
import {askOpticVaultChat} from "./optic/vaultChat";
import {opticWeeklyUnsubscribe, previewOpticWeekly, sendOpticWeekly} from "./optic/weeklyDigest";
import {refreshOpticCampaignRoasInsight} from "./optic/roasInsight";
import {extractOpticLeadQuotedRate} from "./optic/quotedRate";
import {
  claimOpticExtensionJob,
  submitOpticExtensionLead,
  completeOpticExtensionJob,
  reportOpticExtensionProgress,
} from "./optic/extension";
import {
  createOpticSubscriptionCheckoutSession,
  createOpticBillingPortalSession,
  opticInternalTopUp,
  opticInternalLowCreditCheck,
} from "./optic/billing";
import {
  redeemAppSumoOpticCode,
  resetAppSumoOpticMonthlyAllowances,
} from "./optic/appsumo";
import {dispatchOpticJobToWorker} from "./optic/onJobCreated";
import {opticJobSmsOnComplete} from "./optic/onJobUpdated";
import {opticTwilioSmsWebhook} from "./optic/smsWebhook";
import {enqueueLinkedInOsDraftJob} from "./linkedinOs/jobs";
import {dispatchLinkedInOsJobToWorker} from "./linkedinOs/onJobCreated";
import {generateLinkedInOsBeehiivNewsletter} from "./linkedinOs/beehiivNewsletter";
import {generateLinkedInOsVideoScript} from "./linkedinOs/videoScript";
import {analyzeLinkedInOsVoiceProfile} from "./linkedinOs/voiceProfile";
import {generateLinkedInOsWeeklyPlan} from "./linkedinOs/weeklyPlan";
import {draftPrismBrandStrategy, savePrismBrandStrategy} from "./linkedinOs/brandStrategy";
import {
  addStudioDraftToCalendar,
  deletePrismPost,
  renderPrismSlides,
  savePrismPost,
  transitionPrismPost,
} from "./linkedinOs/posts";
import {adaptPrismPost, generatePrismMonthPlan} from "./linkedinOs/planning";
import {
  beginGmailConnect,
  completeGmailConnect,
  disconnectGmail,
  createOpticGmailDraft,
  sendOpticGmailMessage,
  getOpticGmailThread,
  linkOpticGmailThread,
} from "./gmail";
import {
  upsertStoreProduct,
  manageStoreProduct,
  createStoreCheckoutSession,
  getStoreProductContent,
  getStoreAccess,
} from "./store";
import {
  submitStoreSellerReview,
  reviewStoreSeller,
  listStoreSellerReviews,
  getStoreReviewerAccess,
} from "./store/sellerReview";
import {generateStoreCourseContent} from "./store/generateCourseContent";
import {writeFromYouTubeVideo} from "./youtube-writer/writeFromYouTubeVideo";
import {adaptYouTubeWriterDraft} from "./youtube-writer/adaptYouTubeWriterDraft";

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
  createCampaignBudgetTopUpCheckout,
  createAgencyTopUpSession,
  initiateCreatorPayout,
  createInflowSubMerchant,
  syncInflowKycStatus,
  getInflowBankForm,
  registerInflowBankAccount,
  sendContractNotification,
  handleSendGridEmailWebhook,
  submitFeedback,
  notifyBrandCreatorJoined,
  notifyBrandVideoSubmitted,
  notifyBrandCampaignApplicant,
  sendOnboardingWelcomeEmail,
  sendVerificationEmail,
  startStoreEmailSequence,
  startCareerPathEmailSequence,
  sendOverdueInvoiceReminders,
  sendUpcomingPaymentReminders,
  processRecurringContracts,
  sendDripCampaignEmails,
  sendAgencyDripCampaignEmails,
  sendStoreDripCampaignEmails,
  sendCareerPathDripCampaignEmails,
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
  switchPrimaryAgency,
  createInternalPayout,
  inviteTeamMemberToAgency,
  fundGigFromWallet,
  launchFreeCampaign,
  initiateAgencyPayout,
  initiateInternalTalentPayment,
  payoutCreatorForGig,
  addCampaignBudgetFromWallet,
  releaseUnspentCampaignBudget,
  onGigCreated,
  onGigStatusOpened,
  extendCreatorDeadline,
  syncPublicCampaign,
  reconcilePublicCampaigns,
  syncBrandKitAccess,
  migrateAgencyBrandKit,
  onBrandKitWritten,
  reconcileBrandKits,
  generateCampaignCopy,
  generateScene,
  editScene,
  generateImage,
  analyzeBrand,
  suggestBrandGuideFromUrl,
  syncInstagramStats,
  syncYouTubeStats,
  syncTikTokStats,
  fetchYouTubeVideoStats,
  conversionWebhook,
  onAffiliateLinkClick,
  enqueueOpticDiscoveryJob,
  cancelOpticDiscoveryJob,
  setOpticLeadOutreachStatus,
  setOpticLeadCrm,
  setOpticLeadEmail,
  setOpticLeadOutreachDraft,
  regenerateOpticLeadDraft,
  updateOpticLeadProfile,
  addOpticManualLead,
  askOpticVaultChat,
  sendOpticWeekly,
  previewOpticWeekly,
  opticWeeklyUnsubscribe,
  refreshOpticCampaignRoasInsight,
  extractOpticLeadQuotedRate,
  setOpticSmsSettings,
  continueOpticDiscoveryJob,
  createMcpApiKey,
  listMcpApiKeys,
  revokeMcpApiKey,
  claimOpticExtensionJob,
  submitOpticExtensionLead,
  completeOpticExtensionJob,
  reportOpticExtensionProgress,
  createOpticSubscriptionCheckoutSession,
  createOpticBillingPortalSession,
  opticInternalTopUp,
  opticInternalLowCreditCheck,
  redeemAppSumoOpticCode,
  resetAppSumoOpticMonthlyAllowances,
  opticJobSmsOnComplete,
  opticTwilioSmsWebhook,
  dispatchOpticJobToWorker,
  enqueueLinkedInOsDraftJob,
  dispatchLinkedInOsJobToWorker,
  generateLinkedInOsVideoScript,
  generateLinkedInOsBeehiivNewsletter,
  analyzeLinkedInOsVoiceProfile,
  generateLinkedInOsWeeklyPlan,
  draftPrismBrandStrategy,
  savePrismBrandStrategy,
  savePrismPost,
  addStudioDraftToCalendar,
  renderPrismSlides,
  deletePrismPost,
  transitionPrismPost,
  adaptPrismPost,
  generatePrismMonthPlan,
  beginGmailConnect,
  completeGmailConnect,
  disconnectGmail,
  createOpticGmailDraft,
  sendOpticGmailMessage,
  getOpticGmailThread,
  linkOpticGmailThread,
  upsertStoreProduct,
  manageStoreProduct,
  createStoreCheckoutSession,
  getStoreProductContent,
  getStoreAccess,
  submitStoreSellerReview,
  reviewStoreSeller,
  listStoreSellerReviews,
  getStoreReviewerAccess,
  generateStoreCourseContent,
  writeFromYouTubeVideo,
  adaptYouTubeWriterDraft,
};

// Import and export v1 auth trigger using require/exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
exports.processNewUser = require("./users").processNewUser;
