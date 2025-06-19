
/**
 * Verza Contract Management Firebase Functions
 *
 * This file exports all the functions used in the Verza application:
 * - Payment processing functions
 * - Email notification functions
 * - Scheduled tasks
 * - Contract Sharing functions
 * - E-Signature functions
 */

import {
  createStripeConnectedAccount,
  createStripeAccountLink,
  createPaymentIntent,
  handlePaymentSuccess,
  handleStripeAccountWebhook,
} from "./payments";

import {
  sendContractNotification,
  sendPaymentReminder,
} from "./notifications";

import {
  sendOverdueInvoiceReminders,
} from "./scheduler";

import {
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
} from "./subscriptions";

import {
  createShareableContractVersion,
} from "./sharing";

import {
  initiateHelloSignRequest,
  // helloSignWebhookHandler will be added later
} from "./esignatures";


// Export all functions explicitly
export {
  // Payments
  createStripeConnectedAccount,
  createStripeAccountLink,
  createPaymentIntent,
  handlePaymentSuccess,
  handleStripeAccountWebhook,
  // Notifications
  sendContractNotification,
  sendPaymentReminder,
  // Scheduler
  sendOverdueInvoiceReminders,
  // Subscriptions
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
  // Sharing
  createShareableContractVersion,
  // E-Signatures
  initiateHelloSignRequest,
  // helloSignWebhookHandler, // To be uncommented when implemented
};
